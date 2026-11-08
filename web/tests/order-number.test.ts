/**
 * 订单编号：DD + 下单日期 YYMMDD + 当天序号，每天从 0001 起，不和已有单号撞。
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))

let boss: Client
let ch = ''
const mk = async (orderDate: string) => {
  const r = await boss.act('order.create', { title: '编号测试', orderDate, dueDate: null, ownerId: 'u-boss', channelId: ch, basePrice: 100, assignees: [], channelNo: '', type: '', note: '' })
  const [o] = await db.select().from(t.orders).where(eq(t.orders.id, r.body.id))
  return o
}

beforeAll(async () => {
  await resetDb()
  boss = await as('boss')
  ch = (await boss.act('channel.create', { name: '编号渠道', ownerId: 'u-boss' })).body.id
})
afterAll(closeDb)

it('每个下单日期从 0001 起按天编号', async () => {
  expect((await mk('2026-10-09')).no).toBe('DD2610090001')
  expect((await mk('2026-10-09')).no).toBe('DD2610090002')
  expect((await mk('2026-10-10')).no).toBe('DD2610100001')
  expect((await mk('2026-10-09')).no).toBe('DD2610090003')
})

it('某天已有旧单号时接着最大序号往下编', async () => {
  const o = await mk('2026-10-08')
  await db.update(t.orders).set({ no: 'DD2610080211' }).where(eq(t.orders.id, o.id))
  await db.delete(t.counters).where(eq(t.counters.name, 'order_serial:2026-10-08'))
  expect((await mk('2026-10-08')).no).toBe('DD2610080212')
})

it('同时录单不重号', async () => {
  const list = await Promise.all([1, 2, 3, 4].map(() => mk('2026-10-11')))
  expect(list.map((o) => o.no).sort()).toEqual(['DD2610110001', 'DD2610110002', 'DD2610110003', 'DD2610110004'])
})

it('改下单日期不改单号', async () => {
  const o = await mk('2026-10-12')
  await boss.act('order.update', { id: o.id, patch: { orderDate: '2026-10-13' } })
  const [after] = await db.select().from(t.orders).where(eq(t.orders.id, o.id))
  expect(after.orderDate).toBe('2026-10-13')
  expect(after.no).toBe(o.no)
})
