import { expect, it } from 'vitest'
import { remaining, settleState } from '@/shared/settle'
import { paydayKey } from '@/shared/format'
import type { Order } from '@/shared/types'
it('合并后的结算扣除历史已发金额，转交不重复支付前任提成', () => {
  const o = { ownerId: 'new-sales', basePrice: 1000, commissionRate: .1, assignees: [{ userId: 'writer', pay: 400 }], adjustments: [], payments: [], afterSales: [], settlements: [{ id: 'old', kind: '销售提成', payeeId: 'old-sales', amount: 20, status: '已确认', migrated: true }, { id: 'wage', kind: '写手工资', payeeId: 'writer', amount: 400, status: '已确认', migrated: true }] } as unknown as Order
  expect(remaining(o, '销售提成', 'new-sales', new Set())).toBe(40)
  expect(remaining(o, '写手工资', 'writer', new Set())).toBe(0)
  expect(settleState(o, '写手工资', 'writer', new Set())).toBe('已结')
})
it('结算发放期与北京时间月中边界保持一致', () => {
  expect(paydayKey('2026-10-14T16:30:00Z')).toBe('2026-11-15')
  expect(paydayKey('2026-12-14T16:30:00Z')).toBe('2027-01-15')
})
