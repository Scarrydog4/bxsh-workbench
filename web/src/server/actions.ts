import { AVATAR_FRAME_IDS, AVATAR_FRAME_NAMES, avatarFrame } from '@/shared/avatar-frames'
import { isStagedWriterPay, writerGroupDone } from '@/shared/writer-stages'
import { channelAccessible } from '@/shared/channel-access'
import { saveAvatar, saveOrderImage, privateImageUrl, orderImageHash } from './images'
import { canSeeAfterSale } from '@/shared/after-sale-access'
import { recordAfterSaleTime } from './aftersale-clock'
import sharp from 'sharp'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Tx } from './db'
import * as t from './schema'
import { loadWorld, nextOrderNo, type World } from './repo'
import { assignSuggestedOrderTitle } from './order-number-suggestion'
import { bad, deny, notFound } from './http'
import { broadcast } from './events'
import { uid } from './ids'
import { hashPassword, tempPassword } from './password'
import { revokeAllSessions, type Ctx } from './session'
import { ALL_PERMS, ADMIN_ONLY_PERMS, can, canAdjustDeadline, rowVisible } from '@/shared/perm'
import { deadlineFrom, iso, money, today } from '@/shared/format'
import { paymentSnapshot } from '@/shared/reconciliation'
import { CONFIRM_WINDOW, DEFAULT_DELIVERY } from '@/shared/as-rules'
import { allocationPolicyForDate, fixedAllocation, isFixedAllocation } from '@/shared/allocation'
import { allocationBase, cents, sumMoney } from '@/shared/calc'
import { writerPayAtRate } from '@/shared/writer-rates'
import { dueItems } from '@/shared/settle'
import type { Order, PermKey } from '@/shared/types'

// ---------- 小工具 ----------

type AuditIn = { action: string; objectType: string; objectId?: string; objectLabel?: string; field?: string; from?: string; to?: string; fieldGroup?: string; note?: string; proof?: string }

export async function log(tx: Tx, c: Ctx, e: AuditIn) {
  if (e.from !== undefined && e.to !== undefined && e.from === e.to) return
  await tx.insert(t.audit).values({ ...e, actorId: c.me.id, ip: c.ip })
}

const roleOf = (w: World, userId: string) => {
  const u = w.users.find((x) => x.id === userId)
  return u ? w.roles.find((r) => r.id === u.roleId) : undefined
}
export const isAdminUser = (w: World, userId: string) => !!roleOf(w, userId)?.locked
/** 能当「归属销售」：在用的管理员（自营）或能录单的人；写手不行 */
export const isSalesUser = (w: World, userId: string) => {
  const r = roleOf(w, userId)
  return !!r && !!w.users.find((u) => u.id === userId)?.active && (r.locked || r.perms.includes('order.create'))
}
/** 能被选为写手：在用、且打开了「可当写手」 */
export const isWriter = (w: World, userId: string) => !!w.users.find((u) => u.id === userId && u.active && u.canWrite)
/** 默认写手：系统设置里指定的那个人（还得是可当写手）；没设就取第一个不是管理员的写手 */
const defaultWriter = (w: World) => {
  const ok = w.users.filter((u) => isWriter(w, u.id))
  return ok.find((u) => u.id === w.defaultWriterId) ?? ok.find((u) => !isAdminUser(w, u.id)) ?? ok[0]
}

export function need(c: Ctx, perm: PermKey) {
  if (!can(c.role, perm)) throw deny()
}

/** 找到一单：不存在、已删除、不在可见范围内都当「找不到」，不泄露它存在 */
export function orderFor(w: World, c: Ctx, id: string, perm: PermKey): Order {
  const o = w.orders.find((x) => x.id === id && !x.deletedAt)
  if (!o || !rowVisible(o, c.me, c.role)) throw notFound()
  need(c, perm)
  return o
}

export function afterSaleOrderFor(w: World, c: Ctx, orderId: string, asId: string) {
  const o = w.orders.find(o => o.id === orderId)
  const a = o?.afterSales.find(a => a.id === asId)
  if (!o || !a || !canSeeAfterSale(o,a,c.me,c.role)) throw notFound()
  return o
}

export const dataImage = z
  .string()
  .max(1_500_000, '图片太大了')
  .refine((s) => /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s), '只能是图片')

export async function financialNote(tx: Tx, c: Ctx, orderId: string, note = '', proof?: string, required = !c.role.locked) {
  if (required && !note.trim() && !proof) throw bad('金额操作请填写备注或粘贴截图')
  return { note: note.trim(), proof: proof ? privateImageUrl(await saveOrderImage(tx, proof, { orderId, by: c.me.id, purpose: 'payment-proof' })) : undefined }
}

