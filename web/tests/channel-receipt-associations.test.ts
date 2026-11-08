import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { businessDate } from '@/shared/format'
import { GET as auditGet } from '@/app/api/audit/route'
import { GET as receiptGet } from '@/app/api/channel-receipts/route'
import { GET as incomeGet } from '@/app/api/reports/income/route'
import { buildBoot } from '@/server/bootstrap'
import { getCtx } from '@/server/session'
import type { ChannelReceipt } from '@/shared/channel-receipts'

let boss: Client, sales: Client
const date = businessDate(new Date())
const params = { params: Promise.resolve({}) }
const request = (client: Client, path: string) => new Request(`http://test.local${path}`, { headers: { cookie: client.cookie } })
beforeAll(async () => { await resetDb(); boss = await as('boss'); sales = await as('acheng') })
afterAll(closeDb)
async function channel(ownerId = 'u-acheng') {
  const result = await boss.act('channel.create', { name: `关联守卫-${randomUUID()}`, ownerId })
  expect(result.status).toBe(200)
  return result.body.id as string
}
async function order(channelId: string, ownerId = 'u-acheng') {
  const result = await boss.act('order.create', { title: '渠道收款关联订单', channelId, ownerId, orderDate: date, dueDate: null, basePrice: 100 })
  expect(result.status).toBe(200)
  return result.body.id as string
}
async function receipt(channelId: string, lines: { orderId: string; amount: number }[] = [], amount = 100) {
  const result = await boss.act('channelReceipt.create', { requestId: randomUUID(), channelId, amount, date, tag: '定金', note: '渠道转账', mode: lines.length ? 'allocate' : 'advance', lines })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return result.body.id as string
}
async function readReceipt(id: string) {
  const response = await receiptGet(request(boss, `/api/channel-receipts?id=${id}`), params)
  expect(response.status).toBe(200)
  return (await response.json()).receipts[0] as ChannelReceipt
}

it('渠道分配款不能单独撤销或单独改渠道，整笔撤销后才可换渠道', async () => {
  const source = await channel(), target = await channel(), id = await order(source)
  const receiptId = await receipt(source, [{ orderId: id, amount: 100 }])
  const paymentId = (await readReceipt(receiptId)).lines[0].paymentId
  const revoked = await boss.act('order.revokePayment', { id, paymentId, reason: '录错' })
  expect(revoked.status).toBe(400)
  expect(revoked.body.error).toContain('渠道收款记录撤销整笔')
  const moved = await boss.act('order.update', { id, patch: { channelId: target } })
  expect(moved.status).toBe(400)
  expect(moved.body.error).toContain('撤销整笔')
  expect((await boss.act('order.update', { id, patch: { channelId: source, title: '仅改标题' } })).status).toBe(200)
  expect((await sql`select channel_id from orders where id=${id}`)[0].channel_id).toBe(source)
  expect((await sql`select revoked_at from payments where id=${paymentId}`)[0].revoked_at).toBeNull()
  expect((await boss.act('channelReceipt.revoke', { id: receiptId, reason: '重新登记' })).status).toBe(200)
  expect((await boss.act('order.update', { id, patch: { channelId: target } })).status).toBe(200)
})

it('无订单但有预收和已撤销历史的渠道仍须接收渠道，合并保留归属快照和金额', async () => {
  const source = await channel(), target = await channel('u-yang')
  const active = await receipt(source), revoked = await receipt(source, [], 50)
  expect((await boss.act('channelReceipt.revoke', { id: revoked, reason: '误记' })).status).toBe(200)
  const blocked = await boss.act('channel.delete', { id: source })
  expect(blocked.status).toBe(400)
  expect(blocked.body.error).toContain('2 笔渠道收款记录')
  expect((await boss.act('channel.delete', { id: source, targetId: target })).body).toEqual({ ok: true, moved: 0 })
  expect(await readReceipt(active)).toMatchObject({ channelId: target, ownerId: 'u-acheng', amount: 100, unallocated: 100 })
  expect(await readReceipt(revoked)).toMatchObject({ channelId: target, ownerId: 'u-acheng', amount: 50, revoked: { reason: '误记' } })
  expect(await sql`select id from channel_receipts where channel_id=${source}`).toHaveLength(0)
  expect(await sql`select id from audit where object_type='channelReceipt' and action='合并渠道' and object_id in (${active},${revoked})`).toHaveLength(2)
})

