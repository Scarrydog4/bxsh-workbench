/** 客户链接只使用以下公开字段，不能复用内部订单 DTO。 */
export const CUSTOMER_PORTAL_LIMITS = {
  nameLength: 40,
  bodyLength: 2000,
  images: 3,
  requestBytes: 6 * 1024 * 1024,
  nudgeCooldownMinutes: 30,
  nudgesPerDay: 6,
  requirementsPerDay: 20,
} as const

export type CustomerRequestKind = 'nudge' | 'requirement'
export type CustomerRequestStatus = 'pending' | 'handled'
export type CustomerRequest = {
  id: string
  kind: CustomerRequestKind
  name: string
  body: string
  shots: string[]
  status: CustomerRequestStatus
  reply: string
  createdAt: string
  handledAt: string | null
}
export type CustomerPortalLink = { id: string | null; active: boolean; path: string | null }
export type CustomerPortalView = {
  order: { title: string; status: string; dueDate: string | null }
  requests: CustomerRequest[]
  nudgeAvailableAt: string | null
}
export type CustomerPortalInternal = {
  canManage: boolean
  canResolve: boolean
  link: CustomerPortalLink
  requests: CustomerRequest[]
  hasMore: boolean
  nextOffset: number | null
}
export type CustomerSubmission = {
  clientId: string
  requestId: string
  kind: CustomerRequestKind
  name?: string
  body?: string
  shots?: string[]
}
