import type { ChannelReceipt, ChannelReceiptTag } from '@/shared/channel-receipts'
import { cents } from '@/shared/calc'
import { channelAccessible } from '@/shared/channel-access'
import { can, rowVisible } from '@/shared/perm'
import type { World } from './repo'
import type { Ctx } from './session'
import type * as t from './schema'

export type ChannelReceiptRow = typeof t.channelReceipts.$inferSelect
type ReceiptViewer = { me: Pick<Ctx['me'], 'id'>; role: Ctx['role'] }
export function channelReceiptView(row: ChannelReceiptRow, payments: (typeof t.payments.$inferSelect)[], orders: { id: string; no: string; title: string }[]): ChannelReceipt {
  const lines = payments.filter(p => p.receiptId === row.id).map(p => {
    const o = orders.find(o => o.id === p.orderId)
    return { paymentId: p.id, orderId: p.orderId, no: o?.no ?? '', title: o?.title ?? '', amount: p.amount }
  })
  const allocated = lines.reduce((n, l) => n + cents(l.amount), 0) / 100
  return {
    id: row.id, no: row.no, channelId: row.channelId, ownerId: row.ownerId, amount: row.amount,
    date: row.date, tag: row.tag as ChannelReceiptTag, note: row.note, proof: row.proof ?? undefined,
    createdBy: row.createdBy, createdAt: row.createdAt, revision: row.revision,
    revoked: row.revokedAt ? { at: row.revokedAt, by: row.revokedBy ?? '', reason: row.revokeReason ?? '' } : undefined,
    lines, allocated, unallocated: (cents(row.amount) - cents(allocated)) / 100,
  }
}
export function canAccessReceiptChannel(w: World, c: ReceiptViewer, channelId: string) {
  const channel = w.channels.find(ch => ch.id === channelId)
  return !!channel && !channel.deletedAt && channelAccessible(channel, c.me, c.role)
    && can(c.role, 'channel.view') && can(c.role, 'order.view') && (c.role.locked || c.role.fields.sales)
}
/** 总额与凭证包含整笔信息，不能向只能看其中几单的人泄漏。 */
export function canViewChannelReceipt(w: World, c: ReceiptViewer, receipt: ChannelReceipt) {
  return canAccessReceiptChannel(w, c, receipt.channelId) && receipt.lines.every(line => {
    const order = w.orders.find(o => o.id === line.orderId)
    return !!order && rowVisible(order, c.me, c.role)
  })
}
