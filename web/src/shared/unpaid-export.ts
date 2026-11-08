import type { OrderView } from './types'

/** 未付 = 「待收款」视图同一口径：未收大于 0，退单不算 */
export const isUnpaid = (v: Pick<OrderView, 'unpaid' | 'status'>) => (v.unpaid ?? 0) > 0 && v.status !== '退单'

/** 给渠道发的未付清单：下单日期新的在前 */
export function unpaidOrders<T extends OrderView>(views: T[]) {
  return views.filter(isUnpaid).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.no.localeCompare(a.no))
}

export const unpaidState = (v: Pick<OrderView, 'received'>) => (v.received ?? 0) > 0 ? '尾款未付' : '定金未付'
