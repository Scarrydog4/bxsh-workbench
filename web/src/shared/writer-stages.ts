import type { Order, OrderView, WriterPayPlan } from './types'
import { customerPaidUpAt } from './calc'

export type WriterStageKey = 'completed' | 'groupSent' | 'graduated' | 'balance'
export interface WriterPayStage {
  key: WriterStageKey
  label: string
  percent: number
  amount: number | null
  completedAt: string | null
  /** 旧阶段展示的完成条件，仅供管理员兼容展示；不再决定可发金额。 */
  eligible: boolean
  /** 毕业已确认，但本人尚未完成初稿或群内交付。 */
  waitingForPrevious?: boolean
  /** 两期方案尚缺的条件，不包含客户金额。 */
  waitingFor?: 'initial' | 'group' | 'customerPayment'
}

type ProgressOrder = Pick<OrderView, 'writerPayPlan' | 'writerProgress' | 'graduatedAt' | 'draftAt' | 'assignees'>
type WageOrder = ProgressOrder & Pick<OrderView, 'settlements' | 'afterSales' | 'customerPaidUpAt'> & Partial<Pick<Order, 'basePrice' | 'adjustments' | 'payments'>>
const cents = (amount: number) => Math.round(amount * 100)

export const isTwoStageWriterPay = (o: { writerPayPlan?: WriterPayPlan }) => o.writerPayPlan === 'completed_balance_50_50'
export const isStagedWriterPay = (o: { writerPayPlan?: WriterPayPlan }) => o.writerPayPlan === 'staged' || isTwoStageWriterPay(o)

/** 最后一笔取余额，三笔精确等于约定工资。 */
export function writerStageAmounts(pay: number) {
  const total = cents(pay), completed = Math.round(total * .5), groupSent = Math.round(total * .2)
  return { completed: completed / 100, groupSent: groupSent / 100, graduated: (total - completed - groupSent) / 100 }
}

export function writerTwoStageAmounts(pay: number) {
  const total = cents(pay), completed = Math.round(total * .5)
  return { completed: completed / 100, balance: (total - completed) / 100 }
}

export function writerInitialDone(o: ProgressOrder, userId?: string) {
  if (!isStagedWriterPay(o)) return !!o.draftAt
  const writers = userId ? o.assignees.filter(a => a.userId === userId) : o.assignees
  return writers.length > 0 && writers.every(a => o.writerProgress?.some(p => p.userId === a.userId && !!p.completedAt && (!isTwoStageWriterPay(o) || p.completedProofIds.length > 0)))
}

export function writerGroupDone(o: ProgressOrder, userId?: string) {
  if (!isStagedWriterPay(o)) return !!o.draftAt
  const writers = userId ? o.assignees.filter(a => a.userId === userId) : o.assignees
  return writers.length > 0 && writers.every(a => o.writerProgress?.some(p => p.userId === a.userId && !!p.completedAt && !!p.groupSentAt && (!isTwoStageWriterPay(o) || p.completedProofIds.length > 0 && p.groupProofIds.length > 0)))
}

export function writerStageSummary(o: WageOrder, payeeId: string): WriterPayStage[] {
  if (!isStagedWriterPay(o)) return []
  const a = o.assignees.find(a => a.userId === payeeId)
  if (!a) return []
  const pay = a.pay ?? null
  const p = o.writerProgress?.find(p => p.userId === payeeId)
  if (isTwoStageWriterPay(o)) {
    const amounts = pay === null ? null : writerTwoStageAmounts(pay)
    const first = writerInitialDone(o, payeeId) ? p!.completedAt : null
    const sent = writerGroupDone(o, payeeId) ? p!.groupSentAt : null
    // 完整订单始终以当前账本为准；员工视图只接收服务端裁剪后的收齐日期。
    const paidAt = typeof o.basePrice === 'number' && o.adjustments && o.payments
      ? customerPaidUpAt({ basePrice: o.basePrice, adjustments: o.adjustments, payments: o.payments })
      : o.customerPaidUpAt ?? null
    const balanceAt = first && sent && paidAt ? [first, sent, paidAt].sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] : null
    return [
      { key: 'completed', label: '初稿完成', percent: 50, amount: amounts?.completed ?? null, completedAt: first, eligible: !!first, ...(!first ? { waitingFor: 'initial' as const } : {}) },
      { key: 'balance', label: '工资尾款', percent: 50, amount: amounts?.balance ?? null, completedAt: balanceAt, eligible: !!balanceAt, ...(!balanceAt ? { waitingFor: !first ? 'initial' as const : !sent ? 'group' as const : 'customerPayment' as const } : {}) },
    ]
  }
  const amounts = pay === null ? null : writerStageAmounts(pay)
  const first = p?.completedAt ?? null
  const sent = first ? p?.groupSentAt ?? null : null
  const graduated = sent && o.graduatedAt ? (new Date(sent).getTime() > new Date(o.graduatedAt).getTime() ? sent : o.graduatedAt) : null
  const stages: WriterPayStage[] = [
    { key: 'completed', label: '初稿完成', percent: 50, completedAt: first },
    { key: 'groupSent', label: '群内交付', percent: 20, completedAt: sent },
    { key: 'graduated', label: '毕业尾款', percent: 30, completedAt: graduated, ...(o.graduatedAt && !sent ? { waitingForPrevious: true } : {}) },
  ].map(s => ({ ...s, key: s.key as WriterStageKey, amount: amounts?.[s.key as keyof NonNullable<typeof amounts>] ?? null, eligible: !!s.completedAt }))

  return stages
}
