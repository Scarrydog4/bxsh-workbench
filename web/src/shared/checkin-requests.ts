import type { CheckinScope } from './checkin'

export const CHECKIN_REQUEST_KINDS = ['late', 'early', 'leave', 'overtime', 'weekend'] as const
export type CheckinRequestKind = typeof CHECKIN_REQUEST_KINDS[number]
export type CheckinRequestStatus = 'pending' | 'approved' | 'rejected'
export const CHECKIN_REQUEST_LABELS: Record<CheckinRequestKind, string> = {
  late: '晚到申请', early: '早退申请', leave: '请假申请', overtime: '加班申请', weekend: '周末出勤申请',
}
export const CHECKIN_REQUEST_STATUS_LABELS: Record<CheckinRequestStatus, string> = {
  pending: '待审批', approved: '已批准', rejected: '已拒绝',
}

export interface CheckinRequestInput {
  requestId: string
  kind: CheckinRequestKind
  startAt: string
  endAt: string
  reason: string
}

export interface CheckinRequestRecord {
  id: string
  userId: string
  name: string
  avatar?: string
  hue: number
  kind: CheckinRequestKind
  startAt: string
  endAt: string
  reason: string
  status: CheckinRequestStatus
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
  decisionReason: string | null
}

export interface CheckinRequestList {
  /** 待审批队列跨所有月份；历史记录按月份查询。 */
  month: string | null
  scope: CheckinScope
  rows: CheckinRequestRecord[]
  total: number
  next: number | null
}

export interface CheckinRequestResult {
  record: CheckinRequestRecord
  created: boolean
}
