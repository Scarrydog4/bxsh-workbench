import type { User } from './types'
import type { FeedbackKind, FeedbackStatus } from './feedback'
import type { ForumAttachmentView } from './forum-files'
import { FORUM_COPY } from './copy/forum'

export const FORUM_CATEGORIES = ['announcement', 'feedback', 'skill', 'document', 'showcase'] as const
export type ForumCategory = typeof FORUM_CATEGORIES[number]
export const FORUM_CATEGORY_LABELS = FORUM_COPY.categories
export const FORUM_SORTS = ['activity', 'created'] as const
export type ForumSort = typeof FORUM_SORTS[number]
export type ForumAuthor = Pick<User, 'id' | 'name' | 'hue' | 'avatar' | 'frame'>

export interface ForumPostSummary {
  id: string
  no: string
  category: ForumCategory
  authorId: string
  author: ForumAuthor
  title: string
  excerpt: string
  feedbackKind: FeedbackKind | null
  status: FeedbackStatus | null
  private: boolean
  pinned: boolean
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  editedAt: string | null
  deletedAt: string | null
  replyCount: number
  attachmentCount: number
  likeCount: number
  liked: boolean
  unread: boolean
  canEdit: boolean
  canDelete: boolean
  canManage: boolean
}

export interface ForumReply {
  id: string
  postId: string
  authorId: string
  author: ForumAuthor
  body: string
  createdAt: string
  editedAt: string | null
  attachments: ForumAttachmentView[]
  canEdit: boolean
}

export interface ForumPostDetail extends ForumPostSummary {
  body: string
  attachments: ForumAttachmentView[]
  replies: ForumReply[]
}

export interface ForumPostList {
  rows: ForumPostSummary[]
  total: number
  next: number | null
  /** 只有老板返回待处理数；搜索和分页不影响这个角标。 */
  pendingFeedbackCount?: number
}

export interface ForumCreateInput {
  requestId: string
  category: ForumCategory
  title: string
  body?: string
  feedbackKind?: FeedbackKind
  private?: boolean
  attachmentIds?: string[]
}

export interface ForumEditInput extends Partial<Omit<ForumCreateInput, 'requestId'>> {
  requestId: string
  id: string
}

export interface ForumReplyInput {
  requestId: string
  id: string
  body?: string
  attachmentIds?: string[]
}

export interface ForumEditReplyInput extends ForumReplyInput { replyId: string; body: string }
