export const ORDER_DEFAULT_COLUMNS = ['select', 'title', 'sales', 'unpaid', 'status', 'orderDate', 'dueDate', 'channel', 'assignees', 'progressNote']
const OLD_ORDER_DEFAULT_COLUMNS = ['select', 'orderDate', 'title', 'status', 'progressNote', 'dueDate', 'channel', 'assignees', 'sales', 'unpaid']
const LEGACY_ORDER_COLUMNS = ['select', 'orderDate', 'no', 'title', 'status', 'dueDate', 'channel', 'sales', 'unpaid', 'owner', 'assignees', 'aftersale', 'type', 'received', 'payStatus', 'writerTotal', 'commission', 'bossIncome', 'channelNo', 'wechatGroup', 'draftAt', 'creator']
const OLD_PAYROLL_COLUMNS = ['orderDate', 'title', 'payee', 'due', 'paid', 'left', 'cust', 'status', 'dueDate', 'channel', 'owner', 'writers', 'creator', 'kind', 'available', 'over', 'paidRecords', 'paidDate', 'sales', 'received', 'unpaid', 'extraCostTotal', 'allocationBase', 'bossIncome', 'type', 'salesMode', 'writerPayPlan', 'draftAt', 'wechatGroup', 'channelNo', 'no', 'note', 'urgency', 'actions']
const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** 只升级旧默认布局，用户调整过的顺序原样保留。 */
export function migrateOrderDefaultColumns(saved: string[]) {
  if (same(saved, LEGACY_ORDER_COLUMNS)) return ['select', 'title', 'sales', 'unpaid', ...saved.filter(id => !['select', 'title', 'sales', 'unpaid'].includes(id))]
  return same(saved, OLD_ORDER_DEFAULT_COLUMNS) || same(saved, OLD_ORDER_DEFAULT_COLUMNS.filter(id => id !== 'progressNote'))
    ? ORDER_DEFAULT_COLUMNS : saved
}

/** 旧版本给尚未自定义的工资表自动写过这两个字段。 */
export function migratePayrollDefaultColumns(saved: string[]) {
  return same(saved, ['orderDate', 'title']) || same(saved, OLD_PAYROLL_COLUMNS) ? [] : saved
}

export function migrateChannelDefaultColumns(saved: string[]) {
  return same(saved, ['name', 'owner', 'n', 'sales', 'unpaid', 'actions']) ? ['name', 'sales', 'unpaid', 'n', 'owner', 'actions'] : saved
}
