import { sumMoney } from './calc'
import { receiptTotals } from './receipts'

/** 表头、页脚和选中小计共用口径：退单保留展示，不纳入销售额和待收。 */
export function orderListSummary(rows: { status: string; sales?: number; unpaid?: number }[]) {
  const active = rows.filter(row => row.status !== '退单')
  return {
    sales: sumMoney(active.map(row => row.sales ?? 0)),
    ...receiptTotals(active),
    hasSales: rows.some(row => row.sales !== undefined),
  }
}
