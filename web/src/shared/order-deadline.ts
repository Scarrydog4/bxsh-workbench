/** 演示已发即完成原订单的截止要求；正式交付及个人工资凭据仍分别判断。 */
export function isInitialDeliveryPending(order: { status: string }) {
  return order.status === '未交付'
}

/** 已发演示、已交付、退单的历史订单允许保留空截止，不再提示补日期。 */
export function needsDeadline(order: { dueDate: string | null; status: string }) {
  return !order.dueDate && !['已发演示', '已交付', '退单', '待发客户'].includes(order.status)
}
