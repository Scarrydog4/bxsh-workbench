import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { calc, cents } from '@/shared/calc'
import { businessDate, money } from '@/shared/format'
import { act, dataImage, isoDate, log, need, orderFor } from './actions'
import { canAccessReceiptChannel, canViewChannelReceipt, type ChannelReceiptRow } from './channel-receipts'
import { bad, deny, HttpError, notFound } from './http'
import { saveChannelReceiptImage } from './images'
import { uid } from './ids'
import { adminIdsOf, type World } from './repo'
import type { Tx } from './db'
import type { Ctx } from './session'
import * as t from './schema'

const amount = z.number().positive('金额须大于0').max(1_000_000).multipleOf(0.01, '金额最多两位小数')
const lines = z.array(z.object({ orderId: z.string().min(1), amount })).max(500)
const receiptDate = isoDate.refine(value => {
  const d = new Date(`${value}T12:00:00+08:00`)
  return Number.isFinite(d.getTime()) && businessDate(d) === value
}, '日期不存在').refine(value => value <= businessDate(new Date()), '收款日期不能晚于今天')
function request(c: Ctx, action: string, input: unknown) {
  return { actor: c.me.id, action, hash: createHash('sha256').update(JSON.stringify(input)).digest('hex') }
}
function replay(row: ChannelReceiptRow, requestId: string, value: ReturnType<typeof request>) {
  const old = row.requests[requestId]
  if (!old) return false
  if (old.actor !== value.actor || old.action !== value.action || old.hash !== value.hash) throw bad('请求内容已变化，请重新提交')
  return true
}
function writableChannel(w: World, c: Ctx, channelId: string) {
  need(c, 'payment.create')
  if (!canAccessReceiptChannel(w, c, channelId)) throw notFound()
  return w.channels.find(ch => ch.id === channelId)!
}
function validateLines(w: World, c: Ctx, channelId: string, input: z.infer<typeof lines>) {
  const seen = new Set<string>(), admins = adminIdsOf(w)
  for (const line of input) {
    if (seen.has(line.orderId)) throw bad('同一订单只能填写一次')
    seen.add(line.orderId)
    const order = orderFor(w, c, line.orderId, 'payment.create')
    if (order.channelId !== channelId) throw bad('只能分配给同一渠道的订单')
    if (order.salesMode === 'cost') throw bad('底价单不参与渠道收款')
    if (order.status === '退单') throw bad('退单不能分配收款')
    if (cents(line.amount) > cents(calc(order, admins).unpaid)) throw bad(`${order.title} 分配金额超过待收，请刷新后重试`)
  }
}
async function addLines(tx: Tx, c: Ctx, receipt: Pick<ChannelReceiptRow, 'id' | 'date' | 'tag' | 'note' | 'proof'>, input: z.infer<typeof lines>) {
  for (const line of input) {
    await tx.insert(t.payments).values({ id: uid('pay'), receiptId: receipt.id, orderId: line.orderId, amount: line.amount, date: receipt.date, tag: receipt.tag, note: receipt.note, proof: receipt.proof, by: c.me.id })
    await tx.update(t.orders).set({ paymentCheckedAt: null, paymentCheckedBy: null, paymentCheckedSnapshot: null, updatedAt: new Date().toISOString() }).where(eq(t.orders.id, line.orderId))
    await log(tx, c, { action: '分配渠道收款', objectType: 'order', objectId: line.orderId, fieldGroup: 'sales', to: money(line.amount), note: receipt.note, proof: receipt.proof ?? undefined })
  }
}
async function find(tx: Tx, w: World, c: Ctx, id: string) {
  const view = w.channelReceipts?.find(row => row.id === id)
  if (!view || !canViewChannelReceipt(w, c, view)) throw notFound()
  const [row] = await tx.select().from(t.channelReceipts).where(eq(t.channelReceipts.id, id))
  if (!row) throw notFound()
  return { row, view }
}
export const CHANNEL_RECEIPT_ACTIONS = {
  'channelReceipt.create': act({
    schema: z.object({ requestId: z.string().uuid(), channelId: z.string().min(1), amount, date: receiptDate, tag: z.enum(['定金', '尾款', '全款']), note: z.string().trim().max(2000).default(''), proof: dataImage.optional(), mode: z.enum(['allocate', 'advance']), lines }),
    run: async (tx, c, w, i) => {
      const channel = writableChannel(w, c, i.channelId), id = `cr_${i.requestId}`
      const [old] = await tx.select().from(t.channelReceipts).where(eq(t.channelReceipts.id, id))
      const req = request(c, 'create', i)
      if (old) {
        if (replay(old, i.requestId, req)) return { id, amount: i.amount, count: i.lines.length }
        throw bad('请求编号已使用')
      }
      if (!c.role.locked && !i.note && !i.proof) throw bad('请填写收款备注或粘贴截图')
      const total = i.lines.reduce((n, l) => n + cents(l.amount), 0)
      if (i.mode === 'advance' ? i.lines.length !== 0 : !i.lines.length || total !== cents(i.amount)) throw bad(i.mode === 'advance' ? '预收款暂不分配订单' : '收款总额必须等于分配金额合计')
      validateLines(w, c, i.channelId, i.lines)
      const proof = i.proof ? await saveChannelReceiptImage(i.proof, id) : null
      const [counter] = await tx.insert(t.counters).values({ name: 'channel_receipt_serial', value: 1 }).onConflictDoUpdate({ target: t.counters.name, set: { value: sql`${t.counters.value} + 1` } }).returning()
      const no = `SK${businessDate(new Date()).slice(2, 7).replace('-', '')}${String(counter.value).padStart(3, '0')}`
      await tx.insert(t.channelReceipts).values({ id, no, channelId: channel.id, ownerId: channel.ownerId, amount: i.amount, date: i.date, tag: i.tag, note: i.note, proof, createdBy: c.me.id, requests: { [i.requestId]: req } })
      await addLines(tx, c, { id, date: i.date, tag: i.tag, note: i.note, proof }, i.lines)
      await log(tx, c, { action: '渠道收款', objectType: 'channelReceipt', objectId: id, objectLabel: no, fieldGroup: 'sales', to: money(i.amount), note: i.note, proof: proof ?? undefined })
      return { id, amount: i.amount, count: i.lines.length }
    },
  }),
  'channelReceipt.allocate': act({
    schema: z.object({ id: z.string().min(1), requestId: z.string().uuid(), revision: z.number().int().positive(), lines: lines.min(1) }),
    run: async (tx, c, w, i) => {
      const { row, view } = await find(tx, w, c, i.id)
      writableChannel(w, c, row.channelId)
      const req = request(c, 'allocate', i), total = i.lines.reduce((n, l) => n + cents(l.amount), 0)
      if (replay(row, i.requestId, req)) return { id: row.id, amount: total / 100, count: i.lines.length }
      if (row.revokedAt) throw bad('收款已撤销，不能分配')
      if (row.revision !== i.revision) throw new HttpError(409, '这笔收款已更新，请刷新后重试')
      if (total > cents(view.unallocated)) throw bad('分配金额超过剩余预收款')
      validateLines(w, c, row.channelId, i.lines)
      await addLines(tx, c, row, i.lines)
      await tx.update(t.channelReceipts).set({ revision: row.revision + 1, requests: { ...row.requests, [i.requestId]: req } }).where(eq(t.channelReceipts.id, row.id))
      await log(tx, c, { action: '分配预收款', objectType: 'channelReceipt', objectId: row.id, objectLabel: row.no, fieldGroup: 'sales', to: money(total / 100) })
      return { id: row.id, amount: total / 100, count: i.lines.length }
    },
  }),
  'channelReceipt.revoke': act({
    schema: z.object({ id: z.string().min(1), reason: z.string().trim().min(1, '请填写撤销原因').max(2000) }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('只有管理员可以撤销整笔收款')
      const { row, view } = await find(tx, w, c, i.id)
      if (row.revokedAt) {
        if (row.revokeReason !== i.reason) throw bad('这笔收款已经撤销')
        return { id: row.id }
      }
      const revocation = { revokedAt: new Date().toISOString(), revokedBy: c.me.id, revokeReason: i.reason }
      await tx.update(t.channelReceipts).set({ ...revocation, revision: row.revision + 1 }).where(eq(t.channelReceipts.id, row.id))
      await tx.update(t.payments).set(revocation).where(eq(t.payments.receiptId, row.id))
      for (const orderId of new Set(view.lines.map(l => l.orderId))) {
        await tx.update(t.orders).set({ paymentCheckedAt: null, paymentCheckedBy: null, paymentCheckedSnapshot: null, updatedAt: revocation.revokedAt }).where(eq(t.orders.id, orderId))
        await log(tx, c, { action: '撤销渠道收款分配', objectType: 'order', objectId: orderId, fieldGroup: 'sales', note: i.reason })
      }
      await log(tx, c, { action: '撤销渠道收款', objectType: 'channelReceipt', objectId: row.id, objectLabel: row.no, fieldGroup: 'sales', from: money(row.amount), to: '已撤销', note: i.reason })
      return { id: row.id }
    },
  }),
}
