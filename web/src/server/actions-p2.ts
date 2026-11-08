import { orderImageHash, saveSettlementImages } from './images'
import { channelAccessible } from '@/shared/channel-access'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Tx } from './db'
import * as t from './schema'
import type { World } from './repo'
import { adminIdsOf } from './repo'
import { bad, deny, notFound } from './http'
import { uid } from './ids'
import { notify } from './notify'
import type { Ctx } from './session'
import { act, dataImage, financialNote, isAdminUser, isoDate, log, need, orderFor } from './actions'
import { can, rowVisible } from '@/shared/perm'
import { businessDate, iso, money, today } from '@/shared/format'
import { incomeAmounts, type SettleKind } from '@/shared/settle'
import { cents } from '@/shared/calc'
import { settlementInOrderScope } from '@/shared/settlement-access'
import type { CardFieldType, Order, Role } from '@/shared/types'

/**
 * P2 的写操作：结算单、待收、评论、进度节点、节点模板、需求卡片、选项管理、对账单分享链接。
 * 和 actions.ts 一样：zod 校验 → 查权限 → 写库 → 同一事务里留痕。
 */

const fieldsOf = (role: Role) => (role.locked ? { sales: true, writerPay: 'all', commission: 'all', profit: true, channelNo: true } : role.fields)

/** 管结算的人要能看到全部对应金额，不然等于绕过字段权限 */
export function needSettle(c: Ctx, kind: SettleKind) {
  need(c, 'settle.manage')
  const f = fieldsOf(c.role)
  if (kind === '写手工资' ? f.writerPay !== 'all' : f.commission !== 'all') throw deny('要能看到全部人的' + (kind === '写手工资' ? '写手工资' : '提成') + '才能管这类结算')
}

async function nextSerial(tx: Tx, name: string) {
  const [r] = await tx
    .insert(t.counters)
    .values({ name, value: 1 })
    .onConflictDoUpdate({ target: t.counters.name, set: { value: sql`${t.counters.value} + 1` } })
    .returning()
  return r.value
}

/** 结算单号：JS + 年月 + 3 位流水，如 JS2610001 */
export async function batchNo(tx: Tx) {
  const n = await nextSerial(tx, 'settle_serial')
  return `JS${iso(today()).slice(2, 7).replace('-', '')}${String(n).padStart(3, '0')}`
}

const userName = (w: World, id: string | null | undefined) => w.users.find((u) => u.id === id)?.name ?? '—'

/** 某人能不能看到这单（提醒、@ 只发给看得到的人） */
function canSee(w: World, userId: string, o: Order) {
  const u = w.users.find((x) => x.id === userId)
  const r = u && w.roles.find((x) => x.id === u.roleId)
  return !!u && u.active && !!r && can(r, 'order.view') && rowVisible(o, u, r)
}

/** 只校验收款人与订单的关系；未定、未收款、退单或超发均可由老板决定。 */
function checkPayee(o: Order, kind: SettleKind, payeeId: string) {
  const related = kind === '写手工资'
    ? o.assignees.some(a => a.userId === payeeId) || o.afterSales.some(a => a.writerId === payeeId && a.extra > 0)
    : o.ownerId === payeeId
  if (!related && !o.settlements.some(s => s.kind === kind && s.payeeId === payeeId)) throw bad(`${o.title} 没有该收款人的${kind}记录`)
}

function overpaymentNote(o: Order, kind: SettleKind, payeeId: string, amount: number, admins: Set<string>) {
  const { due, paid } = incomeAmounts(o, kind, payeeId, admins)
  const over = due === null ? 0 : Math.max(0, cents(paid) + cents(amount) - cents(due)) / 100
  return over > 0 ? `超出应得 ${money(over)}` : ''
}

function needBatchScope(w: World, c: Ctx, batch: World['batches'][number]) {
  if (!settlementInOrderScope(batch, w.orders, c.me.id, c.role)) throw notFound()
}
const payAmount = z.number().positive('金额要大于 0').max(1_000_000).multipleOf(0.01)
const lineSchema = z.object({ orderId: z.string(), amount: payAmount, note: z.string().max(500).default('') })
const settlementShots = z.array(z.union([dataImage, z.string().max(250).startsWith('/api/settle/')])).max(9)

const NODE_STATUS = ['待做', '进行中', '完成'] as const
const OPTION_KEYS = ['statuses', 'types', 'payTags', 'nodeTags'] as const
const OPTION_LABEL: Record<(typeof OPTION_KEYS)[number], string> = { statuses: '订单状态', types: '订单类型', payTags: '收款标签', nodeTags: '节点标签' }
/** 代码里按名字用到的选项，不能删 */
const REQUIRED: Partial<Record<(typeof OPTION_KEYS)[number], string[]>> = { statuses: ['未交付', '已交付', '退单'], payTags: ['退款'] }

/** 新节点名自动进节点标签库（和订单类型一样） */
async function addNodeTags(tx: Tx, w: World, names: string[]) {
  const add = Array.from(new Set(names.filter((n) => n && !w.nodeTags.includes(n))))
  if (!add.length) return
  const values = [...w.nodeTags, ...add]
  await tx.insert(t.options).values({ key: 'nodeTags', values }).onConflictDoUpdate({ target: t.options.key, set: { values } })
}

