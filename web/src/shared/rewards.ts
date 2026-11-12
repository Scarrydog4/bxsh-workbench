import type { OrderView } from './types'

/** 录单、交付、发起跟进之后的即时反馈：撒花 + 一句话（有钱就带上钱）。只读已授权给本人的数据，不设目标。 */
export type RewardKind = 'order' | 'deliver' | 'followup-done' | 'followup-new'

export interface RewardData {
  kind: RewardKind
  /** 这一下对应的钱；null = 金额还没定，或这次不涉及钱 */
  amount: number | null
  amountLabel: string
  /** 没有金额时的一句致谢；空串 = 什么都不说，只撒花（原有的成功提示已经够了） */
  thanks: string
}

export interface RewardInput {
  kind: RewardKind
  me: { id: string; canWrite: boolean }
  order?: OrderView
  /** 交付或发起的那一轮跟进 */
  followup?: { extra?: number; writerId: string }
}

export function buildReward({ kind, me, order, followup }: RewardInput): RewardData {
  const positive = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? n : null)
  if (kind === 'order') {
    // 写手工资没定时提成还算不出来，不显示 0；老板替销售录单时那是销售的提成，不算到录单人头上
    const ownCommission = order?.ownerId === me.id && !order.payPending ? positive(order.commission) : null
    return { kind, amount: ownCommission, amountLabel: '这单预计提成', thanks: '' }
  }
  const mine = me.canWrite && (followup ? followup.writerId === me.id : !!order?.assignees.some((a) => a.userId === me.id))
  if (kind === 'deliver') {
    const pay = order?.myPay ?? order?.assignees.find((a) => a.userId === me.id)?.pay
    return { kind, amount: mine ? positive(pay) : null, amountLabel: '这单工资', thanks: mine ? '感谢你对这单的付出' : '' }
  }
  if (kind === 'followup-done') {
    return { kind, amount: mine ? positive(followup?.extra) : null, amountLabel: '这轮追加工资', thanks: mine ? '感谢你把这单跟到底' : '' }
  }
  return { kind, amount: null, amountLabel: '', thanks: mine ? '主动跟进这单，感谢你对订单的付出' : '感谢你一直把这单放在心上' }
}
