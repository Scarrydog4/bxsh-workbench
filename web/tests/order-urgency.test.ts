import { afterAll, beforeAll, expect, it } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'

let boss: Client, sales: Client, writer: Client, other: Client, channelId: string
async function create(urgent = false) {
  const result = await sales.act('order.create', { title: '加急验收', ownerId: 'u-acheng', channelId, basePrice: 1000, orderDate: '2026-10-22', dueDate: '2026-10-30', urgent, urgencyNote: urgent ? '实物联调优先完成' : '' })
  expect(result.status).toBe(200)
  return result.body.id as string
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai'); other = await as('xiaoyang')
  channelId = (await boss.act('channel.create', { name: '加急验收渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

it('录单可直接标加急，写手看得到说明并收到加急通知', async () => {
  const id = await create(true)
  const boot = (await writer.boot()).body
  expect(boot.orders.find((o: any) => o.id === id)).toMatchObject({ urgency: { note: '实物联调优先完成', by: 'u-acheng' }, dueDate: '2026-10-30' })
  expect(boot.notifications.some((n: any) => n.kind === '订单加急' && n.orderId === id && n.body.includes('实物联调'))).toBe(true)
})
it('普通单加急和取消均留痕，说明变更会提醒，重试不重复发通知', async () => {
  const id = await create()
  const payload = { id, urgent: true, note: '今晚优先处理' }
  expect((await boss.act('order.setUrgency', payload)).status).toBe(200)
  expect((await boss.act('order.setUrgency', payload)).status).toBe(200)
  expect((await sql`select count(*)::int as n from notifications where order_id=${id} and kind='订单加急'`)[0].n).toBe(1)
  expect((await boss.act('order.setUrgency', { ...payload, note: '先完成电路部分' })).status).toBe(200)
  expect((await sql`select count(*)::int as n from notifications where order_id=${id} and kind='订单加急'`)[0].n).toBe(2)
  expect((await boss.act('order.setUrgency', { id, urgent: false })).status).toBe(200)
  const order = (await writer.boot()).body.orders.find((o: any) => o.id === id)
  expect(order.urgency).toBeNull()
  expect(order.dueDate).toBe('2026-10-30')
  const changes = (await boss.activity(id)).body.filter((a: any) => a.field === '加急')
  expect(changes).toHaveLength(3)
})
it('销售只能给自己可见的订单加急，写手不能取消加急', async () => {
  const id = await create(true)
  expect((await other.act('order.setUrgency', { id, urgent: false })).status).toBe(404)
  expect((await writer.act('order.setUrgency', { id, urgent: false })).status).toBe(403)
  expect((await sales.act('order.setUrgency', { id, urgent: false })).status).toBe(200)
})
