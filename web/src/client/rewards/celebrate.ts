import type { RewardKind } from '@/shared/rewards'

export const REWARD_EVENT = 'bxsh:reward'
export type RewardTrigger = { kind: RewardKind; orderId: string; afterSaleId?: string }

/** 服务器确认写入、订单已刷新之后调用；界面层（RewardHost）负责算数和播放。 */
export function celebrate(trigger: RewardTrigger) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<RewardTrigger>(REWARD_EVENT, { detail: trigger }))
}
