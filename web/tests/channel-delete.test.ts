import { beforeAll, afterAll, expect, it } from 'vitest'
import { as, resetDb, closeDb, type Client } from './helpers'
import { sql } from '@/server/db'
let boss: Client, sales: Client, writer: Client, source: string, target: string, order: string
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  source = (await boss.act('channel.create', { name: '待合并渠道', ownerId: 'u-boss' })).body.id
  target = (await boss.act('channel.create', { name: '接收渠道', ownerId: 'u-acheng' })).body.id
  order = (await boss.act('order.create', { title: '保留全部账目的订单', channelId: source, ownerId: 'u-boss', orderDate: '2026-10-07', dueDate: null, type: '', basePrice: 500, assignees: [{ userId: 'u-xiao', pay: 100 }] })).body.id
  await boss.act('order.addPayment', { id: order, amount: 200, date: '2026-10-07', tag: '定金', note: '原收款' })
})
afterAll(closeDb)
it('无权限、未选接收渠道、同渠道和不存在的接收渠道都不能删除有订单的渠道', async () => {
  expect((await sales.act('channel.delete', { id: source, targetId: target })).status).toBe(403)
  expect((await writer.act('channel.delete', { id: source })).status).toBe(403)
  for (const input of [{ id: source }, { id: source, targetId: source }, { id: source, targetId: 'missing' }]) expect((await boss.act('channel.delete', input)).status).toBe(400)
  expect((await boss.boot()).body.channels.some((c: { id: string }) => c.id === source)).toBe(true)
})
it('合并包含回收站订单，保留收款、工资和归属销售，并留下审计记录', async () => {
  await boss.act('order.delete', { ids: [order] })
  const blocked = await boss.act('channel.delete', { id: source })
  expect(blocked.status).toBe(400)
  expect(blocked.body.error).toContain('0 条正常订单、1 条回收站订单')
  expect((await boss.boot()).body.trash.find((o: { id: string }) => o.id === order)).toMatchObject({ channelId: source })
  expect((await sales.boot()).body.trash).toEqual([])
  expect((await boss.act('channel.delete', { id: source, targetId: target })).body).toEqual({ ok: true, moved: 1 })
  await boss.act('order.restore', { ids: [order] })
  const boot = (await boss.boot()).body
  expect(boot.channels.some((c: { id: string }) => c.id === source)).toBe(false)
  const o = boot.orders.find((o: { id: string }) => o.id === order)
  expect(o).toMatchObject({ channelId: target, ownerId: 'u-boss', sales: 500, received: 200, unpaid: 300, writerTotal: 100 })
  expect(o.payments).toHaveLength(1)
  expect(await sql`select id from audit where object_id=${order} and action='合并渠道'`).toHaveLength(1)
  expect((await boss.act('channel.delete', { id: source, targetId: target })).status).toBe(404)
})
it('空渠道可以直接删除', async () => {
  const id = (await boss.act('channel.create', { name: '空渠道', ownerId: 'u-boss' })).body.id
  expect((await boss.act('channel.delete', { id })).body).toEqual({ ok: true, moved: 0 })
})
