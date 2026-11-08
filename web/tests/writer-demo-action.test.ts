import { beforeEach, expect, it, vi } from 'vitest'
import type { Order, Role, User } from '@/shared/types'
import type { Tx } from '@/server/db'
import type { Ctx } from '@/server/session'
import type { World } from '@/server/repo'

vi.mock('@/server/db', () => ({ db: {} }))
vi.mock('sharp', () => ({ default: () => ({ metadata: async () => ({ width: 100, height: 100 }) }) }))
import { ACTIONS } from '@/server/actions'
import * as tables from '@/server/schema'

const action = ACTIONS['order.markDraft']
const role: Role = { id: 'writer', name: '写手', locked: false, preset: true, perms: ['order.view', 'order.draft'], rowScope: 'assigned', fields: { sales: false, writerPay: 'own', commission: 'none', profit: false, channelNo: false } }
const writer = { me: { id: 'writer', name: '写手' } as User, role, ip: 'test' } as Ctx
let order: Order, changes: { table: unknown; values: Record<string, unknown> }[], proofs: unknown[]
const tx = {
  select: () => ({ from: () => ({ where: async () => proofs }) }),
  update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { changes.push({ table, values }); if (table === tables.orders) order = { ...order, ...values } } }) }),
  insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => { changes.push({ table, values }); return { onConflictDoUpdate: async () => {} } } }),
} as unknown as Tx
const run = (payload: Record<string, unknown> = {}, ctx = writer) => action.run(tx, ctx, { orders: [order] } as World, action.schema.parse({ id: 'o', proofIds: ['proof'], ...payload }))

beforeEach(() => {
  order = { id: 'o', no: 'DD-test', title: '演示验证', status: '未交付', deletedAt: null, ownerId: 'sales', assignees: [{ userId: 'writer', pay: 100 }], afterSales: [], writerPayPlan: 'completed_balance_50_50', writerProgress: [], draftAt: null } as unknown as Order
  changes = []
  proofs = [{ id: 'proof', afterSaleId: null, purpose: 'file', mime: 'image/png', path: '/not-read-mocked.png' }]
})

it('本人附图发演示只改状态和留痕，不记录正式交付时间或写作/结算进度；重试不重复写', async () => {
  await run({ mode: 'demo' })
  expect(order.status).toBe('已发演示')
  expect(order.draftAt).toBeNull()
  expect(order.writerProgress).toEqual([])
  expect(changes.map(change => change.table)).toEqual([tables.orders, tables.audit])
  expect(changes[0].values).toEqual({ status: '已发演示', updatedAt: expect.any(String) })
  expect(changes[1].values).toMatchObject({ action: '发演示', from: '未交付', to: '已发演示', actorId: 'writer' })
  await run({ mode: 'demo' })
  expect(changes).toHaveLength(2)
})

it.each(['已交付', '退单', '待发客户'])('发演示不能把%s降级，也不改旧工资记录', async status => {
  order.status = status
  order.draftAt = '2026-10-01T00:00:00Z'
  await expect(run({ mode: 'demo' })).rejects.toThrow()
  expect(order.status).toBe(status)
  expect(order.draftAt).toBe('2026-10-01T00:00:00Z')
  expect(changes).toEqual([])
})

it('仍需要交付权限、本单写手身份和本单截图，不能给他人单或用销售身份发演示', async () => {
  await expect(run({ mode: 'demo', proofIds: [] })).rejects.toThrow('请先附')
  proofs = []
  await expect(run({ mode: 'demo' })).rejects.toThrow('截图不属于')
  const outsider = { ...writer, me: { ...writer.me, id: 'other' } }
  await expect(run({ mode: 'demo' }, outsider)).rejects.toThrow()
  const sales = { ...writer, me: { ...writer.me, id: 'sales' }, role: { ...role, perms: ['order.view', 'order.status'] as Role['perms'], rowScope: 'owned' as const } }
  await expect(run({ mode: 'demo' }, sales)).rejects.toThrow()
  expect(changes).toEqual([])
})

it('演示之后正式交付仍走原流程，默认旧请求仍为正式交付', async () => {
  expect(action.schema.parse({ id: 'o' }).mode).toBe('delivery')
  await run({ mode: 'demo' })
  changes = []
  await run()
  expect(order.status).toBe('已交付')
  expect(order.draftAt).toEqual(expect.any(String))
  expect(changes.find(change => change.table === tables.writerProgress)?.values).toMatchObject({ completedProofIds: ['proof'], groupProofIds: ['proof'], userId: 'writer' })
  expect(changes.find(change => change.table === tables.audit)?.values).toMatchObject({ action: '交付订单', from: '已发演示', to: '已交付' })
})
