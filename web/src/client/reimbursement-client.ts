import type { ReimbursementList, ReimbursementSubmission } from '@/shared/reimbursement'
import { act, refresh } from './store'

export type ReimbursementAction = 'submit' | 'confirm' | 'reject' | 'withdraw' | 'undo'
export type SubmissionRequest = ReimbursementSubmission & { requestId: string; id?: string; expectedVersion?: number }
export type ReviewRequest = { requestId: string; id: string; expectedVersion: number; paidDate?: string; note?: string; proofs?: string[]; reason?: string }
export type ReimbursementRequest = SubmissionRequest | ReviewRequest
export type ReimbursementOutcome = { status: 'success'; id: string } | { status: 'rejected' | 'unknown' }
export async function sendReimbursement(action: ReimbursementAction, input: ReimbursementRequest): Promise<ReimbursementOutcome> {
  let rejected = false
  const result = await act<{ id: string }>(`reimburse.${action}`, input, { onRejected: () => { rejected = true } })
  if (!result || typeof result.id !== 'string' || !result.id) return { status: rejected ? 'rejected' : 'unknown' }
  await refresh(true)
  return { status: 'success', id: result.id }
}
export async function fetchReimbursements(query: { id?: string; status?: string; applicant?: string; q?: string; offset?: number } = {}): Promise<ReimbursementList> {
  const params = new URLSearchParams({ limit: '50' })
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value))
  const response = await fetch(`/api/reimbursements?${params}`, { cache: 'no-store' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? '报销记录加载失败')
  return result
}
