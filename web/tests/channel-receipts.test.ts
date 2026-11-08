import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, resetDb, type Client } from './helpers'
import { GET as receiptsGet } from '@/app/api/channel-receipts/route'
import { GET as imageGet } from '@/app/api/channel-receipts/[id]/images/[hash]/route'
import { businessDate } from '@/shared/format'
import { sql } from '@/server/db'
import type { ChannelReceipt } from '@/shared/channel-receipts'

let boss: Client, sales: Client, other: Client, writer: Client, channelId: string, otherChannel: string
const date = businessDate(new Date())
const proof = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); other = await as('xiaoyang'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '渠道收款测试', ownerId: 'u-acheng' })).body.id
  otherChannel = (await boss.act('channel.create', { name: '其他渠道', ownerId: 'u-yang' })).body.id
})
afterAll(closeDb)
async function order(price = 100, channel = channelId, ownerId = 'u-acheng', salesMode = 'commission') {
  const r = await boss.act('order.create', { title: '渠道款回归订单', channelId: channel, ownerId, orderDate: date, basePrice: price, dueDate: null, salesMode })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body.id as string
}
const createInput = (amount: number, lines: { orderId: string; amount: number }[] = [], mode = lines.length ? 'allocate' : 'advance') => ({ requestId: randomUUID(), channelId, amount, date, tag: '定金', note: '收到渠道转账', mode, lines })
async function get(client: Client, query: string) {
  return receiptsGet(new Request(`http://test.local/api/channel-receipts?${query}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({}) })
}
async function receipt(id: string) {
  const r = await get(boss, `id=${id}`); expect(r.status).toBe(200)
  return ((await r.json()).receipts as ChannelReceipt[])[0]
}
async function image(client: Client, r: ChannelReceipt) {
  return imageGet(new Request(`http://test.local${r.proof}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({ id: r.id, hash: r.proof!.split('/').at(-1)! }) })
}
it('一笔渠道款分配多单，凭证只存一次，重复提交及请求改内容不会重复入账', async () => {
  const a = await order(), b = await order(80), input = { ...createInput(150, [{ orderId: a, amount: 100 }, { orderId: b, amount: 50 }]), proof }
  const first = await sales.act('channelReceipt.create', input)
  expect(first.status, JSON.stringify(first.body)).toBe(200)
  expect((await sales.act('channelReceipt.create', input)).body).toEqual(first.body)
  expect((await sales.act('channelReceipt.create', { ...input, note: '内容已改变' })).status).toBe(400)
  const r = await receipt(first.body.id)
  expect(r).toMatchObject({ amount: 150, allocated: 150, unallocated: 0, ownerId: 'u-acheng', revision: 1 })
  expect(r.lines).toHaveLength(2)
  expect(r.proof).toContain(`/api/channel-receipts/${r.id}/images/`)
  const rows = await sql`select amount, receipt_id, proof, date::text from payments where receipt_id=${r.id}`
  expect(rows).toHaveLength(2)
  expect(rows.every(p => p.proof === r.proof && p.date === date)).toBe(true)
  expect((await image(sales, r)).status).toBe(200)
  expect((await image(other, r)).status).toBe(404)
  expect((await image(writer, r)).status).toBe(404)
})
it('预收可部分追加分配，原日期归属不变；重试旧revision不重发，新请求旧revision拒绝', async () => {
  const a = await order(), b = await order(), input = { ...createInput(200), date: '2026-01-01' }
  const created = await boss.act('channelReceipt.create', input)
  expect(created.status).toBe(200)
  let r = await receipt(created.body.id)
  expect(r).toMatchObject({ allocated: 0, unallocated: 200, lines: [] })
  const allocation = { id: r.id, requestId: randomUUID(), revision: r.revision, lines: [{ orderId: a, amount: 60 }] }
  const first = await sales.act('channelReceipt.allocate', allocation)
  expect(first.status).toBe(200)
  expect((await sales.act('channelReceipt.allocate', allocation)).body).toEqual(first.body)
  expect((await sales.act('channelReceipt.allocate', { ...allocation, lines: [{ orderId: a, amount: 50 }] })).status).toBe(400)
  expect((await sales.act('channelReceipt.allocate', { ...allocation, requestId: randomUUID() })).status).toBe(409)
  r = await receipt(r.id)
  expect(r).toMatchObject({ amount: 200, allocated: 60, unallocated: 140, date: '2026-01-01', revision: 2 })
  expect((await sales.act('channelReceipt.allocate', { id: r.id, requestId: randomUUID(), revision: 2, lines: [{ orderId: a, amount: 40 }, { orderId: b, amount: 100 }] })).status).toBe(200)
  const rows = await sql`select amount, date::text from payments where receipt_id=${r.id}`
  expect(rows.reduce((n, p) => n + Number(p.amount), 0)).toBe(200)
  expect(rows.every(p => p.date === '2026-01-01')).toBe(true)
  expect((await sql`select id from channel_receipts where id=${r.id}`)).toHaveLength(1)
})
it('总额/分精度/真实日期/重复订单/同渠道/底价/退单/删除单/超未收均校验且整笔回滚', async () => {
  const a = await order(), foreign = await order(100, otherChannel, 'u-yang'), cost = await order(100, channelId, 'u-acheng', 'cost'), cancelled = await order(), deleted = await order()
  await sql`update orders set status='退单' where id=${cancelled}`
  await sql`update orders set deleted_at=now() where id=${deleted}`
  const invalid = [
    createInput(100, [{ orderId: a, amount: 90 }]), createInput(100, [{ orderId: a, amount: 50 }, { orderId: a, amount: 50 }]),
    createInput(101, [{ orderId: a, amount: 101 }]), createInput(50, [{ orderId: foreign, amount: 50 }]),
    createInput(50, [{ orderId: cost, amount: 50 }]), createInput(50, [{ orderId: cancelled, amount: 50 }]),
    createInput(50, [{ orderId: deleted, amount: 50 }]), createInput(0.001),
    { ...createInput(100), date: '2026-02-30' }, { ...createInput(100), date: '2099-01-01' },
    createInput(100, [{ orderId: a, amount: 100 }], 'advance'),
    createInput(110, [{ orderId: a, amount: 100 }, { orderId: foreign, amount: 10 }]),
  ]
  for (const input of invalid) {
    const r = await boss.act('channelReceipt.create', input)
    expect([400, 404], JSON.stringify(r.body)).toContain(r.status)
    expect((await sql`select id from channel_receipts where id=${`cr_${input.requestId}`}`)).toHaveLength(0)
  }
  expect((await sql`select id from payments where order_id=${a}`)).toHaveLength(0)
})
it('无权限人员不得看渠道总额、凭证或分配；有历史其他归属订单也不能泄露整笔金额', async () => {
  const id = (await boss.act('channelReceipt.create', createInput(100))).body.id
  expect((await other.act('channelReceipt.create', createInput(100))).status).toBe(404)
  expect((await writer.act('channelReceipt.create', createInput(100))).status).toBe(403)
  expect((await get(other, `id=${id}`)).status).toBe(404)
  expect((await get(writer, `channelId=${channelId}`)).status).toBe(404)
  expect((await other.act('channelReceipt.allocate', { id, revision: 1, requestId: randomUUID(), lines: [{ orderId: await order(), amount: 10 }] })).status).toBe(404)
  const foreignOwned = await order(100, channelId, 'u-yang')
  const mixed = await boss.act('channelReceipt.create', { ...createInput(10, [{ orderId: foreignOwned, amount: 10 }]), proof })
  expect(mixed.status).toBe(200)
  const record = await receipt(mixed.body.id)
  expect((await get(sales, `id=${record.id}`)).status).toBe(404)
  expect((await image(sales, record)).status).toBe(404)
  await sql`update roles set fields=jsonb_set(fields,'{sales}','false') where id='r-sales'`
  try {
    expect((await get(sales, `id=${id}`)).status).toBe(404)
    expect((await sales.act('channelReceipt.create', createInput(10))).status).toBe(404)
  } finally { await sql`update roles set fields=jsonb_set(fields,'{sales}','true') where id='r-sales'` }
})
it('并发分配只应用一个版本，不能超预收；管理员整笔撤销保留主子记录且释放订单未收', async () => {
  const a = await order(), b = await order(), created = await boss.act('channelReceipt.create', createInput(100)), id = created.body.id
  const results = await Promise.all([a, b].map(orderId => sales.act('channelReceipt.allocate', { id, requestId: randomUUID(), revision: 1, lines: [{ orderId, amount: 80 }] })))
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  expect((await receipt(id)).unallocated).toBe(20)
  expect((await sales.act('channelReceipt.allocate', { id, requestId: randomUUID(), revision: 2, lines: [{ orderId: a, amount: 30 }] })).status).toBe(400)
  expect((await sales.act('channelReceipt.revoke', { id, reason: '录错' })).status).toBe(403)
  expect((await boss.act('channelReceipt.revoke', { id, reason: '录错' })).status).toBe(200)
  expect((await boss.act('channelReceipt.revoke', { id, reason: '录错' })).status).toBe(200)
  expect((await receipt(id)).revoked?.reason).toBe('录错')
  const rows = await sql`select revoked_at from payments where receipt_id=${id}`
  expect(rows).toHaveLength(1); expect(rows[0].revoked_at).toBeTruthy()
  expect((await boss.act('channelReceipt.allocate', { id, requestId: randomUUID(), revision: 3, lines: [{ orderId: a, amount: 10 }] })).status).toBe(400)
  expect((await boss.act('channelReceipt.create', createInput(100, [{ orderId: a, amount: 100 }]))).status).toBe(200)
})
