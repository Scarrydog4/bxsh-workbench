import { expect, it, vi } from 'vitest'
import type { World } from '@/server/repo'
import type { ChannelReceipt } from '@/shared/channel-receipts'
import type { Order, Role, User } from '@/shared/types'

vi.mock('@/server/repo', () => ({ adminIdsOf: () => new Set(['boss']) }))
import { statement } from '@/server/statement'

const role: Role = { id: 'sales-role', name: '销售', locked: false, preset: true, rowScope: 'owned', perms: ['statement.view', 'channel.view', 'order.view'], fields: { sales: true, writerPay: 'none', commission: 'own', profit: false, channelNo: true } }
const user = { id: 'sales', roleId: role.id } as User
const receipt = (patch: Partial<ChannelReceipt> = {}): ChannelReceipt => ({ id: 'r', no: 'SK1', channelId: 'channel', ownerId: user.id, amount: 1000, allocated: 300, unallocated: 700, date: '2026-10-05', tag: '定金', note: '内部备注不能分享', proof: '/private-proof.png', createdBy: 'boss', createdAt: '2026-10-05', revision: 1, lines: [], ...patch })
const order = (patch: Partial<Order> = {}): Order => ({ id: 'order', no: 'DD1', title: '测试订单', channelId: 'channel', ownerId: 'sales', creatorId: 'sales', orderDate: '2026-10-01', dueDate: null, channelNo: '', type: '', wechatGroup: '', draftAt: null, basePrice: 1000, commissionRate: .5, note: '', status: '未交付', assignees: [{ userId: 'writer', pay: 100 }], payments: [{ id: 'p', amount: 300, date: '2026-10-05', tag: '定金', note: '', by: 'sales', receiptId: 'r' }], adjustments: [], attachments: [], afterSales: [], settlements: [], req: {}, nodes: [], receivables: [], reviewFlag: null, deletedAt: null, ...patch })
const world = (receipts: ChannelReceipt[], orders: Order[] = []): World => ({ users: [user], roles: [role], channels: [{ id: 'channel', name: '测试渠道', ownerId: 'sales', note: '', active: true }], orders, channelReceipts: receipts, statuses: [], types: [], payTags: [], nodeTags: [], cardFields: [], nodeTemplates: [], batches: [], defaultWriterId: null })

it('本月未分配预收单列，不抵减订单未收；排除其他月、全分配和撤销，分享数据不含内部内容', () => {
  const data = world([receipt(), receipt({ id: 'old', date: '2026-09-05' }), receipt({ id: 'allocated', allocated: 1000, unallocated: 0 }), receipt({ id: 'void', revoked: { by: 'boss', at: '2026-10-06', reason: '记错' } })], [order()])
  const result = statement(data, user, role, 'channel', '2026-10')!
  expect(result.total).toEqual({ sales: 1000, received: 300, unpaid: 700 })
  expect(result.prepaymentTotal).toBe(700)
  expect(result.prepayments).toEqual([{ no: 'SK1', date: '2026-10-05', amount: 1000, allocated: 300, unallocated: 700 }])
  expect(JSON.stringify(result)).not.toContain('内部备注')
  expect(JSON.stringify(result)).not.toContain('private-proof')
  const noOrders = statement(world([receipt()]), user, role, 'channel', '2026-10')!
  expect(noOrders.rows).toEqual([])
  expect(noOrders.prepaymentTotal).toBe(700)
})

it('沿用整笔收款可见性，不能从自己的渠道对账读取他人不可见订单的收款总额', () => {
  const data = world([receipt({ lines: [{ paymentId: 'p', orderId: 'order', no: 'DD1', title: '隐藏订单', amount: 300 }] })], [order({ ownerId: 'other' })])
  expect(statement(data, user, role, 'channel', '2026-10')?.prepayments).toEqual([])
  expect(statement(data, user, { ...role, locked: true }, 'channel', '2026-10')?.prepaymentTotal).toBe(700)
  expect(statement(data, { ...user, id: 'other' }, role, 'channel', '2026-10')).toBeNull()
  expect(statement(data, user, { ...role, fields: { ...role.fields, sales: false } }, 'channel', '2026-10')).toBeNull()
  expect(statement(data, user, { ...role, perms: ['statement.view'] }, 'channel', '2026-10')?.prepayments).toEqual([])
})
