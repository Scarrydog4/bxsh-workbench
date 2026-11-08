import type { IncomeRow } from './income'
import type { SettleKind } from './settle'

export type IncomeBatchLine = { orderId: string; no: string; title: string; amount: number }

/** 工资和追加工资共享整单可发金额，只能按订单计一次。 */
export function incomeBatchLines(rows: IncomeRow[], kind: SettleKind): IncomeBatchLine[] {
  const lines = new Map<string, IncomeBatchLine>()
  for (const row of rows) {
    const matches = kind === '写手工资' ? row.kind === '工资' || row.kind === '追加工资' : row.kind === '提成'
    if (!matches || row.amount === null || row.status === '退单' || !Number.isFinite(row.available) || !(row.available! > 0)) continue
    lines.set(row.id, { orderId: row.id, no: row.no, title: row.title, amount: row.available! })
  }
  return [...lines.values()]
}
