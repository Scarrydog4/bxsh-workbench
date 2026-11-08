import type { User } from './types'

export const FEEDBACK_KINDS = ['问题', '建议'] as const
export const FEEDBACK_STATUSES = ['待处理', '处理中', '已解决', '暂不处理'] as const
export type FeedbackKind = typeof FEEDBACK_KINDS[number]
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number]
export type FeedbackAuthor = Pick<User, 'id' | 'name' | 'hue' | 'avatar' | 'frame'>

export interface FeedbackReply {
  id: string
  by: string
  author: FeedbackAuthor
  body: string
  shots: string[]
  at: string
}

export interface Feedback {
  id: string
  no: string
  authorId: string
  author: FeedbackAuthor
  kind: FeedbackKind
  title: string
  body: string
  shots: string[]
  status: FeedbackStatus
  createdAt: string
  updatedAt: string
  replies: FeedbackReply[]
}

export interface FeedbackList {
  rows: Feedback[]
  total: number
  next: number | null
}

export interface FeedbackCreate {
  requestId: string
  kind: FeedbackKind
  title: string
  body: string
  shots: string[]
}
export interface FeedbackReplyInput {
  requestId: string
  id: string
  body: string
  shots: string[]
}
export interface FeedbackUpdate {
  requestId: string
  id: string
  status: FeedbackStatus
}
