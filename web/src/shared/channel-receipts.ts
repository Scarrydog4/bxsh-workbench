import type { Revoked } from './types'

export type ChannelReceiptTag = '定金' | '尾款' | '全款'
export interface ChannelReceipt {
  id: string
  no: string
  channelId: string
  /** 收款时的渠道归属快照，渠道转交不改历史现金流归属。 */
  ownerId: string
  amount: number
  date: string
  tag: ChannelReceiptTag
  note: string
  proof?: string
  createdBy: string
  createdAt: string
  revoked?: Revoked
  lines: { paymentId: string; orderId: string; no: string; title: string; amount: number }[]
  allocated: number
  unallocated: number
  revision: number
}
