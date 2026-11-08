import type { AfterSale, Order, Role, User } from './types'
import { can } from './perm'
export function canSeeAfterSale(order: Pick<Order, 'ownerId' | 'deletedAt'>, a: Pick<AfterSale,'writerId'|'by'>, user: Pick<User,'id'>, role: Role) {
  if (order.deletedAt || !can(role,'order.view')) return false
  return role.locked || a.writerId === user.id || can(role,'order.create') && (a.by === user.id || order.ownerId === user.id)
}
