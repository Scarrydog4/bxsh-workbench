import { can, rowVisible } from './perm'
import type { Order, Role } from './types'

export function canViewSettlement(batch: { kind: string; payeeId: string }, userId: string, role: Role) {
  const scope = role.locked ? 'all' : batch.kind === '写手工资' ? role.fields.writerPay : role.fields.commission
  return (can(role, 'settle.manage') && scope === 'all') || (batch.payeeId === userId && scope !== 'none')
}

/** A batch is indivisible: a restricted manager must see every associated order. */
export function settlementInOrderScope(batch: { lines: { orderId: string }[] }, orders: Pick<Order, 'id' | 'ownerId' | 'assignees'>[], userId: string, role: Role) {
  if (role.locked || role.rowScope === 'all') return true
  return batch.lines.every(line => {
    const order = orders.find(order => order.id === line.orderId)
    return !!order && rowVisible(order, { id: userId }, role)
  })
}