it('合并渠道一起迁移回收站订单与整笔收款，不改子付款关联', async () => {
  const source = await channel(), target = await channel('u-yang'), id = await order(source)
  const receiptId = await receipt(source, [{ orderId: id, amount: 100 }])
  const before = await sql`select * from payments where receipt_id=${receiptId}`
  expect((await boss.act('order.delete', { ids: [id] })).status).toBe(200)
  expect((await boss.act('channel.delete', { id: source, targetId: target })).body).toEqual({ ok: true, moved: 1 })
  expect((await sql`select channel_id, owner_id, deleted_at from orders where id=${id}`)[0]).toMatchObject({ channel_id: target, owner_id: 'u-acheng' })
  expect((await readReceipt(receiptId))).toMatchObject({ channelId: target, ownerId: 'u-acheng', amount: 100, allocated: 100, unallocated: 0 })
  expect(await sql`select * from payments where receipt_id=${receiptId}`).toEqual(before)
})

it('订单退款和移入回收站不丢失渠道实收、不释放已经分配的预收款', async () => {
  const channelId = await channel(), id = await order(channelId)
  const receiptId = await receipt(channelId, [], 200)
  expect((await boss.act('channelReceipt.allocate', { id: receiptId, requestId: randomUUID(), revision: 1, lines: [{ orderId: id, amount: 100 }] })).status).toBe(200)
  expect((await boss.act('order.addPayment', { id, amount: 20, date, tag: '退款', note: '退还部分' })).status).toBe(200)
  expect((await boss.act('order.delete', { ids: [id] })).status).toBe(200)
  const response = await incomeGet(request(boss, `/api/reports/income?from=${date}&to=${date}&channelId=${channelId}`), params)
  expect(response.status).toBe(200)
  expect((await response.json()).summary).toMatchObject({ orderCount: 0, receipts: 200, refunds: 20, netReceipts: 180, unallocatedReceipts: 100 })
  expect(await readReceipt(receiptId)).toMatchObject({ allocated: 100, unallocated: 100 })
})

it('自定义审计权限仍按整笔渠道款可见性裁剪 API 与完整 bootstrap', async () => {
  await sql`update roles set perms=perms||${JSON.stringify(['audit.view'])}::jsonb where id='r-sales'`
  const own = await channel(), other = await channel('u-yang')
  const visible = await receipt(own), hidden = await receipt(other)
  const foreignOrder = await order(own, 'u-yang')
  const mixed = await receipt(own, [{ orderId: foreignOrder, amount: 100 }])
  const invisible = [hidden, mixed]
  const query = request(sales, '/api/audit?views=1')
  const response = await auditGet(query, params)
  expect(response.status).toBe(200)
  const apiRows = (await response.json()).rows as { objectId: string }[]
  const ctx = await getCtx(query)
  expect(ctx).not.toBeNull()
  const boot = await buildBoot(ctx!, false)
  for (const rows of [apiRows, boot.audit]) {
    expect(rows.some(row => row.objectId === visible)).toBe(true)
    expect(rows.some(row => invisible.includes(row.objectId ?? ''))).toBe(false)
  }
  await sql`update roles set fields=jsonb_set(fields,'{sales}','false') where id='r-sales'`
  const noSalesCtx = await getCtx(query)
  const noSalesApi = await auditGet(query, params)
  expect((await noSalesApi.json()).rows.some((row: { objectType: string }) => row.objectType === 'channelReceipt')).toBe(false)
  expect((await buildBoot(noSalesCtx!, false)).audit.some(row => row.objectType === 'channelReceipt')).toBe(false)
})
