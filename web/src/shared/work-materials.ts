import type { Role, User } from './types'
import { can } from './perm'

/** 素材由管理员、销售和写手共同维护；仅查看订单的账号仍保持只读。 */
export function canMaintainMaterials(role: Role, user: Pick<User, 'canWrite'>) {
  return role.locked || (can(role, 'order.view') && (can(role, 'order.create') || user.canWrite))
}

export type MaterialKind = 'case' | 'talk'
export const UNCATEGORIZED = '未分类'
export interface Material {
  id: string
  kind: MaterialKind
  title: string
  content: string
  category: string
  major: string
  images: string[]
  image: string | null
  fileName: string | null
  favorite: boolean
}
export const reviewStatus = { pending: '待回复', waiting: '待确认', done: '已完成' } as const
export interface ReviewMessage {
  type: 'reply' | 'supplement'
  text: string
  /** 回复里贴的图片，存内容哈希。 */
  images?: string[]
  actorId: string
  actorName: string
  at: string
}
export interface QualityReview {
  id: string
  title: string
  issue: string
  image: string | null
  images?: string[]
  status: keyof typeof reviewStatus
  orderId: string
  repliedAt: string | null
  confirmedAt: string | null
  orderNo: string
  orderTitle: string
  writerId: string
  writerName: string
  ownerId: string
  ownerName: string | null
  history: ReviewMessage[]
  reply: string
  createdAt: string
}
