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
export type ReviewKind = 'penalty' | 'reward'
export const REVIEW_KIND: Record<ReviewKind, string> = { penalty: '惩罚', reward: '奖励' }
/** 常用分类；也可以直接写新的，比如「提出新制度」 */
export const REVIEW_CATEGORIES: Record<ReviewKind, string[]> = {
  penalty: ['回复不及时', '质量差', '渠道或学生差评', '拖稿'],
  reward: ['好评', '加急完成', '提建议'],
}
/** 金额：奖励为正、罚款为负；没金额或撤销的不算 */
export const signedAmount = (r: Pick<QualityReview, 'kind' | 'amount' | 'revokedAt'>) => !r.amount || r.revokedAt ? 0 : r.kind === 'reward' ? r.amount : -r.amount
/** 能跟工资一起结的：有金额、没撤销、没结过；罚款要写手回复后老板确认了才扣 */
export const payable = (r: Pick<QualityReview, 'kind' | 'amount' | 'revokedAt' | 'settledAt' | 'status'>) => !!r.amount && !r.revokedAt && !r.settledAt && (r.kind === 'reward' || r.status === 'done')
export interface QualityReview {
  id: string
  kind: ReviewKind
  category: string
  /** null = 只复盘，不涉及钱 */
  amount: number | null
  revokedAt: string | null
  revokeReason: string
  settledAt: string | null
  title: string
  issue: string
  image: string | null
  images?: string[]
  status: keyof typeof reviewStatus
  orderId: string | null
  repliedAt: string | null
  confirmedAt: string | null
  orderNo: string | null
  orderTitle: string | null
  writerId: string
  writerName: string
  ownerId: string | null
  ownerName: string | null
  history: ReviewMessage[]
  reply: string
  createdAt: string
}
