/**
 * 销售能给自己的单选写手，但不能定、不能看写手工资；写手账号不能换人。
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))

let boss: Client, sales: Client, writer: Client, channelId = ''
const pays = async (id: string) => (await db.select().from(t.orderWriters)).filter((x) => x.orderId === id).map((x) => ({ userId: x.userId, pay: x.pay }))

beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '选写手渠道', ownerId: 'u-acheng' })).body.id
  expect((await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })).status).toBe(200)
})
afterAll(closeDb)

const create = async (assignees?: { userId: string; pay: number | null }[]) => {
  const r = await sales.act('order.create', { title: '销售选写手', channelId, ownerId: 'u-acheng', orderDate: '2026-10-19', dueDate: null, basePrice: 500, ...(assignees ? { assignees } : {}) })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body.id as string
}

it('销售录单可以指定写手，不能填写工资', async () => {
  expect((await sales.act('order.create', { title: '伪造工资', channelId, ownerId: 'u-acheng', orderDate: '2026-10-22', dueDate: null, basePrice: 500, assignees: [{ userId: 'u-boss', pay: 999 }] })).status).toBe(403)
  const id = await create([{ userId: 'u-boss', pay: null }])
  const rows = await pays(id)
  expect(rows.map((x) => x.userId)).toEqual(['u-boss'])
  expect(rows[0].pay).not.toBe(999)
})

it('销售可以给自己的单换写手，但改不了工资', async () => {
  const id = await create()
  expect((await sales.act('order.setWriters', { id, writers: [{ userId: 'u-boss' }] })).status).toBe(200)
  expect((await pays(id)).map((x) => x.userId)).toEqual(['u-boss'])
  expect((await sales.act('order.setWriters', { id, writers: [{ userId: 'u-boss', pay: 888 }] })).status).toBe(403)
})

it('写手账号不能换写手', async () => {
  const id = await create([{ userId: 'u-xiao', pay: null }])
  expect((await writer.act('order.setWriters', { id, writers: [{ userId: 'u-boss' }] })).status).not.toBe(200)
})

it('写手已经发过工资，销售不能把他换掉', async () => {
  const id = await create([{ userId: 'u-xiao', pay: null }])
  await db.insert(t.settlements).values({ id: 'st-test-paid', kind: '写手工资', payeeId: 'u-xiao', orderId: id, amount: 10, status: '已确认' })
  const r = await sales.act('order.setWriters', { id, writers: [{ userId: 'u-boss' }] })
  expect(r.status).toBe(403)
  expect(r.body.error).toContain('已经发过工资')
})
