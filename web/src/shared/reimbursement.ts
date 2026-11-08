export const REIMBURSEMENT_CATEGORIES = ['图纸', '投流', '其他'] as const
export const REIMBURSEMENT_STATUSES = ['待处理', '已报销', '已退回', '已撤回'] as const
export type ReimbursementCategory = typeof REIMBURSEMENT_CATEGORIES[number]
export type ReimbursementStatus = typeof REIMBURSEMENT_STATUSES[number]

export interface ReimbursementSubmission {
  category: ReimbursementCategory
  amount: number
  expenseDate: string
  note: string
  proofs: string[]
  orderId: string | null
}

export interface ReimbursementEvent {
  id: string
  action: '提交' | '撤回' | '报销' | '退回' | '撤销报销'
  by: string
  at: string
  from: ReimbursementStatus | null
  to: ReimbursementStatus
  note: string
  proofs: string[]
  paidDate?: string
  submission?: ReimbursementSubmission
}

export interface Reimbursement extends ReimbursementSubmission {
  id: string
  no: string
  applicantId: string
  version: number
  status: ReimbursementStatus
  createdAt: string
  updatedAt: string
  paidDate: string | null
  paidAt: string | null
  paidBy: string | null
  paymentNote: string
  paymentProofs: string[]
  reason: string
  history: ReimbursementEvent[]
}

export interface ReimbursementList {
  rows: Reimbursement[]
  total: number
  next: number | null
  summary: { pendingAmount: number; paidAmount: number; pendingCount: number; paidCount: number }
}
