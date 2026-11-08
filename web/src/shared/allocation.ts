export type AllocationPolicy = 'legacy' | 'fixed_60_20_20_v1'

export const ALLOCATION_START = '2026-10-16'

/** 在创建时保存制度；之后调整下单日期不重新选制度。 */
export function allocationPolicyForDate(creationDate: string): AllocationPolicy {
  return creationDate >= ALLOCATION_START ? 'fixed_60_20_20_v1' : 'legacy'
}

export function isFixedAllocation(order: { allocationPolicy?: AllocationPolicy; salesMode?: string }) {
  return order.allocationPolicy === 'fixed_60_20_20_v1' && order.salesMode !== 'cost'
}

/** 按分计算，无法整分的尾差归老板，三份之和始终等于订单金额。 */
export function fixedAllocation(amount: number) {
  const total = Math.max(0, Math.round(amount * 100))
  const share = Math.floor(total / 5)
  return { boss: (total - 2 * share) / 100, sales: share / 100, writer: share / 100 }
}
