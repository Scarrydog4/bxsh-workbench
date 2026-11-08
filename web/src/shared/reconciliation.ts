import type { Order, OrderView } from './types'

/** 核对的是当时的金额与流水；新收款、退款、撤销或改价后必须重新核对。 */
export function paymentSnapshot(o: Order) {
  return JSON.stringify({ base: o.basePrice,
    adjustments: o.adjustments.map(a => [a.id, a.amount, a.revoked?.at ?? null]).sort(),
    payments: o.payments.map(p => [p.id, p.amount, p.tag, p.date, p.revoked?.at ?? null]).sort(),
  })
}
export type ReceiptFilter = 'all' | 'noRecord' | 'unreceived' | 'partial' | 'paid' | 'overpaid'
export function receiptMatches(o: OrderView, filter: ReceiptFilter) {
  if (o.sales === undefined || o.received === undefined || o.status === '退单') return false
  if (filter === 'noRecord') return !o.payments?.some(p => !p.revoked)
  if (filter === 'unreceived') return o.sales > 0 && o.received <= 0
  if (filter === 'partial') return o.received > 0 && (o.unpaid ?? 0) > 0
  if (filter === 'paid') return o.sales > 0 && o.received === o.sales
  if (filter === 'overpaid') return (o.unpaid ?? 0) < 0
  return true
}
