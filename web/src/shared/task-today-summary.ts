import type { OrderView } from './types'
import type { AfterSaleTask } from './aftersale-task'
import { isStagedWriterPay, writerGroupDone } from './writer-stages'
import { buildWriterWorkbench } from './writer-workbench'

/** 传入已按人员和搜索过滤的订单；初稿和跟进分别计数，不混成同一个截止数。 */
export function taskTodaySummary(pending: OrderView[], visible: OrderView[], date: string, pendingGroupIds: Set<string>, userId?: string) {
  const left = pending.filter(row => row.status !== '已发演示' && row.dueDate === date && !pendingGroupIds.has(row.id)).length
  // 员工看不到工资方案，沿用工作台的本人凭据，不能把合作者的整单 draftAt 算给本人。
  const completed = userId ? new Set(buildWriterWorkbench(visible, [], userId).rows.filter(row => row.groupDone).map(row => row.order.id)) : null
  const done = visible.filter(row => row.status !== '退单' && row.dueDate === date && (completed ? completed.has(row.id) : isStagedWriterPay(row) ? writerGroupDone(row) : row.status === '已交付')).length
  return { left, done, total: left + done }
}


/** 原订单交付与跟进分别展示；开跟进不能让尚未交付的订单失去原截止。 */
export function taskPendingOrders(visible: OrderView[], tasks: AfterSaleTask[], writerId?: string) {
  if (writerId) {
    const work = buildWriterWorkbench(visible, tasks, writerId)
    return { orders: work.rows.filter(row => !row.groupDone).map(row => row.order),
      pendingGroupIds: new Set(work.rows.filter(row => row.initialDone && !row.groupDone).map(row => row.order.id)) }
  }
  const orders = visible.filter(row => (row.status === '已发演示' || !writerGroupDone(row)) && row.status !== '退单'
    && (isStagedWriterPay(row) || row.status === '未交付' || row.status === '已发演示'))
    .sort((a, b) => Number(!!b.urgency) - Number(!!a.urgency) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.orderDate.localeCompare(b.orderDate))
  return { orders, pendingGroupIds: new Set<string>() }
}
