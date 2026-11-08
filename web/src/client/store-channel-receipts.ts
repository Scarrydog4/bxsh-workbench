import type { ChannelReceiptTag } from '@/shared/channel-receipts'
import { act, refresh } from './store'

export type ReceiptCreateInput = { requestId: string; channelId: string; amount: number; date: string; tag: ChannelReceiptTag; note: string; proof?: string; mode: 'allocate' | 'advance'; lines: { orderId: string; amount: number }[] }
export type ReceiptAllocateInput = { requestId: string; id: string; revision: number; lines: { orderId: string; amount: number }[] }
export async function saveChannelReceipt(action: 'channelReceipt.create' | 'channelReceipt.allocate', input: ReceiptCreateInput | ReceiptAllocateInput) {
  let rejected = false
  const result = await act<{ id: string; amount: number; count: number }>(action, input, { onRejected: () => { rejected = true } })
  if (!result || typeof result.id !== 'string' || !Number.isFinite(result.amount)) return { status: rejected ? 'rejected' as const : 'unknown' as const }
  await refresh(true)
  return { status: 'success' as const, result }
}
