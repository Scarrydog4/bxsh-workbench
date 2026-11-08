import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, sales: Client, writer: Client, other: Client, channelId: string
const oldDate = '2026-10-28'
const row = async (id: string) => (await db.select().from(t.orders).where(eq(t.orders.id, id)))[0]
const history = async (id: string) => (await db.select().from(t.audit).where(eq(t.audit.objectId, id))).filter(a => a.field === '截止日期')
async function create(writers = [{ userId: 'u-xiao', pay: 100 }]) {
  const r = await boss.act('order.create', { title: '交期权限验收', channelId, ownerId: 'u-acheng', orderDate: '2026-10-22', dueDate: oldDate, basePrice: 500, note: '保留订单要求', assignees: writers })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body.id as string
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai'); other = await as('xiaoyang')
  channelId = (await boss.act('channel.create', { name: '交期测试渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

it('写手不填备注、只填空格或只传图片都不能调整交期', async () => {
  const id = await create()
  for (const memo of [{}, { reason: '   \n ' }, { proof: 'data:image/png;base64,aGVsbG8=' }]) {
    const r = await writer.act('order.update', { id, patch: { dueDate: '2026-10-30' }, ...memo })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('原因备注')
  }
  expect((await row(id)).dueDate).toBe(oldDate)
  expect(await history(id)).toHaveLength(0)
})

it('自己的订单填备注后更新日期，保留原要求、状态、工资和付款', async () => {
  const id = await create(), before = await row(id)
  const pay = (await db.select().from(t.orderWriters).where(eq(t.orderWriters.orderId, id)))[0]
  const r = await writer.act('order.update', { id, patch: { dueDate: '2026-10-30' }, reason: '  等客户补充图纸，协商延后两天  ' })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  expect(await row(id)).toEqual({ ...before, dueDate: '2026-10-30', updatedAt: expect.any(String) })
  expect((await db.select().from(t.orderWriters).where(eq(t.orderWriters.orderId, id)))[0]).toEqual(pay)
  expect(await db.select().from(t.settlements).where(eq(t.settlements.orderId, id))).toEqual([])
  const changes = await history(id)
  expect(changes).toHaveLength(1)
  expect(changes[0]).toMatchObject({ actorId: 'u-xiao', from: oldDate, to: '2026-10-30', note: '等客户补充图纸，协商延后两天', fieldGroup: null })
  for (const client of [writer, boss, sales]) {
    expect((await client.activity(id)).body).toContainEqual(expect.objectContaining({ note: '等客户补充图纸，协商延后两天', from: oldDate, to: '2026-10-30' }))
  }
  const notes = (await db.select().from(t.notifications).where(eq(t.notifications.orderId, id))).filter(n => n.kind === '交期调整')
  expect(notes.map(n => n.userId).sort()).toEqual(['u-acheng', 'u-boss'])
  expect(notes.every(n => n.body.includes('等客户补充图纸') && n.body.includes('2026-10-30'))).toBe(true)
  expect((await writer.boot()).body.orders.find((o: { id: string }) => o.id === id).dueDate).toBe('2026-10-30')
})

it('写手不能调整不属于自己的订单，销售也不能修改别人的单', async () => {
  const id = await create([])
  expect((await writer.act('order.update', { id, patch: { dueDate: '2026-10-30' }, reason: '无权尝试' })).status).toBe(404)
  expect((await other.act('order.update', { id, patch: { dueDate: '2026-10-30' }, reason: '无权尝试' })).status).toBe(404)
  expect((await row(id)).dueDate).toBe(oldDate)
})

it('调整交期不能顺带修改订单名称、原价或下单日期，整次请求不生效', async () => {
  const id = await create()
  for (const extra of [{ title: '越权标题' }, { basePrice: 1 }, { orderDate: '2026-10-01' }]) {
    expect((await writer.act('order.update', { id, patch: { dueDate: '2026-10-30', ...extra }, reason: '调整原因' })).status).toBe(403)
  }
  expect((await row(id)).dueDate).toBe(oldDate)
  expect(await history(id)).toHaveLength(0)
})

it('不能清空日期或保存不存在的日期', async () => {
  const id = await create()
  for (const dueDate of [null, '', '2026-02-30', '2026-13-01', '10月30日']) {
    expect((await writer.act('order.update', { id, patch: { dueDate }, reason: '日期验证' })).status).toBe(400)
  }
  expect((await row(id)).dueDate).toBe(oldDate)
})

it('日期未变不新增修改记录或提醒，重复保存同一日期也不会重复留痕', async () => {
  const id = await create()
  expect((await writer.act('order.update', { id, patch: { dueDate: oldDate } })).status).toBe(200)
  const input = { id, patch: { dueDate: '2026-10-30' }, reason: '协商延期' }
  expect((await writer.act('order.update', input)).status).toBe(200)
  expect((await writer.act('order.update', input)).status).toBe(200)
  expect(await history(id)).toHaveLength(1)
  expect((await db.select().from(t.notifications).where(eq(t.notifications.orderId, id))).filter(n => n.kind === '交期调整')).toHaveLength(2)
})

it('老板和归属销售保留原有改日期方式', async () => {
  const id = await create()
  expect((await sales.act('order.update', { id, patch: { dueDate: '2026-10-29' } })).status).toBe(200)
  expect((await boss.act('order.update', { id, patch: { dueDate: '2026-10-30' } })).status).toBe(200)
  expect((await row(id)).dueDate).toBe('2026-10-30')
})
