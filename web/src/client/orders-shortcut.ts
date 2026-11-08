import { daysUntil } from '@/shared/format'
import type { OrderView } from '@/shared/types'
import { isInitialDeliveryPending } from '@/shared/order-deadline'

/** 下单超过 30 天仍未交出初稿或演示，才继续提醒处理。 */
export const isStale = (v: OrderView) => isInitialDeliveryPending(v) && (daysUntil(v.orderDate) ?? 0) <= -30

let pending: string | null = null
/** 从别的页面跳进订单页并直接套用某个内置视图；订单页已打开时靠事件，没打开时挂载后取走。 */
export function queueOrdersView(id: string) {
  pending = id
  window.dispatchEvent(new CustomEvent('bxsh:orders-view', { detail: id }))
}
export function takeOrdersView() {
  const id = pending
  pending = null
  return id
}
