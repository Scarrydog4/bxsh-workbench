import type { User } from './types'
import type { ForumAttachmentView } from './forum-files'

export const DM_BODY_LIMIT = 5000
export const DM_RETRACT_MS = 120_000
export type DmPerson = Pick<User, 'id' | 'name' | 'hue' | 'avatar' | 'frame' | 'active'>
export interface DmMessage {
  id: string
  threadId: string
  senderId: string
  body: string
  createdAt: string
  retractedAt: string | null
  attachments: ForumAttachmentView[]
}
export interface DmThread {
  id: string
  participants: [DmPerson, DmPerson]
  counterpart: DmPerson | null
  readOnly: boolean
  canSend: boolean
  createdAt: string
  updatedAt: string
  lastMessage: DmMessage | null
  lastMessagePreview: string
  unreadCount: number
  readAt: string | null
  counterpartReadAt: string | null
}
export interface DmThreadList {
  mine: DmThread[]
  others: DmThread[]
  totalUnread: number
  next: { mine: number | null; others: number | null }
}
export interface DmMessagePage {
  thread: DmThread
  /** Chronological order within this page. Use next to load the preceding page. */
  rows: DmMessage[]
  next: string | null
  lastOwnMessageId: string | null
  lastOwnMessageRead: boolean
}
export interface DmStartInput { requestId: string; userId: string }
export interface DmSendInput { requestId: string; threadId: string; body: string; attachmentIds: string[] }
export interface DmRetractInput { requestId: string; id: string }
export interface DmReadInput { requestId: string; threadId: string }