function cardValue(type: CardFieldType, v: unknown, choices: string[], o: Order): unknown {
  if (v === null || v === '' || v === undefined) return null
  switch (type) {
    case 'text':
      return z.string().max(200).parse(v)
    case 'longtext':
      return z.string().max(5000).parse(v)
    case 'number':
      return z.number().min(0).max(10_000_000).parse(v)
    case 'date':
      return isoDate.parse(v)
    case 'select': {
      const s = z.string().parse(v)
      if (!choices.includes(s)) throw bad(`「${s}」不在选项里`)
      return s
    }
    case 'file': {
      const ids = z.array(z.string()).max(50).parse(v)
      for (const id of ids) if (!o.attachments.some((a) => a.id === id)) throw bad('附件不属于这单')
      return ids
    }
  }
}

export const P2_ACTIONS = {
  // ---------- 结算单 ----------

  /** 收入表逐单结算：一次事务完成，网络重试复用同一编号，避免重复记款。 */
  'settle.pay': act({
    schema: z.object({
      requestId: z.string().uuid(), orderId: z.string(), payeeId: z.string(),
      kind: z.enum(['写手工资', '销售提成']).default('写手工资'),
      amount: payAmount,
      date: isoDate.refine(value => {
        const d = new Date(`${value}T12:00:00+08:00`)
        return Number.isFinite(d.getTime()) && businessDate(d) === value
      }, '结算日期不存在').refine(value => value <= businessDate(new Date()), '发放日期不能晚于今天').optional(),
      note: z.string().max(2000).default(''), shots: settlementShots.default([]),
    }),
    run: async (tx, c, w, i) => {
      needSettle(c, i.kind)
      const id = `sb_quick_${i.requestId}`
      const old = w.batches.find(b => b.id === id)
      if (old) {
        if (old.createdBy !== c.me.id || old.kind !== i.kind || old.payeeId !== i.payeeId || old.lines.length !== 1 || old.lines[0].orderId !== i.orderId || old.total !== i.amount || (i.date && (!old.confirmedAt || businessDate(old.confirmedAt) !== i.date))) throw bad('结算内容已变化，请刷新后重试')
        if (old.status !== '已确认') throw bad('这笔结算已撤销，请刷新后重新结算')
        return { id, amount: old.total }
      }
      const payee = w.users.find(u => u.id === i.payeeId)
      if (!payee || isAdminUser(w, payee.id)) throw bad(i.kind === '写手工资' ? '请选择写手结算' : '请选择销售结算，自营单不计提成')
      const o = orderFor(w, c, i.orderId, 'settle.manage')
      const admins = adminIdsOf(w)
      checkPayee(o, i.kind, payee.id)
      const now = new Date().toISOString()
      const day = i.date ?? businessDate(now)
      const confirmedAt = day === businessDate(now) ? now : `${day}T12:00:00+08:00`
      const autoNote = `${day} 结算 ${money(i.amount)} · ${c.me.name}${day !== businessDate(now) ? '（仅记录付款日期）' : ''}`
      const no = await batchNo(tx)
      await tx.insert(t.settleBatches).values({ id, no, kind: i.kind, payeeId: payee.id, status: '已确认', note: i.note, createdBy: c.me.id, confirmedAt, confirmedBy: c.me.id })
      const shots = await saveSettlementImages(i.shots, id, [])
      if (shots.length) await tx.update(t.settleBatches).set({ shots }).where(eq(t.settleBatches.id, id))
      await tx.insert(t.settlements).values({ id: uid('st'), kind: i.kind, payeeId: payee.id, orderId: o.id, amount: i.amount, note: autoNote, status: '已确认', batchId: id, confirmedAt })
      await log(tx, c, { action: i.kind === '写手工资' ? '结算工资' : '结算提成', objectType: 'order', objectId: o.id, objectLabel: o.no, fieldGroup: i.kind === '写手工资' ? 'writerPay' : 'commission', to: `${payee.name} ${money(i.amount)}`, note: [autoNote, i.note, overpaymentNote(o, i.kind, payee.id, i.amount, admins)].filter(Boolean).join('；') })
      await notify(tx, [payee.id], { kind: '结算', tab: 'page:income', title: `${i.kind === '写手工资' ? '工资' : '提成'}已结算：${money(i.amount)}`, body: o.title, actorId: c.me.id })
      return { id, amount: i.amount }
    },
  }),

  /** 收入页整批发放：逐单采用老板指定金额，一次事务直接确认，重试不生成第二张结算单。 */
  'settle.payBatch': act({
    schema: z.object({
      requestId: z.string().uuid(), kind: z.enum(['写手工资', '销售提成']), payeeId: z.string(),
      lines: z.array(z.object({ orderId: z.string(), amount: payAmount })).min(1, '至少选一单').max(500),
      date: isoDate.refine(value => {
        const d = new Date(`${value}T12:00:00+08:00`)
        return Number.isFinite(d.getTime()) && businessDate(d) === value
      }, '结算日期不存在').refine(value => value <= businessDate(new Date()), '发放日期不能晚于今天').optional(),
      note: z.string().max(2000).default(''), shots: settlementShots.default([]),
    }),
    run: async (tx, c, w, i) => {
      needSettle(c, i.kind)
      if (new Set(i.lines.map(line => line.orderId)).size !== i.lines.length) throw bad('同一单只能有一行')
      const id = `sb_bulk_${i.requestId}`
      const old = w.batches.find(b => b.id === id)
      if (old) {
        const shots = [...new Set(i.shots.map(image => image.startsWith('data:') ? `/api/settle/${id}/images/${orderImageHash(image)}` : image))]
        if (old.createdBy !== c.me.id || old.kind !== i.kind || old.payeeId !== i.payeeId || old.note !== i.note || old.lines.length !== i.lines.length ||
          i.lines.some(line => !old.lines.some(saved => saved.orderId === line.orderId && saved.amount === line.amount)) ||
          JSON.stringify(old.shots ?? []) !== JSON.stringify(shots) || (i.date && (!old.confirmedAt || businessDate(old.confirmedAt) !== i.date))) throw bad('结算内容已变化，请刷新后重试')
        if (old.status !== '已确认') throw bad('这笔结算已撤销，请刷新后重新结算')
        return { id, amount: old.total, count: old.lines.length }
      }
      const payee = w.users.find(u => u.id === i.payeeId)
      if (!payee || isAdminUser(w, payee.id)) throw bad(i.kind === '写手工资' ? '请选择写手结算' : '请选择销售结算，自营单不计提成')
      const admins = adminIdsOf(w)
      const lines = i.lines.map(line => {
        const o = orderFor(w, c, line.orderId, 'settle.manage')
        checkPayee(o, i.kind, payee.id)
        return { o, amount: line.amount }
      })
      const total = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100
      const now = new Date().toISOString(), day = i.date ?? businessDate(now)
      const confirmedAt = day === businessDate(now) ? now : `${day}T12:00:00+08:00`
      const noteFor = (amount: number) => `${day} 结算 ${money(amount)} · ${c.me.name}${day !== businessDate(now) ? '（仅记录付款日期）' : ''}`
      const no = await batchNo(tx)
      const shots = await saveSettlementImages(i.shots, id, [])
      await tx.insert(t.settleBatches).values({ id, no, kind: i.kind, payeeId: payee.id, status: '已确认', note: i.note, shots, createdBy: c.me.id, confirmedAt, confirmedBy: c.me.id })
      await tx.insert(t.settlements).values(lines.map(({ o, amount }) => ({ id: uid('st'), kind: i.kind, payeeId: payee.id, orderId: o.id, amount, note: noteFor(amount), status: '已确认', batchId: id, confirmedAt })))
      for (const { o, amount } of lines) await log(tx, c, { action: i.kind === '写手工资' ? '结算工资' : '结算提成', objectType: 'order', objectId: o.id, objectLabel: o.no, fieldGroup: i.kind === '写手工资' ? 'writerPay' : 'commission', to: `${payee.name} ${money(amount)}`, note: [noteFor(amount), i.note, overpaymentNote(o, i.kind, payee.id, amount, admins)].filter(Boolean).join('；') })
      await log(tx, c, { action: '批量发放', objectType: 'settle', objectId: id, objectLabel: no, to: `${payee.name} ${lines.length} 单 ${money(total)}`, note: [i.note, ...lines.map(({ o, amount }) => { const over = overpaymentNote(o, i.kind, payee.id, amount, admins); return over ? `${o.no} ${over}` : '' })].filter(Boolean).join('；') })
      await notify(tx, [payee.id], { kind: '结算', tab: 'page:income', title: `${i.kind === '写手工资' ? '工资' : '提成'}已结算：${money(total)}`, body: `${no} · ${lines.length} 单`, actorId: c.me.id })
      return { id, amount: total, count: lines.length }
    },
  }),

  /** 新建或改草稿：收款人 + 若干单的本次结算金额 */
  'settle.save': act({
    schema: z.object({
      id: z.string().optional(),
      kind: z.enum(['写手工资', '销售提成']),
      payeeId: z.string(),
      note: z.string().max(2000).default(''),
      shots: settlementShots.optional(),
      lines: z.array(lineSchema).min(1, '至少选一单').max(500),
    }),
    run: async (tx, c, w, i) => {
      needSettle(c, i.kind)
      const payee = w.users.find((u) => u.id === i.payeeId)
      if (!payee) throw bad('收款人不存在')
      if (isAdminUser(w, payee.id)) throw bad(i.kind === '写手工资' ? '老板内部计价不发工资' : '管理员的单是自营，不计提成')
      const ids = i.lines.map((l) => l.orderId)
      if (new Set(ids).size !== ids.length) throw bad('同一单只能有一行')
      for (const l of i.lines) {
        const o = orderFor(w, c, l.orderId, 'settle.manage')
        checkPayee(o, i.kind, payee.id)
      }
      let id = i.id
      if (id) {
        const b = w.batches.find((x) => x.id === id)
        if (!b) throw notFound()
        needBatchScope(w, c, b)
        if (b.status !== '草稿') throw bad('只有草稿能改')
        if (b.kind !== i.kind || b.payeeId !== i.payeeId) throw bad('草稿的类型和收款人不能改，作废后重新建')
        await tx.delete(t.settlements).where(eq(t.settlements.batchId, id))
        await tx.update(t.settleBatches).set({ note: i.note }).where(eq(t.settleBatches.id, id))
      } else {
        id = uid('sb')
        await tx.insert(t.settleBatches).values({ id, no: await batchNo(tx), kind: i.kind, payeeId: payee.id, status: '草稿', note: i.note, createdBy: c.me.id })
      }
      if (i.shots) {
        const shots = await saveSettlementImages(i.shots, id, w.batches.find(b => b.id === id)?.shots ?? [])
        await tx.update(t.settleBatches).set({ shots }).where(eq(t.settleBatches.id, id))
      }
      await tx.insert(t.settlements).values(i.lines.map((l) => ({ id: uid('st'), kind: i.kind, payeeId: payee.id, orderId: l.orderId, amount: l.amount, note: l.note, status: '草稿', batchId: id })))
      const total = i.lines.reduce((s, l) => s + l.amount, 0)
      await log(tx, c, { action: i.id ? '修改结算单' : '新建结算单', objectType: 'settle', objectId: id, objectLabel: `${i.kind} · ${payee.name}`, to: `${i.lines.length} 单 ${money(total)}` })
      return { id }
    },
  }),

  'settle.date': act({
    schema: z.object({ id: z.string().min(1), date: z.iso.date(), reason: z.string().trim().min(1, '请填写补记依据').max(500) }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('只有管理员可以补记历史发放日期')
      if (i.date > businessDate(new Date())) throw bad('发放日期不能晚于今天')
      const historical = i.id.startsWith('history:')
      const id = historical ? i.id.slice('history:'.length) : i.id
      const [record] = historical
        ? await tx.select().from(t.settlements).where(and(eq(t.settlements.id, id), isNull(t.settlements.batchId))).for('update')
        : await tx.select().from(t.settleBatches).where(eq(t.settleBatches.id, id)).for('update')
      if (!record) throw notFound()
      needSettle(c, record.kind as SettleKind)
      if (record.status !== '已确认') throw bad('只能补记已发放记录的日期')
      if (record.confirmedAt || record.confirmedDate) {
        if (!record.confirmedAt && record.confirmedDate === i.date) return { ok: true }
        throw bad('这笔记录已有发放日期，请刷新核对')
      }
      if (historical) {
        await tx.update(t.settlements).set({ confirmedDate: i.date }).where(eq(t.settlements.id, id))
      } else {
        const batch = w.batches.find(b => b.id === id)
        if (!batch) throw notFound()
        needBatchScope(w, c, batch)
        const lines = await tx.select().from(t.settlements).where(eq(t.settlements.batchId, id))
        if (!lines.length || lines.some(line => line.status !== '已确认' || line.confirmedAt || line.confirmedDate)) throw bad('批次明细已有日期或状态不一致，请核对')
        await tx.update(t.settleBatches).set({ confirmedDate: i.date }).where(eq(t.settleBatches.id, id))
        await tx.update(t.settlements).set({ confirmedDate: i.date }).where(eq(t.settlements.batchId, id))
      }
      await log(tx, c, { action: '补记发放日期', objectType: historical ? 'order' : 'settle', objectId: historical ? (record as typeof t.settlements.$inferSelect).orderId : id,
        field: '发放日期', fieldGroup: record.kind === '写手工资' ? 'writerPay' : 'commission', from: '未记录', to: i.date, note: i.reason })
      return { ok: true }
    },
  }),

  'settle.note': act({
    schema: z.object({ id: z.string(), note: z.string().max(2000), shots: settlementShots }),
    run: async (tx, c, w, i) => {
      const b = w.batches.find(x => x.id === i.id)
      if (!b) throw notFound()
      needSettle(c, b.kind)
      needBatchScope(w, c, b)
      if (b.status === '已作废') throw bad('已作废的结算单不能修改')
      const shots = await saveSettlementImages(i.shots, b.id, b.shots ?? [])
      await tx.update(t.settleBatches).set({ note: i.note, shots }).where(eq(t.settleBatches.id, b.id))
      await log(tx, c, { action: '修改结算备注', objectType: 'settle', objectId: b.id, objectLabel: b.no, from: `${b.note}（${b.shots?.length ?? 0} 张截图）`, to: `${i.note}（${shots.length} 张截图）` })
      return { ok: true }
    },
  }),

  'settle.confirm': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      const b = w.batches.find((x) => x.id === i.id)
      if (!b) throw notFound()
      needSettle(c, b.kind)
      needBatchScope(w, c, b)
      if (b.status !== '草稿') throw bad('只有草稿能确认')
      if (!b.lines.length) throw bad('结算单是空的')
      if (!w.users.some(u => u.id === b.payeeId) || isAdminUser(w, b.payeeId)) throw bad('老板内部计价不发工资或提成')
      for (const line of b.lines) {
        const o = orderFor(w, c, line.orderId, 'settle.manage')
        if (o.settlements.some(saved => saved.batchId === b.id && saved.payeeId !== b.payeeId)) throw bad('结算单收款人不一致，请作废后重新建立')
        payAmount.parse(line.amount)
        checkPayee(o, b.kind, b.payeeId)
      }
      const now = new Date().toISOString()
      await tx.update(t.settleBatches).set({ status: '已确认', confirmedAt: now, confirmedBy: c.me.id }).where(eq(t.settleBatches.id, b.id))
      await tx.update(t.settlements).set({ status: '已确认', confirmedAt: now }).where(eq(t.settlements.batchId, b.id))
      await log(tx, c, { action: '确认结算单', objectType: 'settle', objectId: b.id, objectLabel: b.no, to: `${userName(w, b.payeeId)} ${money(b.total)}`, note: b.lines.map(line => { const o = w.orders.find(o => o.id === line.orderId)!; const over = overpaymentNote(o, b.kind, b.payeeId, line.amount, adminIdsOf(w)); return over ? `${o.no} ${over}` : '' }).filter(Boolean).join('；') })
      await notify(tx, [b.payeeId], { kind: '结算', tab: 'page:settle', title: `${b.kind}已结算：${money(b.total)}`, body: `${b.no} · ${b.lines.length} 单`, actorId: c.me.id })
      return { ok: true }
    },
  }),

  'settle.void': act({
    schema: z.object({ id: z.string(), reason: z.string().trim().min(1, '作废原因必填').max(200) }),
    run: async (tx, c, w, i) => {
      const b = w.batches.find((x) => x.id === i.id)
      if (!b) throw notFound()
      needSettle(c, b.kind)
      needBatchScope(w, c, b)
      if (b.status === '已作废') throw bad('已经作废了')
      await tx.update(t.settleBatches).set({ status: '已作废', voidedAt: new Date().toISOString(), voidedBy: c.me.id, note: [b.note, `作废：${i.reason}`].filter(Boolean).join('；') }).where(eq(t.settleBatches.id, b.id))
      await tx.update(t.settlements).set({ status: '已作废' }).where(eq(t.settlements.batchId, b.id))
      await log(tx, c, { action: '作废结算单', objectType: 'settle', objectId: b.id, objectLabel: b.no, from: b.status, to: `已作废：${i.reason}` })
      if (b.status === '已确认') await notify(tx, [b.payeeId], { kind: '结算', tab: 'page:settle', title: `结算单 ${b.no} 已作废`, body: i.reason, actorId: c.me.id })
      return { ok: true }
    },
  }),

  // ---------- 待收 ----------

  'recv.create': act({
    schema: z.object({ orderId: z.string(), amount: z.number().positive('金额要大于 0').max(10_000_000), dueDate: isoDate, tag: z.string().trim().min(1).max(20), note: z.string().max(500).default('') }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'payment.create')
      if (!fieldsOf(c.role).sales) throw deny()
      const id = uid('rv')
      await tx.insert(t.receivables).values({ id, orderId: o.id, amount: i.amount, dueDate: i.dueDate, tag: i.tag, note: i.note, by: c.me.id })
      await log(tx, c, { action: '记待收', objectType: 'order', objectId: o.id, objectLabel: o.no, field: i.tag, from: '', to: `${money(i.amount)}，预计 ${i.dueDate}`, fieldGroup: 'sales' })
      return { id }
    },
  }),

  /** 收到了：转成一笔实收（标签、金额沿用待收，日期默认今天） */
  'recv.collect': act({
    schema: z.object({ orderId: z.string(), id: z.string(), date: isoDate, amount: z.number().positive().max(10_000_000).optional(), note: z.string().trim().max(500).default(''), proof: dataImage.optional() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'payment.create')
      if (!fieldsOf(c.role).sales) throw deny()
      const r = o.receivables.find((x) => x.id === i.id)
      if (!r) throw notFound()
      if (r.doneAt || r.cancelledAt) throw bad('这笔待收已经处理过了')
      const amount = i.amount ?? r.amount
      const memo = await financialNote(tx, c, o.id, i.note, i.proof)
      const pid = uid('pay')
      await tx.insert(t.payments).values({ id: pid, orderId: o.id, amount, date: i.date, tag: r.tag, note: [i.note || r.note, '由待收转入'].filter(Boolean).join(' · '), proof: memo.proof ?? null, by: c.me.id })
      await tx.update(t.receivables).set({ doneAt: new Date().toISOString(), paymentId: pid }).where(eq(t.receivables.id, r.id))
      await log(tx, c, { action: '待收转实收', objectType: 'order', objectId: o.id, objectLabel: o.no, field: r.tag, from: `待收 ${money(r.amount)}`, to: `实收 ${money(amount)}（${i.date}）`, fieldGroup: 'sales', ...memo })
      return { paymentId: pid }
    },
  }),

  'recv.cancel': act({
    schema: z.object({ orderId: z.string(), id: z.string() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'payment.create')
      if (!fieldsOf(c.role).sales) throw deny()
      const r = o.receivables.find((x) => x.id === i.id)
      if (!r) throw notFound()
      if (r.doneAt || r.cancelledAt) throw bad('这笔待收已经处理过了')
      await tx.update(t.receivables).set({ cancelledAt: new Date().toISOString() }).where(eq(t.receivables.id, r.id))
      await log(tx, c, { action: '取消待收', objectType: 'order', objectId: o.id, objectLabel: o.no, field: r.tag, from: `${money(r.amount)}，预计 ${r.dueDate}`, to: '已取消', fieldGroup: 'sales' })
      return { ok: true }
    },
  }),

  // ---------- 评论 ----------

  'comment.create': act({
    schema: z.object({ orderId: z.string(), body: z.string().trim().max(5000), images: z.array(dataImage).max(9).default([]), mentions: z.array(z.string()).max(20).default([]) }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'order.view')
      if (!i.body && !i.images.length) throw bad('写点什么或贴张图')
      // 只 @ 看得到这单的人；看不到的人不提醒、也不记
      const mentions = Array.from(new Set(i.mentions)).filter((id) => canSee(w, id, o))
      const id = uid('cm')
      await tx.insert(t.comments).values({ id, orderId: o.id, by: c.me.id, body: i.body, images: i.images, mentions })
      await log(tx, c, { action: '评论', objectType: 'order', objectId: o.id, objectLabel: o.no, to: i.body.slice(0, 200) || '（图片）' })
      await notify(tx, mentions, { kind: '被 @', orderId: o.id, tab: 'comments', title: `${c.me.name} 在「${o.title}」里 @ 了你`, body: i.body.slice(0, 120), actorId: c.me.id })
      return { id, mentions }
    },
  }),

  'comment.delete': act({
    schema: z.object({ orderId: z.string(), id: z.string() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'order.view')
      const [m] = await tx.select().from(t.comments).where(and(eq(t.comments.id, i.id), eq(t.comments.orderId, o.id)))
      if (!m || m.deletedAt) throw notFound()
      if (m.by !== c.me.id && !c.role.locked) throw deny('只能删自己的评论')
      await tx.update(t.comments).set({ deletedAt: new Date().toISOString() }).where(eq(t.comments.id, m.id))
      await log(tx, c, { action: '删除评论', objectType: 'order', objectId: o.id, objectLabel: o.no, from: m.body.slice(0, 200), to: '' })
      return { ok: true }
    },
  }),

  // ---------- 进度节点 ----------

  'node.save': act({
    schema: z.object({
      orderId: z.string(),
      node: z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1, '节点名必填').max(40),
        status: z.enum(NODE_STATUS).default('待做'),
        planDate: isoDate.nullable().default(null),
        doneDate: isoDate.nullable().default(null),
        ownerId: z.string().nullable().default(null),
        note: z.string().max(1000).default(''),
      }),
    }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'node.edit')
      const n = i.node
      if (n.ownerId && !w.users.some((u) => u.id === n.ownerId)) throw bad('负责人不存在')
      const doneDate = n.status === '完成' ? (n.doneDate ?? iso(today())) : null
      const old = n.id ? o.nodes.find((x) => x.id === n.id) : undefined
      if (n.id && !old) throw notFound()
      const values = { name: n.name, status: n.status, planDate: n.planDate, doneDate, ownerId: n.ownerId, note: n.note }
      let id = n.id
      if (old) await tx.update(t.orderNodes).set(values).where(eq(t.orderNodes.id, old.id))
      else {
        id = uid('nd')
        await tx.insert(t.orderNodes).values({ id, orderId: o.id, sort: o.nodes.length, ...values })
      }
      await addNodeTags(tx, w, [n.name])
      const desc = (x: { status: string; planDate: string | null; ownerId: string | null }) => `${x.status}${x.planDate ? ` · 计划 ${x.planDate}` : ''}${x.ownerId ? ` · ${userName(w, x.ownerId)}` : ''}`
      await log(tx, c, { action: old ? '改节点' : '加节点', objectType: 'order', objectId: o.id, objectLabel: o.no, field: n.name, from: old ? desc(old) : '', to: desc(values) })
      if (n.ownerId && n.ownerId !== old?.ownerId) await notify(tx, [n.ownerId], { kind: '节点', orderId: o.id, tab: 'nodes', title: `「${o.title}」的节点「${n.name}」交给你`, body: n.planDate ? `计划 ${n.planDate}` : '', actorId: c.me.id })
      return { id }
    },
  }),

  'node.delete': act({
    schema: z.object({ orderId: z.string(), id: z.string() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'node.edit')
      const n = o.nodes.find((x) => x.id === i.id)
      if (!n) throw notFound()
      await tx.delete(t.orderNodes).where(eq(t.orderNodes.id, n.id))
      await tx.update(t.attachments).set({ nodeId: null }).where(eq(t.attachments.nodeId, n.id))
      await log(tx, c, { action: '删节点', objectType: 'order', objectId: o.id, objectLabel: o.no, field: n.name, from: n.status, to: '' })
      return { ok: true }
    },
  }),

  'node.reorder': act({
    schema: z.object({ orderId: z.string(), ids: z.array(z.string()).max(200) }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'node.edit')
      if (i.ids.length !== o.nodes.length || !o.nodes.every((n) => i.ids.includes(n.id))) throw bad('节点列表已经变了，刷新后再拖')
      for (const [k, id] of i.ids.entries()) await tx.update(t.orderNodes).set({ sort: k }).where(eq(t.orderNodes.id, id))
      return { ok: true }
    },
  }),

  'node.applyTemplate': act({
    schema: z.object({ orderId: z.string(), templateId: z.string() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'node.edit')
      const tpl = w.nodeTemplates.find((x) => x.id === i.templateId)
      if (!tpl) throw notFound()
      const base = new Date(o.orderDate + 'T00:00:00')
      const rows = tpl.nodes.map((n, k) => {
        const d = new Date(base)
        d.setDate(d.getDate() + (n.days ?? 0))
        return { id: uid('nd'), orderId: o.id, name: n.name, status: '待做', planDate: n.days === null ? null : iso(d), sort: o.nodes.length + k }
      })
      if (rows.length) await tx.insert(t.orderNodes).values(rows)
      await log(tx, c, { action: '套用节点模板', objectType: 'order', objectId: o.id, objectLabel: o.no, field: tpl.name, to: tpl.nodes.map((n) => n.name).join('、') })
      return { count: rows.length }
    },
  }),

  // ---------- 需求卡片 ----------

  'card.update': act({
    schema: z.object({ orderId: z.string(), values: z.record(z.string(), z.unknown()) }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'card.edit')
      const next = { ...o.req }
      for (const [k, v] of Object.entries(i.values)) {
        const f = w.cardFields.find((x) => x.id === k)
        if (!f) throw bad('没有这个字段')
        let val: unknown
        try {
          val = cardValue(f.type, v, f.choices, o)
        } catch (e) {
          if (e instanceof z.ZodError) throw bad(`「${f.label}」格式不对`)
          throw e
        }
        const show = (x: unknown) => (x === null || x === undefined ? '空' : Array.isArray(x) ? `${x.length} 个文件` : String(x))
        if (show(o.req[k]) === show(val) && JSON.stringify(o.req[k] ?? null) === JSON.stringify(val)) continue
        if (val === null) delete next[k]
        else next[k] = val
        await log(tx, c, { action: '修改', objectType: 'order', objectId: o.id, objectLabel: o.no, field: `需求 · ${f.label}`, from: show(o.req[k]), to: show(val) })
      }
      await tx.update(t.orders).set({ req: next, updatedAt: new Date().toISOString() }).where(eq(t.orders.id, o.id))
      return { ok: true }
    },
  }),

  // ---------- 系统设置：选项、节点模板、需求卡片字段、导航顺序 ----------

  'options.save': act({
    schema: z.object({ key: z.enum(OPTION_KEYS), values: z.array(z.string().trim().min(1).max(30)).max(100) }),
    run: async (tx, c, w, i) => {
      need(c, 'options.manage')
      if (new Set(i.values).size !== i.values.length) throw bad('有重复的选项')
      const old = i.key === 'statuses' ? w.statuses : i.key === 'types' ? w.types : i.key === 'payTags' ? w.payTags : w.nodeTags
      for (const r of REQUIRED[i.key] ?? []) if (!i.values.includes(r)) throw bad(`「${r}」系统要用，不能删`)
      if (i.key === 'statuses') {
        if (!i.values.length) throw bad('至少留一个状态')
        for (const s of old.filter((x) => !i.values.includes(x))) {
          const n = w.orders.filter((o) => !o.deletedAt && o.status === s).length
          if (n) throw bad(`还有 ${n} 单是「${s}」，先改掉再删`)
        }
      }
      await tx.insert(t.options).values({ key: i.key, values: i.values }).onConflictDoUpdate({ target: t.options.key, set: { values: i.values } })
      await log(tx, c, { action: '修改', objectType: 'settings', objectLabel: OPTION_LABEL[i.key], from: old.join('、'), to: i.values.join('、') })
      return { ok: true }
    },
  }),

  'template.save': act({
    schema: z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(30), nodes: z.array(z.object({ name: z.string().trim().min(1).max(40), days: z.number().int().min(0).max(365).nullable() })).min(1).max(30) }),
    run: async (tx, c, w, i) => {
      need(c, 'options.manage')
      const old = i.id ? w.nodeTemplates.find((x) => x.id === i.id) : undefined
      if (i.id && !old) throw notFound()
      const id = old?.id ?? uid('tpl')
      if (old) await tx.update(t.nodeTemplates).set({ name: i.name, nodes: i.nodes }).where(eq(t.nodeTemplates.id, id))
      else await tx.insert(t.nodeTemplates).values({ id, name: i.name, nodes: i.nodes, sort: w.nodeTemplates.length })
      await addNodeTags(tx, w, i.nodes.map((n) => n.name))
      await log(tx, c, { action: old ? '修改' : '新建', objectType: 'settings', objectLabel: `节点模板 · ${i.name}`, to: i.nodes.map((n) => n.name).join('、') })
      return { id }
    },
  }),

  'template.delete': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      need(c, 'options.manage')
      const old = w.nodeTemplates.find((x) => x.id === i.id)
      if (!old) throw notFound()
      await tx.delete(t.nodeTemplates).where(eq(t.nodeTemplates.id, old.id))
      await log(tx, c, { action: '删除', objectType: 'settings', objectLabel: `节点模板 · ${old.name}` })
      return { ok: true }
    },
  }),

  'cardField.save': act({
    schema: z.object({ id: z.string().optional(), label: z.string().trim().min(1).max(30), type: z.enum(['text', 'longtext', 'number', 'select', 'date', 'file']), choices: z.array(z.string().trim().min(1).max(30)).max(50).default([]) }),
    run: async (tx, c, w, i) => {
      need(c, 'options.manage')
      if (i.type === 'select' && !i.choices.length) throw bad('选项字段至少要一个选项')
      const old = i.id ? w.cardFields.find((x) => x.id === i.id) : undefined
      if (i.id && !old) throw notFound()
      if (old && old.type !== i.type) throw bad('字段类型建好后不能改；要换类型就新建一个字段')
      const id = old?.id ?? uid('fd')
      if (old) await tx.update(t.cardFields).set({ label: i.label, choices: i.choices }).where(eq(t.cardFields.id, id))
      else await tx.insert(t.cardFields).values({ id, label: i.label, type: i.type, choices: i.choices, sort: w.cardFields.length })
      await log(tx, c, { action: old ? '修改' : '新建', objectType: 'settings', objectLabel: `需求卡片字段 · ${i.label}`, from: old ? old.label : '', to: i.type === 'select' ? i.choices.join('、') : i.type })
      return { id }
    },
  }),

  /** 停用 / 恢复字段：停用后卡片上不再显示，已填的值保留 */
  'cardField.archive': act({
    schema: z.object({ id: z.string(), archived: z.boolean() }),
    run: async (tx, c, w, i) => {
      need(c, 'options.manage')
      const f = w.cardFields.find((x) => x.id === i.id)
      if (!f) throw notFound()
      await tx.update(t.cardFields).set({ archivedAt: i.archived ? new Date().toISOString() : null }).where(eq(t.cardFields.id, f.id))
      await log(tx, c, { action: i.archived ? '停用' : '恢复', objectType: 'settings', objectLabel: `需求卡片字段 · ${f.label}` })
      return { ok: true }
    },
  }),

  /** 拖动排序：节点模板、需求卡片字段 */
  'settings.reorder': act({
    schema: z.object({ what: z.enum(['templates', 'cardFields']), ids: z.array(z.string()).max(200) }),
    run: async (tx, c, w, i) => {
      need(c, 'options.manage')
      const table = i.what === 'templates' ? t.nodeTemplates : t.cardFields
      const all = (i.what === 'templates' ? w.nodeTemplates : w.cardFields).map((x) => x.id)
      if (i.ids.length !== all.length || !all.every((x) => i.ids.includes(x))) throw bad('列表已经变了，刷新后再拖')
      for (const [k, id] of i.ids.entries()) await tx.update(table).set({ sort: k }).where(eq(table.id, id))
      return { ok: true }
    },
  }),

  /** 左侧导航的模块顺序（全员生效） */
  'settings.navOrder': act({
    schema: z.object({ pages: z.array(z.string().max(30)).max(30) }),
    run: async (tx, c, w, i) => {
      need(c, 'options.manage')
      await tx.insert(t.options).values({ key: 'navOrder', values: i.pages }).onConflictDoUpdate({ target: t.options.key, set: { values: i.pages } })
      await log(tx, c, { action: '修改', objectType: 'settings', objectLabel: '导航顺序', to: i.pages.join('、') })
      return { ok: true }
    },
  }),

  // ---------- 对账单分享链接 ----------

  'share.create': act({
    schema: z.object({ channelId: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/), days: z.number().int().min(1).max(365).nullable() }),
    run: async (tx, c, w, i) => {
      need(c, 'statement.view')
      if (!fieldsOf(c.role).sales) throw deny('看不到销售额，不能分享对账单')
      const ch = w.channels.find((x) => x.id === i.channelId)
      if (!ch || ch.deletedAt || !channelAccessible(ch, c.me, c.role)) throw notFound()
      const token = randomBytes(24).toString('base64url')
      const id = uid('sh')
      const expiresAt = i.days ? new Date(Date.now() + i.days * 86400_000).toISOString() : null
      await tx.insert(t.shareLinks).values({ id, tokenHash: hashToken(token), channelId: ch.id, month: i.month, expiresAt, createdBy: c.me.id })
      await log(tx, c, { action: '生成分享链接', objectType: 'share', objectId: id, objectLabel: `${ch.name} · ${i.month}`, to: expiresAt ? `有效到 ${iso(new Date(expiresAt))}` : '长期有效' })
      // 令牌只在这次返回里出现，库里只有哈希
      return { id, token }
    },
  }),

  'share.revoke': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      need(c, 'statement.view')
      const [l] = await tx.select().from(t.shareLinks).where(eq(t.shareLinks.id, i.id))
      if (!l) throw notFound()
      if (l.createdBy !== c.me.id && !c.role.locked) throw deny('只能撤销自己生成的链接')
      if (l.revokedAt) return { ok: true }
      await tx.update(t.shareLinks).set({ revokedAt: new Date().toISOString() }).where(eq(t.shareLinks.id, l.id))
      await log(tx, c, { action: '撤销分享链接', objectType: 'share', objectId: l.id, objectLabel: `${w.channels.find((x) => x.id === l.channelId)?.name ?? ''} · ${l.month}` })
      return { ok: true }
    },
  }),

  // ---------- 提醒 ----------

  'notes.markRead': act({
    quiet: true,
    schema: z.object({ ids: z.array(z.string()).max(500).optional() }),
    run: async (tx, c, _w, i) => {
      const now = new Date().toISOString()
      const mine = and(eq(t.notifications.userId, c.me.id), sql`${t.notifications.readAt} is null`)
      if (i.ids) await tx.update(t.notifications).set({ readAt: now }).where(and(mine, inArray(t.notifications.id, i.ids.map(Number).filter((n) => Number.isInteger(n)))))
      else await tx.update(t.notifications).set({ readAt: now }).where(mine)
      return { ok: true }
    },
  }),
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
