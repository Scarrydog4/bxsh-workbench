import { businessDate } from './format'
import type { PayKind, PayLine } from './income'
import type { OrderView } from './types'

export interface PayrollExportRow extends PayLine {
  payee: { id: string; name: string }
  order?: OrderView
  paidRecords: number
  paidDate: string
  undatedPayment: boolean
}
export interface PayrollExportRef { payeeId: string; orderId: string; kind: PayKind }
export const payrollExportKey = (row: PayrollExportRef) => `${row.payeeId}:${row.orderId}:${row.kind}`
export const payrollPlanLabel = (order?: OrderView) => !order ? '' : order.writerPayPlan === 'completed_balance_50_50' ? '两期 50% / 50%' : order.writerPayPlan === 'staged' ? '三期 50% / 20% / 30%' : '原约定'
type Value = string | number | null | undefined
interface Labels { user: (id: string) => string; channel: (id: string) => string }
interface ExportColumn { id: string; header: string; value: (row: PayrollExportRow, labels: Labels) => Value; money?: boolean; date?: boolean; width?: number }
const money = (id: 'sales' | 'received' | 'unpaid' | 'extraCostTotal' | 'allocationBase' | 'bossIncome', header: string): ExportColumn => ({ id, header, money: true, value: row => id === 'bossIncome' && row.order?.payPending ? '待定' : row.order?.[id] })
const columns: ExportColumn[] = [
  { id: 'orderDate', header: '下单日期', date: true, value: row => row.date },
  { id: 'title', header: '订单名称', width: 42, value: row => row.title },
  { id: 'payee', header: '收款人', width: 16, value: row => row.payee.name },
  { id: 'due', header: '应发', money: true, value: row => row.due ?? '待定' },
  { id: 'paid', header: '已发', money: true, value: row => row.paid },
  { id: 'left', header: '剩余', money: true, value: row => row.due === null ? '待定' : row.left },
  { id: 'cust', header: '客户付款', value: row => row.custStage ? { none: '未收款', deposit: '定金已到', paidUp: '已收齐' }[row.custStage] : '' },
  { id: 'status', header: '订单状态', value: row => row.status },
  { id: 'dueDate', header: '截止日期', date: true, value: row => row.order?.dueDate },
  { id: 'channel', header: '渠道', width: 20, value: (row, labels) => row.order ? labels.channel(row.order.channelId) : '' },
  { id: 'owner', header: '归属销售', value: (row, labels) => row.order ? labels.user(row.order.ownerId) : '' },
  { id: 'writers', header: '协作写手', width: 24, value: (row, labels) => row.order?.assignees.map(writer => labels.user(writer.userId)).join('、') },
  { id: 'creator', header: '录单人', value: (row, labels) => row.order ? labels.user(row.order.creatorId) : '' },
  { id: 'kind', header: '收入类型', value: row => row.kind },
  { id: 'available', header: '按条件可发', money: true, value: row => row.suggest ?? (row.due === null ? '待定' : '') },
  { id: 'over', header: '多发差额', money: true, value: row => row.over },
  { id: 'paidRecords', header: '结算记录数', value: row => row.paidRecords },
  { id: 'paidDate', header: '最近结算日期', date: true, value: row => row.paidDate },
  money('sales', '订单销售额'), money('received', '客户已收'), money('unpaid', '客户未收'), money('extraCostTotal', '额外成本'), money('allocationBase', '分成基数'), money('bossIncome', '老板预计收入'),
  { id: 'type', header: '订单类型', value: row => row.order?.type },
  { id: 'salesMode', header: '销售模式', value: row => row.order ? row.order.salesMode === 'cost' ? '底价订单' : '提成订单' : '' },
  { id: 'writerPayPlan', header: '工资发放约定', width: 24, value: row => payrollPlanLabel(row.order) },
  { id: 'draftAt', header: '初稿日期', date: true, value: row => row.order?.draftAt ? businessDate(row.order.draftAt) : '' },
  { id: 'wechatGroup', header: '微信群', width: 32, value: row => row.order?.wechatGroup },
  { id: 'channelNo', header: '渠道单号', width: 20, value: row => row.order?.channelNo },
  { id: 'no', header: '系统编号', width: 20, value: row => row.no },
  { id: 'note', header: '订单备注', width: 40, value: row => row.order?.note },
  { id: 'urgency', header: '加急说明', width: 32, value: row => row.order?.urgency ? row.order.urgency.note || '加急' : '' },
]
const byId = new Map(columns.map(column => [column.id, column]))
/** 保持当前可见列顺序，末尾补齐核账必需字段；操作列不导出。 */
export function payrollExportColumns(visible: string[]) {
  return [...new Set([...visible, 'title', 'payee', 'due', 'paid', 'left', 'orderDate', 'status', 'kind'])].flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
}
export function payrollExportValues(row: PayrollExportRow, selected: ReturnType<typeof payrollExportColumns>, labels: Labels) {
  return selected.map(column => column.value(row, labels) ?? '')
}
