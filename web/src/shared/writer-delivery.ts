import { sumMoney } from './calc'
import { businessDate } from './format'
import type { OrderView, SettleStatus } from './types'

type DeliveryOrder = Pick<OrderView, 'status' | 'assignees' | 'writerProgress' | 'draftAt'> & { deletedAt?: string | null }

function deliveryDate(at: string | null) {
  // 数据库 timestamp 可能是“日期 时间+08”，转成各浏览器都能读取的 ISO 格式。
  const value = at?.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/(T.*[+-]\d{2})$/, '$1:00')
  if (!value || !Number.isFinite(Date.parse(value))) return { at: null, day: null }
  return { at: value.includes('T') ? new Date(value).toISOString() : value, day: businessDate(value) }
}

/** 优先用本人的群内交付凭据；旧单缺少个人记录时不借用合作者的交付日期。 */
export function writerDelivery(order: DeliveryOrder, writerId: string): { at: string | null; day: string | null } | null {
  if (order.deletedAt || order.status === '退单' || !order.assignees.some(a => a.userId === writerId)) return null
  const progress = order.writerProgress?.find(p => p.userId === writerId)
  if (order.writerProgress?.length) {
    if (!progress?.groupSentAt || !progress.groupProofIds.length) return null
    return deliveryDate(progress.groupSentAt)
  }
  if (order.status !== '已交付') return null
  const at = order.assignees.length === 1 ? order.draftAt : null
  return deliveryDate(at)
}

export interface WriterDeliveryRow {
  id: string; order: OrderView; at: string | null; day: string | null
  wage: number | null; knownWage: number; paid: number; left: number | null; settlement: SettleStatus
}

/** 一单只算本人约定工资与追加工资；草稿、撤销、他人结算均不计入实发。 */
export function writerDeliveryRows(orders: OrderView[], writerId: string): WriterDeliveryRow[] {
  return orders.flatMap(order => {
    const delivery = writerDelivery(order, writerId)
    if (!delivery) return []
    const pay = order.assignees.find(a => a.userId === writerId)?.pay
    const knownWage = sumMoney([pay ?? 0, ...order.afterSales.filter(a => a.writerId === writerId).map(a => a.extra ?? 0)])
    const wage = typeof pay === 'number' ? knownWage : null
    const paid = sumMoney((order.settlements ?? []).filter(s => s.payeeId === writerId && s.kind === '写手工资' && s.status === '已确认').map(s => s.amount))
    const left = wage === null ? null : Math.max(0, sumMoney([wage, -paid]))
    const settlement: SettleStatus = paid <= 0 ? '未结算' : wage === null || paid < wage ? '部分结算' : '已结算'
    return [{ id: order.id, order, ...delivery, wage, knownWage, paid, left, settlement }]
  }).sort((a, b) => (b.day ?? '').localeCompare(a.day ?? '') || (b.at ?? '').localeCompare(a.at ?? '') || b.order.no.localeCompare(a.order.no))
}
