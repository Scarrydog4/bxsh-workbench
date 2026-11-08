import type { Order } from './types'
import { calc, cents, customerStage, ownerCommission, sumMoney } from './calc'
import { paydayKey } from './format'

/** 每单、每人、每种收入的应得和实发。草稿不占用，交付记录不限制发放。 */
export type SettleKind = '写手工资' | '销售提成'

export interface DueItem {
  amount: number
  /** 发放期 2026-10-15；还没交初稿的原工资为 null */
  period: string | null
}

export function dueItems(o: Order, kind: SettleKind, payeeId: string, adminIds: Set<string>, _deliveredOnly = false): DueItem[] {
  if (kind === '写手工资') {
    const out: DueItem[] = []
    const a = o.assignees.find((x) => x.userId === payeeId)
    if (a?.pay) out.push({ amount: a.pay, period: paydayKey(o.draftAt) })
    for (const x of o.afterSales) if (x.writerId === payeeId && x.extra > 0) out.push({ amount: x.extra, period: paydayKey(x.start) })
    return out
  }
  if (o.salesMode === 'cost' || o.ownerId !== payeeId) return []
  const c = calc(o, adminIds)
  return c.isSelf || c.payPending || ownerCommission(o, c.commission) <= 0 ? [] : [{ amount: ownerCommission(o, c.commission), period: null }]
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function settled(o: Order, kind: SettleKind, payeeId: string, opts: { drafts?: boolean; exceptBatch?: string } = {}) {
  return r2(
    o.settlements
      .filter((x) => x.kind === kind && x.payeeId === payeeId && (!opts.exceptBatch || x.batchId !== opts.exceptBatch) && x.status === '已确认')
      .reduce((s, x) => s + x.amount, 0),
  )
}

/** 剩余应得仅扣已确认实发，旧 period 参数不再限制发放。 */
export function remaining(o: Order, kind: SettleKind, payeeId: string, adminIds: Set<string>, opts: { period?: string; exceptBatch?: string } = {}) {
  const due = sumMoney(dueItems(o, kind, payeeId, adminIds).map(d => d.amount))
  return Math.max(0, r2(due - settled(o, kind, payeeId, { exceptBatch: opts.exceptBatch })))
}

/** 现任收款人的应得；前任仅保留已有实发，不重新生成应付。 */
export function entitlement(o: Order, kind: SettleKind, payeeId: string, adminIds: Set<string>): number | null {
  if (adminIds.has(payeeId)) return 0
  if (kind === '写手工资') {
    const a = o.assignees.find(a => a.userId === payeeId)
    if (a?.pay === null) return null
    if (!a && !o.afterSales.some(x => x.writerId === payeeId && x.extra > 0)) return settled(o, kind, payeeId)
  } else {
    if (o.ownerId !== payeeId) return settled(o, kind, payeeId)
    if (o.salesMode !== 'cost' && calc(o, adminIds).payPending) return null
  }
  return sumMoney(dueItems(o, kind, payeeId, adminIds).map(d => d.amount))
}

/** 建议金额向下取整到分；草稿已退出发放流程，不扣草稿。 */
export function incomeAmounts(o: Order, kind: SettleKind, payeeId: string, adminIds: Set<string>) {
  const due = entitlement(o, kind, payeeId, adminIds)
  const paid = settled(o, kind, payeeId)
  const { sales, received } = calc(o, adminIds)
  const dueCents = cents(due ?? 0), paidCents = cents(paid)
  const proportional = sales > 0 ? Number(BigInt(dueCents) * BigInt(Math.min(cents(sales), Math.max(0, cents(received)))) / BigInt(cents(sales))) : 0
  return {
    due, paid,
    left: Math.max(0, dueCents - paidCents) / 100,
    over: due === null ? 0 : Math.max(0, paidCents - dueCents) / 100,
    suggest: Math.max(0, proportional - paidCents) / 100,
    ...customerStage(o),
  }
}

export interface Candidate {
  orderId: string
  no: string
  title: string
  status: string
  remaining: number
  /** 默认勾不勾：退单（写手结不结由管理员定）、提成没收齐的默认不勾 */
  suggested: boolean
}

/** 新建结算单时列出这个人还没结清的单 */
export function candidates(orders: Order[], kind: SettleKind, payeeId: string, adminIds: Set<string>, opts: { period?: string; exceptBatch?: string } = {}): Candidate[] {
  const out: Candidate[] = []
  for (const o of orders) {
    if (o.deletedAt) continue
    const left = remaining(o, kind, payeeId, adminIds, opts)
    if (left <= 0) continue
    const paidUp = calc(o, adminIds).payStatus === '已收齐'
    out.push({ orderId: o.id, no: o.no, title: o.title, status: o.status, remaining: left, suggested: o.status !== '退单' && (kind === '写手工资' || paidUp) })
  }
  return out.sort((a, b) => (a.no < b.no ? -1 : 1))
}

/** 一单一种收入的进度；追加工资共用这份进度，汇总时不能重复相加。 */
export function settleProgress(o: Order, kind: SettleKind, payeeId: string, adminIds: Set<string>) {
  const paid = settled(o, kind, payeeId)
  const due = r2(dueItems(o, kind, payeeId, adminIds).reduce((sum, x) => sum + x.amount, 0))
  return { key: `${o.id}:${kind}`, paid, unpaid: Math.max(0, r2(due - paid)) }
}

/** 我的收入上每单的结算情况 */
export function settleState(o: Order, kind: SettleKind, payeeId: string, adminIds: Set<string>): '未结' | '部分已结' | '已结' {
  const due = r2(dueItems(o, kind, payeeId, adminIds).reduce((s, d) => s + d.amount, 0))
  const done = settled(o, kind, payeeId)
  if (done <= 0) return '未结'
  if (done < due) return '部分已结'
  return '已结'
}