export const stamp = (ts: string) => {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式不对')

/** 凭证必须是这一单 / 这一轮已上传的图片，不能借用意见截图或别单附件。 */
async function requireDeliveryProof(tx: Tx, orderId: string, proofIds: string[], afterSaleId: string | null = null) {
  if (!proofIds.length) throw bad('请先附群内发稿截图')
  const ids = [...new Set(proofIds)]
  const files = await tx.select().from(t.attachments).where(and(inArray(t.attachments.id, ids), eq(t.attachments.orderId, orderId), isNull(t.attachments.deletedAt)))
  if (files.length !== ids.length || files.some(f => f.afterSaleId !== afterSaleId || f.purpose !== 'file' || !f.mime.startsWith('image/'))) throw bad('交付截图不属于这单或这一轮')
  for (const f of files) {
    const meta = await sharp(f.path).metadata().catch(() => null)
    if (!meta?.width || !meta.height) throw bad('交付截图无法读取，请重新上传图片')
  }
}
function needsDraft(status: string, o: Order) {
  if (status === o.status || status === '未交付' || status === '退单') return false
  return !o.draftAt
}

// ---------- 订单字段：权限、显示名、属于哪类字段（用来过滤「动态」） ----------

const FIELDS = {
  title: { label: '订单名称', perm: 'order.edit', group: null },
  orderDate: { label: '下单日期', perm: 'order.edit', group: null },
  dueDate: { label: '截止日期', perm: 'order.edit', group: null },
  progressNote: { label: '当前进度', perm: 'order.edit', group: null },
  channelId: { label: '渠道', perm: 'order.edit', group: null },
  channelNo: { label: '渠道单号', perm: 'order.edit', group: 'channelNo' },
  wechatGroup: { label: '微信群', perm: 'order.edit', group: null },
  type: { label: '订单类型', perm: 'order.edit', group: null },
  note: { label: '备注', perm: 'order.edit', group: null },
  basePrice: { label: '原价', perm: 'order.price', group: 'sales' },
  salesMode: { label: '结算方式', perm: 'order.price', group: 'sales' },
  status: { label: '订单状态', perm: 'order.status', group: null },
  ownerId: { label: '归属销售', perm: 'order.assign', group: null },
} as const satisfies Record<string, { label: string; perm: PermKey; group: string | null }>
type FieldKey = keyof typeof FIELDS

const COLUMN: Record<FieldKey, keyof typeof t.orders.$inferInsert> = {
  title: 'title',
  orderDate: 'orderDate',
  dueDate: 'dueDate',
  progressNote: 'progressNote',
  channelId: 'channelId',
  channelNo: 'channelNo',
  wechatGroup: 'wechatGroup',
  type: 'type',
  note: 'note',
  basePrice: 'basePrice',
  salesMode: 'salesMode',
  status: 'status',
  ownerId: 'ownerId',
}

function shown(w: World, k: FieldKey, v: unknown) {
  if (v === null || v === undefined || v === '') return '空'
  if (k === 'ownerId') return w.users.find((u) => u.id === v)?.name ?? String(v)
  if (k === 'channelId') return w.channels.find((c) => c.id === v)?.name ?? String(v)
  if (k === 'basePrice') return money(Number(v))
  if (k === 'salesMode') return v === 'cost' ? '底价结算' : '提成分成'
  return String(v)
}

async function addOption(tx: Tx, w: World, key: 'types' | 'payTags', value: string) {
  const list = key === 'types' ? w.types : w.payTags
  if (!value || list.includes(value)) return
  await tx
    .insert(t.options)
    .values({ key, values: [...list, value] })
    .onConflictDoUpdate({ target: t.options.key, set: { values: [...list, value] } })
}

const salesModeSchema = z.enum(['commission', 'cost'])
const writerRateSchema = z.number().min(0).max(1).multipleOf(.0001)
const writerRows = z.array(z.object({ userId: z.string(), pay: z.number().min(0).max(1_000_000).nullable(), rate: writerRateSchema.nullable().optional() })).max(10)

type WriterAmount = { userId: string; pay?: number | null; rate?: number | null }
const ratePay = writerPayAtRate
const orderAmount = allocationBase

/** 新制度只分一个写手工资池；一位写手自动计价，多位可在池内分配。 */
function fixedWriters(sales: number, writers: WriterAmount[], proportional = false): Order['assignees'] {
  if (sales < 0) throw bad('订单金额不能低于 0')
  if (!writers.length) return []
  const pool = cents(fixedAllocation(sales).writer)
  if (writers.length === 1) return [{ userId: writers[0].userId, pay: pool / 100 }]
  if (!proportional && writers.every(writer => writer.pay !== null && writer.pay !== undefined)) {
    if (writers.some(writer => !Number.isFinite(writer.pay) || Math.abs(writer.pay! * 100 - cents(writer.pay!)) > 0.00001)) throw bad('工资最多填写两位小数')
    if (writers.reduce((sum, writer) => sum + cents(writer.pay!), 0) !== pool) throw bad(`写手工资合计须为 ${money(pool / 100)}（订单金额的 20%）`)
    return writers.map(writer => ({ userId: writer.userId, pay: writer.pay! }))
  }
  const weights = proportional ? writers.map(writer => Math.max(0, cents(writer.pay ?? 0))) : writers.map(() => 1)
  const total = weights.reduce((sum, value) => sum + value, 0)
  let assigned = 0
  return writers.map((writer, index) => {
    const amount = index === writers.length - 1 ? pool - assigned : Math.floor(pool * (total ? weights[index] / total : 1 / writers.length))
    assigned += amount
    return { userId: writer.userId, pay: amount / 100 }
  })
}

/** 已发流水不重写；改价和改分配保留已发记录，草稿不占用。 */
function checkFixedCommitments(w: World, before: Order, after: Order) {
  const active = before.settlements.filter(line => line.status === '已确认')
  if (!active.length) return
  const admins = new Set(w.users.filter(user => isAdminUser(w, user.id)).map(user => user.id))
  for (const userId of new Set(active.filter(line => line.kind === '写手工资').map(line => line.payeeId))) {
    const committed = sumMoney(active.filter(line => line.kind === '写手工资' && line.payeeId === userId).map(line => line.amount))
    const due = sumMoney(dueItems(after, '写手工资', userId, admins, true).map(item => item.amount))
    if (cents(committed) > cents(due)) throw bad(`${w.users.find(user => user.id === userId)?.name ?? '写手'}已有已发金额，不能降低可发工资或移除写手`)
  }
  const salesCommitted = sumMoney(active.filter(line => line.kind === '销售提成').map(line => line.amount))
  if (isFixedAllocation(after) && cents(salesCommitted) > cents(fixedAllocation(orderAmount(after)).sales)) throw bad('已有销售提成已发金额，不能降低订单金额')
}

async function saveFixedWriters(tx: Tx, c: Ctx, before: Order, writers: Order['assignees']) {
  if (JSON.stringify(before.assignees) === JSON.stringify(writers)) return
  await tx.delete(t.orderWriters).where(eq(t.orderWriters.orderId, before.id))
  if (writers.length) await tx.insert(t.orderWriters).values(writers.map((writer, sort) => ({ orderId: before.id, ...writer, sort })))
  await log(tx, c, { action: '修改', objectType: 'order', objectId: before.id, objectLabel: before.no, field: '写手与工资', from: before.assignees.map(writer => `${writer.userId} ${money(writer.pay ?? 0)}`).join('、'), to: writers.map(writer => `${writer.userId} ${money(writer.pay ?? 0)}`).join('、'), fieldGroup: 'writerPay', note: before.writerRatesEnabled ? '按本单约定比例计算' : '按新制度 20% 自动计算' })
}

export async function syncFixedAmount(tx: Tx, c: Ctx, w: World, before: Order, after: Order, checkPaid = true) {
  if (sumMoney([after.basePrice, ...after.adjustments.filter(a => !a.revoked).map(a => a.amount)]) < 0) throw bad('订单金额不能低于 0')
  if (after.writerRatesEnabled) {
    const writers = before.assignees.map(writer => ({ ...writer, pay: writer.rate == null ? writer.pay : ratePay(orderAmount(after), writer.rate) }))
    if (checkPaid) checkFixedCommitments(w, before, { ...after, assignees: writers })
    await saveFixedWriters(tx, c, before, writers)
    return
  }
  if (!isFixedAllocation(after)) return
  if (after.afterSales.some(sale => sale.extra > 0)) throw bad('请先处理原追加工资，再切换新制度分成')
  const writers = fixedWriters(orderAmount(after), before.assignees, true)
  if (checkPaid) checkFixedCommitments(w, before, { ...after, assignees: writers })
  await saveFixedWriters(tx, c, before, writers)
}

// ---------- 动作表 ----------

export interface Action<S extends z.ZodType> {
  schema: S
  /** 不改业务数据的动作（记一笔「查看」「导出」）不广播，免得所有人都去重新拉数据 */
  quiet?: boolean
  run: (tx: Tx, c: Ctx, w: World, input: z.infer<S>) => Promise<unknown>
}
export const act = <S extends z.ZodType>(a: Action<S>) => a


async function setOrderWriters(tx:Tx,c:Ctx,w:World,i:{id:string;writers:WriterAmount[]}) {
      // 能改订单基础信息的（销售）就能选写手；工资只有看得到写手工资的人能改，下面单独卡
      const o = orderFor(w, c, i.id, 'order.edit')
      const ids = i.writers.map((x) => x.userId)
      if (new Set(ids).size !== ids.length) throw bad('同一个写手不能加两次')
      for (const a of i.writers) {
        // 迁移来的历史单可能写手不在「可当写手」名单里（或已停用），保留原有的；新加的必须在名单里
        if (!isWriter(w, a.userId) && !o.assignees.some((x) => x.userId === a.userId)) throw bad('写手只能从「可当写手」的账号里选')
      }
      if (!can(c.role, 'order.assign')) {
        const paid = o.assignees.find(a => !ids.includes(a.userId) && o.settlements.some(x => x.kind === '写手工资' && x.payeeId === a.userId && x.status === '已确认'))
        if (paid) throw deny(`${w.users.find(u => u.id === paid.userId)?.name ?? '这位写手'}已经发过工资，换人请找管理员`)
      }
      const active = o.afterSales.find(a => !a.doneAt && !a.cancelledAt && !ids.includes(a.writerId))
      if (active) throw bad(`第 ${active.round} 轮跟进仍由原写手负责，请先在跟进里更换负责人，再移除写手`)
      const ratesEnabled = !!o.writerRatesEnabled || i.writers.some(a => a.rate !== undefined)
      let writers = i.writers.map(a => {
        const previous = o.assignees.find(x => x.userId === a.userId)
        if (!c.role.locked && (a.rate !== undefined || a.pay !== undefined && a.pay !== (previous?.pay ?? null))) throw deny('只有老板能修改写手比例和工资')
        const visible = c.role.locked || c.role.fields.writerPay === 'all' || (c.role.fields.writerPay === 'own' && a.userId === c.me.id)
        if (!visible && a.pay !== undefined && a.pay !== (previous?.pay ?? null)) throw deny('不能修改不可见的工资')
        if (ratesEnabled) {
          const rate = a.rate !== undefined ? a.rate : previous ? previous.rate ?? null : w.users.find(u => u.id === a.userId)?.writerRate ?? .2
          return { userId: a.userId, rate, pay: rate === null ? a.pay === undefined || !visible ? previous?.pay ?? null : a.pay : ratePay(orderAmount(o), rate) }
        }
        return { userId: a.userId, pay: a.pay === undefined || !visible ? previous?.pay ?? null : a.pay }
      })
      if (isFixedAllocation(o) && !ratesEnabled) {
        writers = fixedWriters(orderAmount(o), writers)
        checkFixedCommitments(w, o, { ...o, assignees: writers })
      }
      if (ratesEnabled) checkFixedCommitments(w, o, { ...o, writerRatesEnabled: true, assignees: writers })
      if (JSON.stringify(writers) === JSON.stringify(o.assignees) && ratesEnabled === !!o.writerRatesEnabled) return { ok: true }
      const fmt = (a: { userId: string; pay: number | null }[]) => a.map((x) => `${w.users.find((u) => u.id === x.userId)?.name} ${x.pay === null ? '工资未定' : money(x.pay)}`).join('、') || '空'
      await tx.delete(t.orderWriters).where(eq(t.orderWriters.orderId, o.id))
      if (writers.length) await tx.insert(t.orderWriters).values(writers.map((x, k) => ({ orderId: o.id, userId: x.userId, pay: x.pay, rate: x.rate, sort: k })))
      if (ratesEnabled && !o.writerRatesEnabled) await tx.update(t.orders).set({ writerRatesEnabled: true }).where(eq(t.orders.id, o.id))
      await log(tx, c, { action: '修改', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '写手与工资', from: fmt(o.assignees), to: fmt(writers), fieldGroup: 'writerPay' })
      const rates = (rows: WriterAmount[]) => rows.map(row => `${w.users.find(u => u.id === row.userId)?.name} ${row.rate == null ? '按金额' : `${Number((row.rate * 100).toFixed(2))}%`}`).join('、') || '空'
      await log(tx, c, { action: '修改', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '写手比例', from: rates(o.assignees), to: rates(writers), fieldGroup: 'writerRate' })
      return { ok: true }
}
export const ACTIONS = {
  'order.create': act({
    schema: z.object({
      title: z.string().trim().min(1, '订单名称必填').max(200),
      suggestedNumber: z.string().trim().max(30).optional(),
      orderDate: isoDate,
      dueDate: isoDate.nullable(),
      ownerId: z.string(),
      channelId: z.string().optional(),
      salesMode: salesModeSchema.optional(),
      channelNo: z.string().max(100).default(''),
      type: z.string().max(50).default(''),
      basePrice: z.number().min(0).max(10_000_000),
      assignees: writerRows.optional(),
      note: z.string().max(5000).default(''),
      via: z.string().max(20).optional(),
      urgent: z.boolean().default(false),
      urgencyNote: z.string().trim().max(500).default(''),
    }),
    run: async (tx, c, w, i) => {
      need(c, 'order.create')
      const admin = can(c.role, 'order.assign')
      const ownerId = admin ? i.ownerId : c.me.id
      if (!isSalesUser(w, ownerId)) throw bad('归属销售只能是管理员或销售')
      const owner = w.users.find((u) => u.id === ownerId)!
      const salesMode = i.salesMode ?? owner.salesMode ?? 'commission'
      const allocationPolicy = allocationPolicyForDate(iso(today()))
      if (!c.role.locked && allocationPolicy === 'fixed_60_20_20_v1' && salesMode !== (owner.salesMode ?? 'commission')) throw deny('新制度结算方式由管理员调整')
      const ch = i.channelId ? w.channels.find((x) => x.id === i.channelId && !x.deletedAt) : undefined
      if (i.channelId && (!ch || !channelAccessible(ch, c.me, c.role))) throw notFound()
      if (!ch && salesMode !== 'cost') throw bad('提成分成订单必须选择渠道')
      // 员工可选写手，比例和工资由服务端带入；只有老板能明确覆盖。
      const pick = admin || can(c.role, 'order.edit')
      const payVisible = c.role.locked || c.role.fields.writerPay === 'all'
      if (!c.role.locked && i.assignees?.some(a => a.rate !== undefined || a.pay != null)) throw deny('只有老板能修改写手比例和工资')
      let writers: Order['assignees'] = pick ? (i.assignees ?? []).map(a => ({ userId: a.userId, pay: c.role.locked && payVisible ? a.pay : null, ...(a.rate !== undefined ? { rate: a.rate } : {}) })) : []
      for (const a of writers) if (!isWriter(w, a.userId)) throw bad('写手只能从「可当写手」的账号里选')
      // 能选写手时，显式空数组表示不指定；未传或不能选仍使用默认写手。
      if (!pick || i.assignees === undefined) {
        const d = defaultWriter(w)
        if (d) writers = [{ userId: d.id, pay: null }]
      }
      if (new Set(writers.map(writer => writer.userId)).size !== writers.length) throw bad('同一个写手不能加两次')
      writers = writers.map(writer => {
        const rate = writer.rate !== undefined ? writer.rate : writer.pay != null ? null : w.users.find(u => u.id === writer.userId)?.writerRate ?? .2
        return { ...writer, rate, pay: rate === null ? writer.pay : ratePay(i.basePrice, rate) }
      })
      const title = i.suggestedNumber ? await assignSuggestedOrderTitle(tx, owner, i.orderDate, i.title, i.suggestedNumber) : i.title
      const no = await nextOrderNo(tx, i.orderDate)
      const id = uid('o')
      await tx.insert(t.orders).values({
        id,
        no,
        title,
        orderDate: i.orderDate,
        dueDate: i.dueDate || deadlineFrom(i.orderDate),
        ownerId,
        creatorId: c.me.id,
        channelId: ch?.id ?? null,
        salesMode,
        allocationPolicy,
        writerRatesEnabled: true,
        channelNo: i.channelNo,
        wechatGroup: '',
        type: i.type,
        basePrice: i.basePrice,
        status: '未交付',
        urgency: i.urgent ? { note: i.urgencyNote, at: new Date().toISOString(), by: c.me.id } : null,
        note: i.note,
        commissionRate: allocationPolicy === 'fixed_60_20_20_v1' ? .2 : owner.commissionRate,
        writerPayPlan: 'completed_balance_50_50',
      })
      if (writers.length) await tx.insert(t.orderWriters).values(writers.map((x, k) => ({ orderId: id, userId: x.userId, pay: x.pay, rate: x.rate, sort: k })))
      await addOption(tx, w, 'types', i.type)
      await log(tx, c, { action: i.via ?? '新建', objectType: 'order', objectId: id, objectLabel: no, to: title })
      return { id, no, title }
    },
  }),

  'order.update': act({
    schema: z.object({
      id: z.string(),
      reason: z.string().trim().max(500).default(''),
      proof: dataImage.optional(),
      patch: z
        .object({
          title: z.string().trim().min(1).max(200),
          orderDate: isoDate,
          dueDate: z.iso.date({ error: '日期格式不对' }).nullable(),
          channelId: z.string(),
          channelNo: z.string().max(100),
          wechatGroup: z.string().max(100),
          type: z.string().max(50),
          note: z.string().max(5000),
          progressNote: z.string().trim().min(1).max(500),
          basePrice: z.number().min(0).max(10_000_000),
          salesMode: salesModeSchema,
          status: z.string(),
          ownerId: z.string(),
        })
        .partial(),
    }),
    run: async (tx, c, w, i) => {
      const keys = Object.keys(i.patch) as FieldKey[]
      if (!keys.length) return { ok: true }
      let o: Order | undefined
      for (const k of keys) {
        if ((k === 'dueDate' || k === 'progressNote') && !can(c.role, 'order.edit')) {
          o = orderFor(w, c, i.id, 'order.draft')
          if (!canAdjustDeadline(o, c.me, c.role)) throw deny('只能更新自己负责订单的进度和交付日期')
        } else o = orderFor(w, c, i.id, FIELDS[k].perm)
      }
      if (!o) throw notFound()
      const p = i.patch
      if (p.channelId !== undefined && p.channelId !== o.channelId && o.payments.some(payment => payment.receiptId && !payment.revoked)) throw bad('这单已分配渠道收款，请先在渠道收款记录中撤销整笔，再更改渠道')
      const changingMode = p.salesMode !== undefined && p.salesMode !== (o.salesMode ?? 'commission')
      if (changingMode && o.allocationPolicy === 'fixed_60_20_20_v1' && !c.role.locked) throw deny('新制度结算方式由管理员调整')
      const priceNote = (p.basePrice !== undefined && p.basePrice !== o.basePrice) || changingMode ? await financialNote(tx, c, o.id, i.reason, i.proof) : {}
      if (p.dueDate === null) throw bad('截止日期必填')
      if (p.dueDate !== undefined && p.dueDate !== o.dueDate && !c.role.locked && o.assignees.some(a => a.userId === c.me.id) && !i.reason) throw bad('调整交付日期请填写原因备注')
      if (p.status !== undefined && !w.statuses.includes(p.status)) throw bad('没有这个订单状态')
      if (p.ownerId !== undefined && !isSalesUser(w, p.ownerId)) throw bad('归属销售只能是管理员或销售')
      const salesMode = p.salesMode ?? o.salesMode ?? 'commission'
      if (changingMode && o.settlements.some(x => x.kind === '销售提成' && x.status !== '已作废')) throw bad('这单已有销售提成结算，请先处理原结算，再更改结算方式')
      if (p.channelId !== undefined || changingMode) {
        const channelId = p.channelId ?? o.channelId
        if (!channelId && salesMode !== 'cost') throw bad('提成分成订单必须选择渠道')
        if (channelId && !w.channels.some(x => x.id === channelId && !x.deletedAt && channelAccessible(x, c.me, c.role))) throw notFound()
      }
      if ((p.basePrice !== undefined && p.basePrice !== o.basePrice) || changingMode) {
        await syncFixedAmount(tx, c, w, o, { ...o, ...p })
      }
      const set: Partial<typeof t.orders.$inferInsert> = { updatedAt: new Date().toISOString() }
      for (const k of keys) {
        const old = (o as unknown as Record<string, unknown>)[k]
        const val = p[k]
        if (old === val) continue
        ;(set as Record<string, unknown>)[COLUMN[k]] = k === 'channelId' && val === '' ? null : val
        await log(tx, c, { action: '修改', objectType: 'order', objectId: o.id, objectLabel: o.no, field: FIELDS[k].label, from: shown(w, k, old), to: shown(w, k, val), fieldGroup: FIELDS[k].group ?? undefined, ...(k === 'dueDate' ? { note: i.reason } : {}), ...(['basePrice', 'salesMode'].includes(k) ? priceNote : {}) })
      }
      if (Object.keys(set).length === 1) return { ok: true }
      if (p.status && needsDraft(p.status, o)) throw bad('请先点「交付」附群内发稿截图并确认')
      if (p.type) await addOption(tx, w, 'types', p.type)
      await tx.update(t.orders).set(set).where(eq(t.orders.id, o.id))
      return { ok: true }
    },
  }),

  'order.bulkStatus': act({
    schema: z.object({ ids: z.array(z.string()).min(1).max(500), status: z.string() }),
    run: async (tx, c, w, i) => {
      if (!w.statuses.includes(i.status)) throw bad('没有这个订单状态')
      let n = 0
      for (const id of i.ids) {
        const o = orderFor(w, c, id, 'order.status')
        if (o.status === i.status) continue
        const set: Partial<typeof t.orders.$inferInsert> = { status: i.status, updatedAt: new Date().toISOString() }
        if (needsDraft(i.status, o)) throw bad(`${o.title} 还没有交付截图，请先确认交付`)
        await tx.update(t.orders).set(set).where(eq(t.orders.id, id))
        await log(tx, c, { action: '修改', objectType: 'order', objectId: id, objectLabel: o.no, field: '订单状态', from: o.status, to: i.status })
        n++
      }
      return { count: n }
    },
  }),

  'order.setWriters': act({
    schema: z.object({ id: z.string(), writers: z.array(z.object({ userId: z.string(), pay: z.number().min(0).max(1_000_000).nullable().optional(), rate: writerRateSchema.nullable().optional() })).max(10) }),
    run: setOrderWriters,
  }),

  'order.bulkWriters': act({
    schema:z.object({ids:z.array(z.string()).min(1).max(500),writerId:z.string()}),
    run:async(tx,c,w,i)=>{
      if(!isWriter(w,i.writerId))throw bad('请选择可当写手的账号')
      let count=0
      for(const id of new Set(i.ids)){
        const o=orderFor(w,c,id,'order.assign'),previous=o.assignees.find(a=>a.userId===i.writerId)
        await setOrderWriters(tx,c,w,{id,writers:[{userId:i.writerId,...(previous?{}:{pay:isAdminUser(w,i.writerId)?0:null})}]})
        if(o.assignees.length!==1||!previous)count++
      }
      return {count}
    },
  }),

  'order.addAdjustment': act({
    schema: z.object({ id: z.string(), amount: z.number().refine((n) => n !== 0, '金额不能为 0').refine((n) => Math.abs(n) <= 1_000_000), reason: z.string().trim().max(500).default(''), proof: dataImage.optional() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.id, 'order.price')
      await syncFixedAmount(tx, c, w, o, { ...o, basePrice: sumMoney([o.basePrice, i.amount]) })
      const memo = await financialNote(tx, c, o.id, i.reason, i.proof, true)
      await tx.insert(t.adjustments).values({ id: uid('adj'), orderId: o.id, amount: i.amount, reason: i.reason || '见截图', at: iso(today()), by: c.me.id })
      await log(tx, c, { action: i.amount > 0 ? '追加' : '减免', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '追加 / 减免', from: '', to: money(i.amount), fieldGroup: 'sales', ...memo })
      return { ok: true }
    },
  }),

  'order.checkPayment': act({
    schema: z.object({ id: z.string(), checked: z.boolean(), snapshot: z.string().max(100000) }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.id, 'payment.create')
      if (!c.role.locked && !c.role.fields.sales) throw deny('当前账号不能核对收款')
      if (o.status === '退单') throw bad('退单不在收款核对范围内')
      const snapshot = paymentSnapshot(o)
      if (i.checked && i.snapshot !== snapshot) throw bad('金额或流水刚有变化，请刷新后重新核对')
      await tx.update(t.orders).set({ paymentCheckedAt: i.checked ? new Date().toISOString() : null, paymentCheckedBy: i.checked ? c.me.id : null, paymentCheckedSnapshot: i.checked ? snapshot : null }).where(eq(t.orders.id, o.id))
      await log(tx, c, { action: i.checked ? '核对收款' : '撤回收款核对', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '收款核对', to: i.checked ? '已核对' : '待核对', fieldGroup: 'sales' })
      return { ok: true }
    },
  }),

  'order.addPayment': act({
    schema: z.object({ id: z.string(), amount: z.number().positive('金额要大于 0').max(10_000_000), date: isoDate, tag: z.string().trim().min(1).max(20), note: z.string().max(500).default(''), proof: dataImage.optional(), requestId: z.string().uuid().optional() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.id, 'payment.create')
      const id = i.requestId ? `pay_${i.requestId}` : uid('pay')
      if (i.requestId) {
        const [previous] = await tx.select().from(t.payments).where(eq(t.payments.id, id))
        if (previous) {
          let sameProof = previous.proof === (i.proof ?? null)
          if (!sameProof && i.proof && previous.proof?.startsWith('/api/files/')) {
            const fileId = previous.proof.split('/')[3].split('?')[0]
            const [file] = await tx.select().from(t.attachments).where(eq(t.attachments.id,fileId))
            sameProof = !!file?.path.endsWith(`/${orderImageHash(i.proof)}.webp`)
          }
          if (previous.orderId !== o.id || previous.by !== c.me.id || previous.amount !== i.amount || previous.date !== i.date || previous.tag !== i.tag || previous.note !== i.note || !sameProof) throw bad('这次收款已处理，不能用同一请求修改金额或内容')
          if (previous.revokedAt) throw bad('这笔收款已经撤销，请重新登记')
          return { ok: true }
        }
      }
      const memo = await financialNote(tx, c, o.id, i.note, i.proof)
      await tx.insert(t.payments).values({ id, orderId: o.id, amount: i.amount, date: i.date, tag: i.tag, note: i.note, by: c.me.id, proof: memo.proof ?? null })
      await addOption(tx, w, 'payTags', i.tag)
      await log(tx, c, { action: '记收款', objectType: 'order', objectId: o.id, objectLabel: o.no, field: i.tag, from: '', to: money(i.amount), fieldGroup: 'sales', ...memo })
      return { ok: true }
    },
  }),

  /** 撤销记错的收款：只有管理员，原因必填；记录保留，不再计入已收 */
  'order.revokePayment': act({
    schema: z.object({ id: z.string(), paymentId: z.string(), reason: z.string().trim().min(1, '撤销原因必填').max(200) }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('只有管理员能撤销收款')
      const o = orderFor(w, c, i.id, 'payment.create')
      const p = o.payments.find((x) => x.id === i.paymentId)
      if (!p) throw notFound()
      if (p.receiptId) throw bad('这笔属于渠道收款，请到渠道收款记录撤销整笔')
      if (p.revoked) throw bad('这笔已经撤销过了')
      await tx.update(t.payments).set({ revokedAt: new Date().toISOString(), revokedBy: c.me.id, revokeReason: i.reason }).where(eq(t.payments.id, p.id))
      await log(tx, c, { action: '撤销收款', objectType: 'order', objectId: o.id, objectLabel: o.no, field: p.tag, from: `${money(p.amount)}（${p.date}）`, to: `已撤销：${i.reason}`, fieldGroup: 'sales' })
      return { ok: true }
    },
  }),

  /** 撤销记错的追加 / 减免：只有管理员，原因必填；记录保留，不再计入销售额 */
  'order.revokeAdjustment': act({
    schema: z.object({ id: z.string(), adjustmentId: z.string(), reason: z.string().trim().min(1, '撤销原因必填').max(200) }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('只有管理员能撤销追加 / 减免')
      const o = orderFor(w, c, i.id, 'order.price')
      const a = o.adjustments.find((x) => x.id === i.adjustmentId)
      if (!a) throw notFound()
      if (a.revoked) throw bad('这笔已经撤销过了')
      await syncFixedAmount(tx, c, w, o, { ...o, basePrice: sumMoney([o.basePrice, -a.amount]) })
      await tx.update(t.adjustments).set({ revokedAt: new Date().toISOString(), revokedBy: c.me.id, revokeReason: i.reason }).where(eq(t.adjustments.id, a.id))
      await log(tx, c, { action: a.amount > 0 ? '撤销追加' : '撤销减免', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '追加 / 减免', from: `${money(a.amount)} ${a.reason}`, to: `已撤销：${i.reason}`, fieldGroup: 'sales' })
      return { ok: true }
    },
  }),

  'order.markDraft': act({
    schema: z.object({ id: z.string(), proofIds: z.array(z.string()).max(20).default([]), mode: z.enum(['delivery', 'demo']).default('delivery') }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.id, 'order.draft')
      if (!c.role.locked && !o.assignees.some((a) => a.userId === c.me.id)) throw deny('只能报自己写的单')
      if (o.status === '退单') throw bad('退单不能交付')
      if (o.afterSales.some(a => !a.doneAt && !a.cancelledAt && (c.role.locked || a.writerId === c.me.id))) throw bad('这单正在跟进，请在跟进里点「交付本次跟进」')
      await requireDeliveryProof(tx, o.id, i.proofIds)
      if (i.mode === 'demo') {
        if (!['未交付', '已发演示'].includes(o.status)) throw bad('当前状态不能改为已发演示，请保留正式交付记录')
        if (o.status === '已发演示') return { ok: true }
        // 演示只记录状态；不写首次正式交付时间、写作进度或任何结算记录。
        await tx.update(t.orders).set({ status: '已发演示', updatedAt: new Date().toISOString() }).where(eq(t.orders.id, o.id))
        await log(tx, c, { action: '发演示', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '订单状态', from: o.status, to: '已发演示' })
        return { ok: true }
      }
      if (o.draftAt && o.status === '已交付') return { ok: true }
      // 交付和工资脱钩：分期单也一次交付，同时补齐写作进度，旧数据口径保持一致。
      if (isStagedWriterPay(o)) {
        const now = new Date().toISOString()
        const who = c.role.locked ? o.assignees.map(a => a.userId) : [c.me.id]
        for (const userId of who) await tx.insert(t.writerProgress).values({ orderId: o.id, userId, completedAt: now, completedProofIds: i.proofIds, groupSentAt: now, groupProofIds: i.proofIds })
          .onConflictDoUpdate({ target: [t.writerProgress.orderId, t.writerProgress.userId], set: { completedAt: sql`coalesce(${t.writerProgress.completedAt}, ${now})`, groupSentAt: now, groupProofIds: i.proofIds } })
        const progress = [...(o.writerProgress ?? []).filter(p => !who.includes(p.userId)), ...who.map(userId => ({ userId, completedAt: now, completedProofIds: i.proofIds, groupSentAt: now, groupProofIds: i.proofIds }))]
        if (!writerGroupDone({ ...o, writerProgress: progress })) {
          await log(tx, c, { action: '交付订单', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '写作进度', to: `${c.me.name} 已交付` })
          return { ok: true }
        }
      }
      const next = '已交付'
      // 旧版确认初稿只标为已发演示；补正状态时保留首次交付时间和工资归期。
      await tx.update(t.orders).set({ draftAt: o.draftAt ?? new Date().toISOString(), status: next, updatedAt: new Date().toISOString() }).where(eq(t.orders.id, o.id))
      await log(tx, c, { action: '交付订单', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '订单状态', from: o.status, to: next })
      return { ok: true }
    },
  }),

  'order.delete': act({
    schema: z.object({ ids: z.array(z.string()).min(1).max(500) }),
    run: async (tx, c, w, i) => {
      for (const id of i.ids) {
        const o = orderFor(w, c, id, 'order.delete')
        await tx.update(t.orders).set({ deletedAt: new Date().toISOString() }).where(eq(t.orders.id, id))
        await log(tx, c, { action: '删除', objectType: 'order', objectId: id, objectLabel: o.no, to: '移入回收站' })
      }
      return { ok: true }
    },
  }),

  'order.restore': act({
    schema: z.object({ ids: z.array(z.string()).min(1).max(500) }),
    run: async (tx, c, w, i) => {
      if (!can(c.role, 'trash.view') && !can(c.role, 'order.delete')) throw deny()
      for (const id of i.ids) {
        const o = w.orders.find((x) => x.id === id)
        // 和其他写操作一样：范围外的单当不存在
        if (!o || !rowVisible(o, c.me, c.role)) throw notFound()
        if (!o.deletedAt) continue
        await tx.update(t.orders).set({ deletedAt: null }).where(eq(t.orders.id, id))
        await log(tx, c, { action: '恢复', objectType: 'order', objectId: id, objectLabel: o.no })
      }
      return { ok: true }
    },
  }),

  'order.clearReview': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('只有管理员能核对迁移数据')
      const o = orderFor(w, c, i.id, 'order.view')
      if (!o.reviewFlag) return { ok: true }
      await tx.update(t.orders).set({ reviewFlag: null }).where(eq(t.orders.id, o.id))
      await log(tx, c, { action: '核对', objectType: 'order', objectId: o.id, objectLabel: o.no, from: o.reviewFlag, to: '已核对' })
      return { ok: true }
    },
  }),

  'attachment.remove': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      const [f] = await tx.select().from(t.attachments).where(and(eq(t.attachments.id, i.id), isNull(t.attachments.deletedAt)))
      if (!f) throw notFound()
      const o = orderFor(w, c, f.orderId, 'order.view')
      if (f.by !== c.me.id && !can(c.role, 'order.edit')) throw deny('只能删自己传的文件')
      if (o.writerProgress?.some(progress => progress.completedProofIds.includes(f.id) || progress.groupProofIds.includes(f.id))) throw bad('这张截图已用于确认写作进度，不能删除')
      await tx.update(t.attachments).set({ deletedAt: new Date().toISOString() }).where(eq(t.attachments.id, f.id))
      await log(tx, c, { action: '删除附件', objectType: 'order', objectId: o.id, objectLabel: o.no, from: f.name, to: '' })
      return { ok: true }
    },
  }),

  // ---------- 售后 ----------

  'aftersale.create': act({
    schema: z.object({
      orderId: z.string(),
      reason: z.enum(['正常修改', '写手返工', '新增需求']).default('正常修改'),
      req: z.array(z.string().trim().min(1).max(500)).max(50),
      shots: z.array(dataImage).max(9).default([]),
      due: z.string().datetime({ offset: true }).optional(),
      extra: z.number().min(0).max(100_000).default(0),
      writerId: z.string().optional(),
    }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'aftersale.create')
      if (!i.req.length && !i.shots.length) throw bad('粘贴要求或截图，至少有一样')
      if (o.afterSales.some((a) => !a.doneAt && !a.cancelledAt)) throw bad('上一轮还没改完，改完再开下一轮')
      // 定性影响工资：只有管理员能直接开成返工 / 新增需求，追加工资也只有能定工资的人能填
      if (i.reason !== '正常修改') need(c, 'aftersale.reason')
      if (i.extra > 0 && (i.reason !== '新增需求' || !can(c.role, 'order.assign'))) throw deny('追加工资只有管理员能定')
      if (isFixedAllocation(o) && i.extra > 0) throw bad('追加需求请调整订单金额，工资按本单约定自动计算')
      const writerId = i.writerId ?? o.assignees[0]?.userId
      if (!writerId) throw bad('这单还没有写手')
      if (!o.assignees.some((a) => a.userId === writerId)) {
        if (o.assignees.length) throw bad('负责人只能是这单的写手')
        // 空写手订单可在发布售后时一起分配；同一事务内完成，发布失败不留下分配。
        await setOrderWriters(tx, c, w, { id: o.id, writers: [{ userId: writerId }] })
      }
      const id = uid('as')
      const round = o.afterSales.length + 1
      if (o.status === '退单') throw bad('退单不能登记修改任务')
      const now = Date.now()
      const start = new Date(now).toISOString()
      const selfConfirm = writerId === c.me.id && !!i.due
      if (selfConfirm && new Date(i.due!).getTime() <= now) throw bad('预计完成时间必须在当前时间之后')
      await tx.insert(t.afterSales).values({ id, orderId: o.id, round, reason: i.reason, req: i.req, shots: [], start,
        due: selfConfirm ? new Date(i.due!).toISOString() : new Date(now + DEFAULT_DELIVERY).toISOString(),
        confirmBy: new Date(now + CONFIRM_WINDOW).toISOString(), confirmedAt: selfConfirm ? start : null,
        writerId, by: c.me.id, extra: i.extra })
      const shots: string[] = []
      for (const shot of i.shots) shots.push(await saveOrderImage(tx,shot,{orderId:o.id,afterSaleId:id,by:c.me.id,purpose:'aftersale-shot'}))
      if (shots.length) await tx.update(t.afterSales).set({shots}).where(eq(t.afterSales.id,id))
      await log(tx, c, { action: '开一轮修改', objectType: 'order', objectId: o.id, objectLabel: o.no, field: `第 ${round} 轮 · ${i.reason}`, from: '', to: i.req.join('；') || '见截图' })
      return { id, round }
    },
  }),

  'aftersale.confirm': act({
    schema: z.object({ orderId: z.string(), asId: z.string(), due: z.string().datetime({ offset: true }).optional(), hours: z.number().refine(n => [2,4,8,12,24].includes(n)).optional() }).refine(i => !!i.due || !!i.hours, '请选择完成时长'),
    run: async (tx, c, w, i) => {
      const o = afterSaleOrderFor(w, c, i.orderId, i.asId)
      const a = o.afterSales.find((x) => x.id === i.asId)
      if (!a || a.cancelledAt || a.doneAt || o.status === '退单') throw bad('这项修改任务已结束')
      if (a.writerId !== c.me.id) throw deny('只有负责的写手能确认完成时间')
      if (!a.confirmBy) throw bad('这项历史任务已有截止时间')
      const now = Date.now()
      const expired = now >= new Date(a.confirmBy).getTime()
      const due = expired ? a.due : i.hours ? new Date(now + i.hours * 3600_000).toISOString() : new Date(i.due!).toISOString()
      if (a.confirmedAt) {
        if (i.hours === a.chosenHours || new Date(a.due).getTime() === new Date(due).getTime()) return { ok: true }
        throw bad('已经确认过完成时间，请勿重复提交不同时间')
      }
      if (expired && i.due && new Date(i.due).getTime() !== new Date(a.due).getTime()) throw bad('已超过 1 小时，按发布后的默认截止时间交付，请刷新后确认')
      if (!expired && new Date(due).getTime() <= now) throw bad('预计完成时间必须在当前时间之后')
      await recordAfterSaleTime(tx,w,o,a,new Date(now))
      await tx.update(t.afterSales).set({ due, chosenHours: expired ? 24 : i.hours ?? null, confirmedAt: new Date(now).toISOString() }).where(eq(t.afterSales.id, a.id))
      await log(tx, c, { action: expired ? '确认默认交付时间' : '确认完成时间', objectType: 'order', objectId: o.id, objectLabel: o.no, field: `第 ${a.round} 轮修改`, to: due })
      return { ok: true }
    },
  }),

  'aftersale.finish': act({
    schema: z.object({ orderId: z.string(), asId: z.string(), proofIds: z.array(z.string()).max(20).default([]) }),
    run: async (tx, c, w, i) => {
      const o = afterSaleOrderFor(w, c, i.orderId, i.asId)
      const a = o.afterSales.find((x) => x.id === i.asId)
      if (!a || a.cancelledAt) throw notFound()
      if (a.writerId !== c.me.id && !c.role.locked) throw deny('只有负责的写手能点「已改完」')
      await requireDeliveryProof(tx, o.id, i.proofIds, a.id)
      if (a.doneAt) return { ok: true }
      const now = new Date()
      await recordAfterSaleTime(tx,w,o,a,now)
      const late = Math.max(0,Math.ceil((now.getTime()-new Date(a.due).getTime())/60_000))
      await tx.update(t.afterSales).set({ doneAt: now.toISOString(), deliveredLateMin:late }).where(eq(t.afterSales.id, a.id))
      await log(tx, c, { action: '已交付本次售后', to: late ? `逾期 ${late} 分钟` : '按时交付', objectType: 'order', objectId: o.id, objectLabel: o.no, field: `第 ${a.round} 轮修改` })
      return { ok: true }
    },
  }),

  'aftersale.recall': act({
    schema: z.object({orderId:z.string(),asId:z.string()}),
    run: async(tx,c,w,i) => {
      const o = afterSaleOrderFor(w,c,i.orderId,i.asId)
      const a = o.afterSales.find(a=>a.id===i.asId)!
      if (a.by !== c.me.id && !c.role.locked) throw deny('只有发单人或管理员可以撤回')
      if (a.confirmedAt || a.doneAt || a.cancelledAt) throw bad('已经确认或交付，不能撤回')
      await tx.update(t.afterSales).set({cancelledAt:new Date().toISOString(),extra:0}).where(eq(t.afterSales.id,a.id))
      await log(tx,c,{action:'撤回售后',objectType:'order',objectId:o.id,objectLabel:o.no,field:`第 ${a.round} 轮修改`})
      return {ok:true}
    },
  }),

  'aftersale.nudge': act({
    schema: z.object({ orderId: z.string(), asId: z.string() }),
    run: async (tx, c, w, i) => {
      need(c, 'aftersale.create')
      const o = afterSaleOrderFor(w, c, i.orderId, i.asId)
      const a = o.afterSales.find((x) => x.id === i.asId)
      if (!a || a.cancelledAt || a.doneAt) throw bad('这一轮已经结束了')
      if (a.writerId === c.me.id) throw bad('不用催自己')
      await tx.update(t.afterSales).set({ nudges: a.nudges + 1 }).where(eq(t.afterSales.id, a.id))
      await log(tx, c, { action: '催一下', objectType: 'order', objectId: o.id, objectLabel: o.no, field: `第 ${a.round} 轮修改` })
      return { ok: true }
    },
  }),

  /** 定性；改成新增需求时可以同时定写手追加工资、给这单加价（客户多付的钱） */
  'aftersale.reason': act({
    schema: z.object({
      orderId: z.string(),
      asId: z.string(),
      reason: z.enum(['正常修改', '写手返工', '新增需求']),
      extra: z.number().min(0).max(100_000).optional(),
      charge: z.number().min(0).max(1_000_000).optional(),
      requestId: z.string().uuid().optional(),
    }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'aftersale.reason')
      const a = o.afterSales.find((x) => x.id === i.asId)
      if (!a) throw notFound()
      const extra = i.reason === '新增需求' ? (i.extra ?? a.extra) : 0
      if (isFixedAllocation(o) && extra > 0) throw bad('追加需求请调整订单金额，工资按本单约定自动计算')
      if (extra !== a.extra) need(c, 'order.assign')
      if (i.charge && i.reason !== '新增需求') throw bad('只有新增需求才给订单加价')
      if (i.charge) need(c, 'order.price')
      // 同一次确认的重试复用追加记录主键，不能重复加价或重写之后的工资。
      const adjustmentId = i.requestId ? `adj_${i.requestId}` : uid('adj')
      if (i.charge && i.requestId) {
        const [existing] = await tx.select().from(t.adjustments).where(eq(t.adjustments.id, adjustmentId))
        if (existing) {
          if (existing.orderId !== o.id || existing.by !== c.me.id || existing.amount !== i.charge || existing.reason !== `第 ${a.round} 轮新增需求`) throw bad('这次确认已处理，请重新打开金额表单')
          return { ok: true }
        }
      }
      if (i.charge) await syncFixedAmount(tx, c, w, o, { ...o, basePrice: sumMoney([o.basePrice, i.charge]) })
      if (i.reason !== a.reason) {
        await tx.update(t.afterSales).set({ reason: i.reason }).where(eq(t.afterSales.id, a.id))
        await log(tx, c, { action: '修改', objectType: 'order', objectId: o.id, objectLabel: o.no, field: `第 ${a.round} 轮修改原因`, from: a.reason, to: i.reason })
      }
      if (extra !== a.extra) {
        await tx.update(t.afterSales).set({ extra }).where(eq(t.afterSales.id, a.id))
        await log(tx, c, { action: '修改', objectType: 'order', objectId: o.id, objectLabel: o.no, field: `第 ${a.round} 轮追加工资`, from: money(a.extra), to: money(extra), fieldGroup: 'writerPay' })
      }
      if (i.charge) {
        const reason = `第 ${a.round} 轮新增需求`
        await tx.insert(t.adjustments).values({ id: adjustmentId, orderId: o.id, amount: i.charge, reason, at: iso(today()), by: c.me.id })
        await log(tx, c, { action: '追加', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '追加 / 减免', from: '', to: `${money(i.charge)} ${reason}`, fieldGroup: 'sales' })
      }
      return { ok: true }
    },
  }),

  /** 改这一轮的期限或负责人（负责人只能是本单写手），留痕 */
  'aftersale.update': act({
    schema: z.object({ orderId: z.string(), asId: z.string(), due: z.string().datetime({ offset: true }).optional(), writerId: z.string().optional() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'aftersale.create')
      const a = o.afterSales.find((x) => x.id === i.asId)
      if (!a) throw notFound()
      if (a.cancelledAt || a.doneAt) throw bad('这一轮已经结束了')
      if (i.writerId && i.writerId !== a.writerId && a.extra > 0 && !can(c.role, 'order.assign')) throw deny('这一轮有追加工资，更换负责人需由管理员确认')
      if (a.confirmBy && i.due && new Date(i.due).getTime() !== new Date(a.due).getTime()) throw bad('新任务由写手确认时间，不能直接改期限；确需延期请先沟通')
      const field = `第 ${a.round} 轮修改`
      if (i.due && new Date(i.due).getTime() !== new Date(a.due).getTime()) {
        const due = new Date(i.due).toISOString()
        await tx.update(t.afterSales).set({ due }).where(eq(t.afterSales.id, a.id))
        await log(tx, c, { action: '改期限', objectType: 'order', objectId: o.id, objectLabel: o.no, field, from: stamp(a.due), to: stamp(due) })
      }
      if (i.writerId && i.writerId !== a.writerId) {
        if (!o.assignees.some((x) => x.userId === i.writerId)) throw bad('负责人只能是这单的写手')
        await tx.update(t.afterSales).set({ writerId: i.writerId, ...(a.confirmBy ? { confirmedAt: null, due: new Date(new Date(a.start).getTime() + DEFAULT_DELIVERY).toISOString() } : {}) }).where(eq(t.afterSales.id, a.id))
        const name = (id: string) => w.users.find((u) => u.id === id)?.name ?? id
        await log(tx, c, { action: '换负责人', objectType: 'order', objectId: o.id, objectLabel: o.no, field, from: name(a.writerId), to: name(i.writerId) })
      }
      return { ok: true }
    },
  }),

  // ---------- 渠道 ----------

  'channel.create': act({
    schema: z.object({ name: z.string().trim().min(1, '渠道名称必填').max(50), ownerId: z.string(), avatar: dataImage.optional() }),
    run: async (tx, c, w, i) => {
      // 销售可在录单时新建自己的渠道；只有管理员能指定其他归属。
      if (!can(c.role, 'channel.manage') && !can(c.role, 'order.create')) throw deny()
      const ownerId = c.role.locked ? i.ownerId : c.me.id
      if (!isSalesUser(w, ownerId)) throw bad('默认归属只能是管理员或销售')
      if (w.channels.some((x) => x.name === i.name)) throw bad('已经有同名渠道')
      const id = uid('c')
      await tx.insert(t.channels).values({ id, name: i.name, ownerId, avatar: i.avatar ? await saveAvatar(i.avatar) : null })
      await log(tx, c, { action: '新建', objectType: 'channel', objectId: id, objectLabel: i.name })
      return { id }
    },
  }),

  'channel.toggle': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('请管理员管理渠道')
      need(c, 'channel.manage')
      const ch = w.channels.find((x) => x.id === i.id && !x.deletedAt)
      if (!ch || !channelAccessible(ch, c.me, c.role)) throw notFound()
      await tx.update(t.channels).set({ active: !ch.active }).where(eq(t.channels.id, ch.id))
      await log(tx, c, { action: '修改', objectType: 'channel', objectId: ch.id, objectLabel: ch.name, field: '启用状态', from: ch.active ? '启用' : '停用', to: ch.active ? '停用' : '启用' })
      return { ok: true }
    },
  }),

  'channel.transferPreview': act({
    quiet: true,
    schema: z.object({ id: z.string() }),
    run: async (_tx, c, w, i) => {
      if (!c.role.locked) throw deny('请管理员管理渠道')
      need(c, 'channel.manage')
      need(c, 'order.assign')
      const ch = w.channels.find(x => x.id === i.id && !x.deletedAt)
      if (!ch || !channelAccessible(ch, c.me, c.role)) throw notFound()
      const related = w.orders.filter(o => o.channelId === ch.id)
      if (related.some(o => !rowVisible(o, c.me, c.role))) throw deny('请管理员修改渠道归属')
      return { count: related.length, settled: related.filter(o => o.settlements.some(x => ['已确认', '已发放'].includes(x.status))).length }
    },
  }),

  'channel.update': act({
    schema: z.object({ id: z.string(), patch: z.object({ name: z.string().trim().min(1).max(50), ownerId: z.string(), note: z.string().max(200), avatar: dataImage.nullable() }).partial() }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) {
        if (!can(c.role, 'order.create') || Object.keys(i.patch).some(key => key !== 'avatar')) throw deny('只能修改自己渠道的头像')
      } else need(c, 'channel.manage')
      const ch = w.channels.find((x) => x.id === i.id && !x.deletedAt)
      if (!ch || !channelAccessible(ch, c.me, c.role)) throw notFound()
      const p = Object.fromEntries(Object.entries(i.patch).filter(([k, v]) => (ch as unknown as Record<string, unknown>)[k] !== v)) as typeof i.patch
      if (!Object.keys(p).length) return { ok: true }
      if (p.name && p.name !== ch.name && w.channels.some((x) => x.name === p.name)) throw bad('已经有同名渠道')
      if (p.ownerId && !isSalesUser(w, p.ownerId)) throw bad('默认归属只能是管理员或销售')
      if (p.ownerId && p.ownerId !== ch.ownerId) {
        if (!c.role.locked) throw deny('请管理员修改渠道归属')
        need(c, 'order.assign')
        const related = w.orders.filter(o => o.channelId === ch.id)
        if (related.some(o => !rowVisible(o, c.me, c.role))) throw deny('请管理员修改渠道归属')
        const affected = new Set(related.map(o => o.id))
        for (const batch of w.batches.filter(b => b.status === '草稿' && b.kind === '销售提成' && b.lines.some(line => affected.has(line.orderId)))) {
          const transferAll = !isAdminUser(w, p.ownerId) && batch.lines.every(line => affected.has(line.orderId))
          if (transferAll) {
            await tx.update(t.settleBatches).set({ payeeId: p.ownerId }).where(eq(t.settleBatches.id, batch.id))
            await tx.update(t.settlements).set({ payeeId: p.ownerId }).where(eq(t.settlements.batchId, batch.id))
            await log(tx, c, { action: '转交结算草稿', objectType: 'settle', objectId: batch.id, objectLabel: batch.no, from: w.users.find(u => u.id === batch.payeeId)?.name, to: w.users.find(u => u.id === p.ownerId)?.name, note: `渠道「${ch.name}」转归属，整批草稿同步收款人` })
          } else {
            const reason = `渠道「${ch.name}」转归属，${isAdminUser(w, p.ownerId) ? '自营不计销售提成' : '原草稿包含其他渠道'}，未发款订单请重新选择结算`
            await tx.update(t.settleBatches).set({ status: '已作废', voidedAt: new Date().toISOString(), voidedBy: c.me.id, note: [batch.note, reason].filter(Boolean).join('；') }).where(eq(t.settleBatches.id, batch.id))
            await tx.update(t.settlements).set({ status: '已作废' }).where(eq(t.settlements.batchId, batch.id))
            await log(tx, c, { action: '作废结算草稿', objectType: 'settle', objectId: batch.id, objectLabel: batch.no, from: '草稿', to: '已作废', note: reason })
          }
        }
        for (const o of related) {
          await tx.update(t.orders).set({ ownerId: p.ownerId, updatedAt: new Date().toISOString() }).where(eq(t.orders.id, o.id))
          if (o.ownerId !== p.ownerId) await log(tx, c, { action: '转归属', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '归属销售', from: w.users.find(u => u.id === o.ownerId)?.name, to: w.users.find(u => u.id === p.ownerId)?.name })
        }
      }
      if (p.avatar) p.avatar = await saveAvatar(p.avatar)
      await tx.update(t.channels).set(p).where(eq(t.channels.id, ch.id))
      for (const k of Object.keys(p) as (keyof typeof p)[]) {
        const label = { name: '名称', ownerId: '默认归属', note: '备注', avatar: '头像' }[k]
        const from = k === 'avatar' ? (ch.avatar ? '旧头像' : '默认') : k === 'ownerId' ? w.users.find((u) => u.id === ch.ownerId)?.name : String(ch[k] ?? '')
        const to = k === 'avatar' ? (p.avatar ? '新头像' : '默认') : k === 'ownerId' ? w.users.find((u) => u.id === p.ownerId)?.name : String(p[k] ?? '')
        await log(tx, c, { action: '修改', objectType: 'channel', objectId: ch.id, objectLabel: ch.name, field: label, from, to })
      }
      return { ok: true }
    },
  }),

  'channel.delete': act({
    schema: z.object({ id: z.string(), targetId: z.string().optional() }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('请管理员管理渠道')
      need(c, 'channel.manage')
      const source = w.channels.find(ch => ch.id === i.id && !ch.deletedAt)
      if (!source || !channelAccessible(source, c.me, c.role)) throw notFound()
      if (i.targetId === i.id) throw bad('接收渠道不能是自己')
      const target = i.targetId ? w.channels.find(ch => ch.id === i.targetId && !ch.deletedAt) : undefined
      if (i.targetId && (!target || !channelAccessible(target, c.me, c.role))) throw notFound()
      const related = w.orders.filter(o => o.channelId === source.id)
      const receipts = (w.channelReceipts ?? []).filter(receipt => receipt.channelId === source.id)
      if (related.some(o => !rowVisible(o, c.me, c.role))) throw deny('存在不在你可见范围内的订单，请管理员合并渠道')
      if ((related.length || receipts.length) && !target) {
        const trash = related.filter(o => o.deletedAt).length
        throw bad(`该渠道有 ${related.length - trash} 条正常订单、${trash} 条回收站订单${receipts.length ? `、${receipts.length} 笔渠道收款记录（含预收或已撤销）` : ''}，请选择接收渠道`)
      }
      if (related.length) {
        need(c, 'order.edit')
        await tx.update(t.orders).set({ channelId: target!.id, updatedAt: new Date().toISOString() }).where(eq(t.orders.channelId, source.id))
        await tx.insert(t.audit).values(related.map(o => ({ actorId: c.me.id, ip: c.ip, action: '合并渠道', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '渠道', from: source.name, to: target!.name })))
      }
      if (receipts.length) {
        // 主款随渠道合并，收款时的销售归属快照保持不变。
        await tx.update(t.channelReceipts).set({ channelId: target!.id }).where(eq(t.channelReceipts.channelId, source.id))
        await tx.insert(t.audit).values(receipts.map(receipt => ({ actorId: c.me.id, ip: c.ip, action: '合并渠道', objectType: 'channelReceipt', objectId: receipt.id, objectLabel: receipt.no, field: '渠道', fieldGroup: 'sales', from: source.name, to: target!.name })))
      }
      await tx.update(t.channels).set({ deletedAt: new Date().toISOString() }).where(eq(t.channels.id, source.id))
      await log(tx, c, { action: '删除渠道', objectType: 'channel', objectId: source.id, objectLabel: source.name, from: source.name, to: target ? `合并至「${target.name}」，保留 ${related.length} 单${receipts.length ? `、${receipts.length} 笔渠道收款` : ''}` : '删除空渠道' })
      return { ok: true, moved: related.length }
    },
  }),

  'channel.restore': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('请管理员管理渠道')
      need(c, 'channel.manage')
      need(c, 'trash.view')
      const ch = w.channels.find(x => x.id === i.id && x.deletedAt)
      if (!ch || !channelAccessible(ch, c.me, c.role)) throw notFound()
      await tx.update(t.channels).set({ deletedAt: null }).where(eq(t.channels.id, ch.id))
      await log(tx, c, { action: '恢复渠道', objectType: 'channel', objectId: ch.id, objectLabel: ch.name })
      return { ok: true }
    },
  }),

  // ---------- 角色与账号 ----------

  'role.save': act({
    schema: z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1).max(20),
      perms: z.array(z.string()),
      fields: z.object({ sales: z.boolean(), writerPay: z.enum(['none', 'own', 'all']), commission: z.enum(['none', 'own', 'all']), profit: z.boolean(), channelNo: z.boolean() }),
      rowScope: z.enum(['all', 'owned', 'assigned', 'ownedOrAssigned']),
    }),
    run: async (tx, c, w, i) => {
      need(c, 'role.manage')
      const perms = i.perms.filter((p): p is PermKey => (ALL_PERMS as string[]).includes(p) && !(ADMIN_ONLY_PERMS as string[]).includes(p))
      const old = i.id ? w.roles.find((r) => r.id === i.id) : undefined
      if (i.id && !old) throw notFound()
      if (old?.locked) throw deny('管理员角色固定拥有全部权限，不能改')
      if (old) {
        await tx.update(t.roles).set({ name: i.name, perms, fields: i.fields, rowScope: i.rowScope }).where(eq(t.roles.id, old.id))
        await log(tx, c, { action: '修改', objectType: 'role', objectId: old.id, objectLabel: i.name, to: '权限已更新' })
        return { id: old.id }
      }
      const id = uid('r')
      await tx.insert(t.roles).values({ id, name: i.name, perms, fields: i.fields, rowScope: i.rowScope, sort: w.roles.length })
      await log(tx, c, { action: '新建', objectType: 'role', objectId: id, objectLabel: i.name })
      return { id }
    },
  }),

  'role.delete': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      need(c, 'role.manage')
      const r = w.roles.find((x) => x.id === i.id)
      if (!r) throw notFound()
      if (r.preset || r.locked) throw deny('预置角色不能删')
      const [u] = await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.roleId, r.id)).limit(1)
      if (u) throw bad('还有账号在用这个角色，先给他们换角色')
      await tx.delete(t.roles).where(eq(t.roles.id, r.id))
      await log(tx, c, { action: '删除', objectType: 'role', objectId: r.id, objectLabel: r.name })
      return { ok: true }
    },
  }),

  'user.create': act({
    schema: z.object({ name: z.string().trim().min(1).max(20), account: z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,30}$/, '登录名用 3–30 位字母、数字、点、横线'), roleId: z.string(), canWrite: z.boolean().default(false), salesMode: salesModeSchema.default('commission') }),
    run: async (tx, c, w, i) => {
      need(c, 'role.manage')
      if (!w.roles.some((r) => r.id === i.roleId)) throw bad('角色不存在')
      const [dup] = await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.account, i.account)).limit(1)
      if (dup) throw bad('登录名已被占用')
      const pw = tempPassword()
      const id = uid('u')
      await tx.insert(t.users).values({ id, name: i.name, account: i.account, roleId: i.roleId, canWrite: i.canWrite, salesMode: i.salesMode, hue: Math.floor(Math.random() * 360), passwordHash: await hashPassword(pw), mustChangePassword: true })
      await log(tx, c, { action: '新建', objectType: 'user', objectId: id, objectLabel: i.name, to: `@${i.account}` })
      // 临时密码只在这次返回里出现一次，库里只有哈希
      return { id, tempPassword: pw }
    },
  }),

  'user.update': act({
    schema: z.object({ id: z.string(), patch: z.object({ roleId: z.string(), canWrite: z.boolean(), commissionRate: z.number().min(0).max(1), writerRate: writerRateSchema, salesMode: salesModeSchema, name: z.string().trim().min(1).max(20), active: z.boolean() }).partial() }),
    run: async (tx, c, w, i) => {
      need(c, 'role.manage')
      const [u] = await tx.select().from(t.users).where(eq(t.users.id, i.id))
      if (!u) throw notFound()
      const p = i.patch
      if (p.writerRate !== undefined && !c.role.locked) throw deny('只有老板能修改写手默认比例')
      if (p.roleId !== undefined) {
        if (!w.roles.some((r) => r.id === p.roleId)) throw bad('角色不存在')
        const admins = w.users.filter((x) => x.active && isAdminUser(w, x.id))
        if (isAdminUser(w, u.id) && !w.roles.find((r) => r.id === p.roleId)?.locked && admins.length <= 1) throw bad('至少要留一个管理员')
      }
      if (p.active === false && u.id === c.me.id) throw bad('不能停用自己')
      if (p.active === false && isAdminUser(w, u.id) && w.users.filter((x) => x.active && isAdminUser(w, x.id)).length <= 1) throw bad('至少要留一个管理员')
      await tx.update(t.users).set(p).where(eq(t.users.id, u.id))
      const label: Record<string, string> = { roleId: '角色', canWrite: '可当写手', commissionRate: '提成比例', writerRate: '写手默认比例', salesMode: '默认结算方式', name: '显示名', active: '账号状态' }
      const show = (k: string, v: unknown) => (k === 'roleId' ? (w.roles.find((r) => r.id === v)?.name ?? String(v)) : k === 'canWrite' ? (v ? '是' : '否') : k === 'commissionRate' || k === 'writerRate' ? `${Number((Number(v) * 100).toFixed(2))}%` : k === 'salesMode' ? (v === 'cost' ? '底价结算' : '提成分成') : k === 'active' ? (v ? '启用' : '停用') : String(v))
      for (const [k, v] of Object.entries(p)) await log(tx, c, { action: '修改', objectType: 'user', objectId: u.id, objectLabel: u.name, field: label[k], fieldGroup: k === 'writerRate' ? 'writerRate' : undefined, from: show(k, (u as Record<string, unknown>)[k]), to: show(k, v) })
      if (p.active === false || p.roleId !== undefined) await revokeAllSessions(u.id)
      return { ok: true }
    },
  }),

  'user.avatar': act({
    schema: z.object({ id: z.string(), avatar: dataImage }),
    run: async (tx, c, w, i) => {
      if (i.id !== c.me.id) need(c, 'role.manage')
      const u = w.users.find((x) => x.id === i.id)
      if (!u) throw notFound()
      if (u.avatar === i.avatar) return { ok: true }
      const avatar = await saveAvatar(i.avatar)
      if (u.avatar === avatar) return { ok:true }
      await tx.update(t.users).set({ avatar }).where(eq(t.users.id, u.id))
      await log(tx, c, { action: '修改', objectType: 'user', objectId: u.id, objectLabel: u.name, field: '头像', from: u.avatar ? '旧头像' : '默认', to: '新头像' })
      return { ok: true }
    },
  }),

  'user.frame': act({
    schema: z.object({ id: z.string(), frame: z.enum(AVATAR_FRAME_IDS) }),
    run: async (tx, c, w, i) => {
      if (i.id !== c.me.id) need(c, 'role.manage')
      const u = w.users.find((x) => x.id === i.id)
      if (!u) throw notFound()
      const previous = avatarFrame(u.frame)
      if (previous === i.frame) return { ok: true }
      await tx.update(t.users).set({ avatarFrame: i.frame === 'none' ? null : i.frame }).where(eq(t.users.id, u.id))
      await log(tx, c, { action: '修改', objectType: 'user', objectId: u.id, objectLabel: u.name, field: '头像框', from: AVATAR_FRAME_NAMES[previous], to: AVATAR_FRAME_NAMES[i.frame] })
      return { ok: true }
    },
  }),

  'user.resetPassword': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      need(c, 'role.manage')
      const u = w.users.find((x) => x.id === i.id)
      if (!u) throw notFound()
      const pw = tempPassword()
      await tx.update(t.users).set({ passwordHash: await hashPassword(pw), mustChangePassword: true, failedAttempts: 0, lockedUntil: null }).where(eq(t.users.id, u.id))
      await revokeAllSessions(u.id)
      await log(tx, c, { action: '重置密码', objectType: 'user', objectId: u.id, objectLabel: u.name })
      return { tempPassword: pw }
    },
  }),

  'user.forceLogout': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, i) => {
      need(c, 'role.manage')
      const u = w.users.find((x) => x.id === i.id)
      if (!u) throw notFound()
      await revokeAllSessions(u.id)
      await log(tx, c, { action: '强制下线', objectType: 'user', objectId: u.id, objectLabel: u.name })
      return { ok: true }
    },
  }),

  'settings.defaultWriter': act({
    schema: z.object({ userId: z.string() }),
    run: async (tx, c, w, i) => {
      need(c, 'role.manage')
      const u = w.users.find((x) => x.id === i.userId)
      if (!u || !isWriter(w, u.id)) throw bad('默认写手必须是在用的「可当写手」账号')
      if (w.defaultWriterId === i.userId) return { ok: true }
      const old = w.users.find((x) => x.id === w.defaultWriterId)
      await tx.insert(t.options).values({ key: 'defaultWriter', values: [u.id] }).onConflictDoUpdate({ target: t.options.key, set: { values: [u.id] } })
      await log(tx, c, { action: '修改', objectType: 'user', objectId: u.id, objectLabel: u.name, field: '默认写手', from: old?.name ?? '未设', to: u.name })
      return { ok: true }
    },
  }),

  'me.update': act({
    schema: z.object({ name: z.string().trim().min(1).max(20) }),
    run: async (tx, c, w, i) => {
      if (c.me.name === i.name) return { ok: true }
      await tx.update(t.users).set({ name: i.name }).where(eq(t.users.id, c.me.id))
      await log(tx, c, { action: '修改', objectType: 'user', objectId: c.me.id, objectLabel: c.me.name, field: '显示名', from: c.me.name, to: i.name })
      return { ok: true }
    },
  }),

  // ---------- 不改业务数据的记录 ----------

  'notes.read': act({
    quiet: true,
    schema: z.object({ ids: z.array(z.string().max(200)).max(500) }),
    run: async (tx, c, _w, i) => {
      if (i.ids.length) await tx.insert(t.notesRead).values(i.ids.map((noteId) => ({ userId: c.me.id, noteId }))).onConflictDoNothing()
      return { ok: true }
    },
  }),

  'log.view': act({
    quiet: true,
    schema: z.object({ orderId: z.string() }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.orderId, 'order.view')
      await log(tx, c, { action: '查看详情', objectType: 'order', objectId: o.id, objectLabel: o.no })
      return { ok: true }
    },
  }),

  'log.export': act({
    quiet: true,
    schema: z.object({ label: z.string().max(500), orderIds: z.array(z.string()).max(500) }),
    run: async (tx, c, w, i) => {
      for (const id of i.orderIds) orderFor(w, c, id, 'order.view')
      await log(tx, c, { action: '导出', objectType: 'export', objectLabel: i.label })
      return { ok: true }
    },
  }),
}

export type ActionName = keyof typeof ACTIONS

export const WRITE_LOCK = 20261007

export async function runAction(c: Ctx, name: string, body: unknown) {
  return (await import('./run')).runAction(c, name, body)
}
