import type { OrderView } from './types'
import { sumMoney } from './calc'
import { receiptTotals } from './receipts'
import { isUnpaid } from './unpaid-export'

export const CHANNEL_EXPORT_SCOPES = ['all', 'unpaid', 'no_deposit', 'balance', 'paid'] as const
export type ChannelExportScope = typeof CHANNEL_EXPORT_SCOPES[number]
export function channelExportScopeLabel(scope: ChannelExportScope) {
  return { all: '全部订单', unpaid: '全部未付', no_deposit: '未收定金', balance: '未付尾款', paid: '已收齐' }[scope]
}

type PaymentOrder = Pick<OrderView, 'status' | 'received' | 'sales' | 'unpaid'>
export const CHANNEL_PAYMENT_CATEGORIES = [
  { label: '未收定金', color: '#9F1239', background: '#FFF1F2', description: '尚无有效收款；未收金额为全单余额' },
  { label: '未付尾款', color: '#92400E', background: '#FFFBEB', description: '已收部分款项，尚未收齐' },
  { label: '已收齐', color: '#065F46', background: '#ECFDF5', description: '款项已收齐（含多收）' },
  { label: '退单', color: '#475569', background: '#F1F5F9', description: '不计入有效订单待补合计' },
] as const
const isPaid = (order: PaymentOrder) => order.status !== '退单' && (order.unpaid !== undefined
  ? order.unpaid <= 0
  : order.received !== undefined && order.sales !== undefined && order.received >= order.sales)

/** 定金/尾款仅按当前有效已收区分，不推断约定的定金金额。 */
export function channelPaymentState(order: PaymentOrder) {
  if (order.status === '退单') return '退单'
  if (isPaid(order)) return '已收齐'
  return (order.received ?? 0) > 0 ? '未付尾款' : '未收定金'
}

export function channelPaymentCategory(order: PaymentOrder) {
  return CHANNEL_PAYMENT_CATEGORIES.find(category => category.label === channelPaymentState(order))!
}

export function exportScopeOrders<T extends OrderView>(orders: readonly T[], scope: ChannelExportScope): T[] {
  return orders.filter(order => {
    if (scope === 'all') return true
    if (scope === 'paid') return isPaid(order)
    if (!isUnpaid(order)) return false
    if (scope === 'no_deposit') return (order.received ?? 0) <= 0
    if (scope === 'balance') return (order.received ?? 0) > 0
    return true
  }).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.no.localeCompare(a.no))
}

export const CHANNEL_COLUMNS = [
  ['no','订单号','Order No'], ['channelNo','渠道单号','Channel Order No'], ['title','订单名称','Order Title'], ['orderDate','下单日期','Order Date'], ['status','状态','Status'], ['paymentState','收款情况','Payment Status'], ['sales','应收','Amount Due'], ['received','已收','Received'], ['unpaid','未收','Outstanding'], ['dueDate','截止日期','Due Date'], ['type','订单类型','Order Type'], ['wechatGroup','微信群','WeChat Group'],
] as const
export type ChannelColumn = typeof CHANNEL_COLUMNS[number][0]
export type ChannelExportColumn = readonly [ChannelColumn, string, string]
export type HeaderLanguage = 'zh' | 'en' | 'both'
export const DEFAULT_CHANNEL_COLUMNS: ChannelColumn[] = ['channelNo','title','orderDate','status','sales','received','unpaid']
export const RECEIPT_COLUMNS = [['title','订单名称','Order Title'],['date','收款日期','Payment Date'],['tag','类型','Type'],['amount','金额','Amount'],['note','备注','Note']] as const
export function exportColumns(keys: string[], sales: boolean, channelNo: boolean, scope: ChannelExportScope = 'all'): ChannelExportColumn[] {
  const allowed = CHANNEL_COLUMNS.filter(c => keys.includes(c[0]) && (sales || !['sales','received','unpaid','paymentState'].includes(c[0])) && (channelNo || c[0] !== 'channelNo'))
  const columns = allowed.length && sales && scope === 'all'
    ? CHANNEL_COLUMNS.filter(c => allowed.some(column => column[0] === c[0]) || c[0] === 'paymentState')
    : allowed
  return columns
    .map(c => c[0] === 'unpaid' && ['unpaid', 'no_deposit', 'balance'].includes(scope) ? ['unpaid', '待补金额', 'Outstanding'] : c)
}
export function channelExportData(orders: readonly OrderView[]) {
  const sorted = exportScopeOrders(orders, 'all')
  const receipts = sorted.flatMap(o => (o.payments ?? []).filter(p => !p.revoked).map(p => ({ no:o.no, title:o.title, date:p.date, tag:p.tag, amount:p.tag === '退款' ? -Math.abs(p.amount) : p.amount, note:p.note }))).sort((a,b) => b.date.localeCompare(a.date))
  const totals = (returned: boolean) => {
    const rows = sorted.filter(o => (o.status === '退单') === returned)
    return { n: rows.length, sales: sumMoney(rows.map(o => o.sales ?? 0)), received: sumMoney(rows.map(o => o.received ?? 0)), unpaid: returned ? sumMoney(rows.map(o => o.unpaid ?? 0)) : receiptTotals(rows).unpaid }
  }
  return { orders:sorted, receipts, live:totals(false), returned:totals(true) }
}
