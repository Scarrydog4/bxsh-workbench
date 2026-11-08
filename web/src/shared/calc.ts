import type { Order, PayStatus } from './types'
import { fixedAllocation, isFixedAllocation } from './allocation'

export const REFUND_TAG = '退款'

export const cents = (value: number) => Math.round(value * 100)
export const sumMoney = (values: number[]) => values.reduce((sum, value) => sum + cents(value), 0) / 100

export const extraCostTotal = (o: Pick<Order, 'extraCosts'>) => sumMoney((o.extraCosts ?? []).filter(line => !line.revoked).map(line => line.amount))
export const allocationBase = (o: Pick<Order, 'basePrice' | 'adjustments' | 'extraCosts'>) => Math.max(0, cents(sumMoney([o.basePrice, ...o.adjustments.filter(a => !a.revoked).map(a => a.amount)])) - cents(extraCostTotal(o))) / 100

export type CustomerStage = 'none' | 'deposit' | 'paidUp'

/** 收款灯只返回状态和日期，员工响应不会因此带出客户金额。 */
export function customerStage(o: Pick<Order, 'basePrice' | 'adjustments' | 'payments'>) {
  const sales = sumMoney([o.basePrice, ...o.adjustments.filter(a => !a.revoked).map(a => a.amount)])
  const received = sumMoney(o.payments.filter(p => !p.revoked).map(p => p.tag === REFUND_TAG ? -Math.abs(p.amount) : p.amount))
  const custStage: CustomerStage = received <= 0 ? 'none' : received >= sales ? 'paidUp' : 'deposit'
  const depositAt = o.payments.filter(p => !p.revoked && p.tag !== REFUND_TAG && p.amount > 0).map(p => p.date).sort()[0] ?? null
  return { custStage, depositAt, paidUpAt: customerPaidUpAt(o) }
}

/** 当前仍保持收齐的起点；退款、撤销和加价会重新检查，额外收款不改已达成日期。 */
export function customerPaidUpAt(o: Pick<Order, 'basePrice' | 'adjustments' | 'payments'>): string | null {
  const events = [
    ...o.adjustments.filter(a => !a.revoked).map(a => ({ at: a.at, price: cents(a.amount), received: 0 })),
    ...o.payments.filter(p => !p.revoked).map(p => ({ at: `${p.date}T12:00:00+08:00`, price: 0, received: cents(p.tag === REFUND_TAG ? -Math.abs(p.amount) : p.amount) })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  let price = cents(o.basePrice), received = 0, reached: string | null = null
  for (const event of events) {
    price += event.price
    received += event.received
    reached = price > 0 && received >= price ? reached ?? event.at : null
  }
  return reached
}

/** 当前归属人的应得提成；已付给前任销售的部分不再重复分配。 */
export function ownerCommission(o: Order, total: number) {
  if (o.salesMode === 'cost') return 0
  const paidOthers = sumMoney(o.settlements.filter(s => s.kind === '销售提成' && s.status === '已确认' && s.payeeId !== o.ownerId).map(s => s.amount))
  return Math.max(0, cents(total) - cents(paidOthers)) / 100
}

export function calc(o: Order, adminIds: Set<string>) {
  // 撤销了的收款、追加 / 减免只留痕，不计入金额
  const sales = sumMoney([o.basePrice, ...o.adjustments.filter(a => !a.revoked).map(a => a.amount)])
  const isSelf = adminIds.has(o.ownerId)
  const cost = o.salesMode === 'cost'
  const extraCosts = extraCostTotal(o)
  const netSales = sumMoney([sales, -extraCosts])
  const basis = Math.max(0, netSales)
  const fixed = isFixedAllocation(o) ? fixedAllocation(basis) : null
  const fixedPool = fixed && !o.writerRatesEnabled ? fixed : null
  const payPending = !fixedPool && (o.assignees.length === 0 || o.assignees.some((a) => a.pay === null && !((isSelf || cost) && adminIds.has(a.userId))))
  const externalWriterTotal = fixedPool ? sumMoney([fixedPool.writer, -sumMoney(o.assignees.filter(a => adminIds.has(a.userId)).map(a => a.pay ?? 0))]) : sumMoney([...o.assignees.filter(a => !adminIds.has(a.userId)).map(a => a.pay ?? 0), ...o.afterSales.filter(a => !adminIds.has(a.writerId)).map(a => a.extra)])
  const writerTotal = fixedPool ? fixedPool.writer : cost ? externalWriterTotal : sumMoney([...o.assignees.map(a => a.pay ?? 0), ...o.afterSales.map(a => a.extra)])
  const margin = (cents(netSales) - cents(writerTotal)) / 100
  const commission = isSelf || cost ? 0 : fixed ? fixed.sales : round2((extraCosts ? Math.max(0, margin) : margin) * o.commissionRate)
  const profit = cost ? round2(netSales - externalWriterTotal) : fixed ? round2(margin - commission) : isSelf ? margin : extraCosts ? round2(margin - commission) : round2(margin * (1 - o.commissionRate))
  const paidCommission = sumMoney(o.settlements.filter(s => s.kind === '销售提成' && s.status === '已确认').map(s => s.amount))
  const paidWriters = new Set(o.settlements.filter(s => s.kind === '写手工资' && s.status === '已确认' && !adminIds.has(s.payeeId)).map(s => s.payeeId))
  const writerOverpaid = sumMoney([...paidWriters].map(id => {
    const paid = sumMoney(o.settlements.filter(s => s.kind === '写手工资' && s.status === '已确认' && s.payeeId === id).map(s => s.amount))
    const due = sumMoney([o.assignees.find(a => a.userId === id)?.pay ?? 0, ...o.afterSales.filter(a => a.writerId === id).map(a => a.extra)])
    return Math.max(0, cents(paid) - cents(due)) / 100
  }))
  const externalWriterCost = o.extraCosts?.length ? sumMoney([externalWriterTotal, writerOverpaid]) : externalWriterTotal
  const commissionCost = cost ? 0 : Math.max(commission, paidCommission)
  const bossIncome = round2(netSales - externalWriterCost - commissionCost)
  const received = sumMoney(o.payments.filter(p => !p.revoked).map(p => p.tag === REFUND_TAG ? -Math.abs(p.amount) : p.amount))
  const unpaid = (cents(sales) - cents(received)) / 100
  const payStatus: PayStatus = received >= sales && sales > 0 ? '已收齐' : received > 0 ? '部分收款' : '未收款'
  return { sales, extraCostTotal: extraCosts, allocationBase: basis, externalWriterCost, commissionCost, writerTotal, payPending, isSelf, commission, profit, bossIncome, externalWriterTotal, received, unpaid, payStatus }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
