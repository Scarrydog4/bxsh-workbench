import type { OrderView } from './types'

export const receiptCandidate = (order: OrderView) => order.status !== '退单' && order.salesMode !== 'cost' && (order.unpaid ?? 0) > 0
export function moneyCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null
  const n = Math.round(Number(value) * 100)
  return Number.isSafeInteger(n) && n > 0 && n <= 100_000_000 ? n : null
}
/** 均分到分；某单待收不足时，其余金额分给其他订单。 */
export function distributeReceipt(total: number, orders: { id: string; unpaid?: number }[]): Record<string, string> | null {
  const caps = orders.map(o => Math.max(0, Math.round((o.unpaid ?? 0) * 100)))
  if (!Number.isSafeInteger(total) || total <= 0 || total > caps.reduce((a, b) => a + b, 0) || !orders.length) return null
  const amounts = orders.map(() => 0)
  let remaining = total
  while (remaining > 0) {
    const available = caps.map((cap, i) => ({ cap: cap - amounts[i], i })).filter(x => x.cap > 0)
    const share = Math.max(1, Math.floor(remaining / available.length))
    for (const { cap, i } of available) {
      const n = Math.min(cap, share, remaining)
      amounts[i] += n; remaining -= n
    }
  }
  if (amounts.some(n => n === 0)) return null
  return Object.fromEntries(orders.map((o, i) => [o.id, (amounts[i] / 100).toFixed(2)]))
}

/** 按订单价格比例分，例如每单都结 30%；某单待收不够时，多出的按比例给其他单。 */
export function distributeByPrice(total: number, orders: { id: string; sales?: number; unpaid?: number }[]): Record<string, string> | null {
  const caps = orders.map(o => Math.max(0, Math.round((o.unpaid ?? 0) * 100)))
  const weights = orders.map((o, i) => Math.max(1, Math.round((o.sales ?? o.unpaid ?? 0) * 100)) * (caps[i] > 0 ? 1 : 0))
  if (!Number.isSafeInteger(total) || total <= 0 || total > caps.reduce((a, b) => a + b, 0) || !orders.length) return null
  const amounts = orders.map(() => 0)
  let remaining = total
  while (remaining > 0) {
    const open = orders.map((_, i) => i).filter(i => amounts[i] < caps[i] && weights[i] > 0)
    const sum = open.reduce((n, i) => n + weights[i], 0)
    const shares = open.map(i => ({ i, exact: remaining * weights[i] / sum }))
    let given = 0
    for (const x of shares) { const n = Math.min(caps[x.i] - amounts[x.i], Math.floor(x.exact)); amounts[x.i] += n; given += n }
    // 余下的分按小数部分从大到小补一分
    for (const x of shares.sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
      if (given >= remaining) break
      if (amounts[x.i] < caps[x.i]) { amounts[x.i]++; given++ }
    }
    if (given === 0) return null
    remaining -= given
  }
  if (amounts.some(n => n === 0)) return null
  return Object.fromEntries(orders.map((o, i) => [o.id, (amounts[i] / 100).toFixed(2)]))
}
