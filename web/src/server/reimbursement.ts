import type { Reimbursement } from '@/shared/reimbursement'
import type { Ctx } from './session'
import { sql } from 'drizzle-orm'
import { audit, reimbursements } from './schema'

export type ReimbursementRow = typeof reimbursements.$inferSelect
export const canViewReimbursement = (row: Pick<ReimbursementRow, 'applicantId'>, c: Ctx) => c.role.locked || row.applicantId === c.me.id
/** 审计权限不开放他人的报销金额、备注和凭证；在分页前过滤。 */
export function reimbursementAuditVisibility(c: Ctx) {
  return c.role.locked ? undefined : sql`(
    ${audit.objectType} <> 'reimbursement' OR EXISTS (
      SELECT 1 FROM ${reimbursements}
      WHERE ${reimbursements.id} = ${audit.objectId}
        AND ${reimbursements.applicantId} = ${c.me.id}
    )
  )`
}
export function reimbursementView(row: ReimbursementRow): Reimbursement {
  const { requests: _requests, ...record } = row
  return record
}
export function reimbursementProofs(row: ReimbursementRow): string[] {
  return [...new Set([...row.proofs, ...row.paymentProofs, ...row.history.flatMap(e => [...e.proofs, ...(e.submission?.proofs ?? [])])])]
}
