import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { GET as wageCandidates } from '@/app/api/settle/candidates/route'
import { GET as progress } from '@/app/api/upload/[id]/route'
import { POST as complete } from '@/app/api/upload/[id]/complete/route'
import { as, closeDb, deliveryProof, resetDb, type Client } from './helpers'

let boss: Client, writer: Client, sales: Client, channelId: string
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng')
  channelId = (await boss.act('channel.create', { name: '交付凭证验收', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)
async function order() {
  const r = await sales.act('order.create', { title: '交付验证', channelId, ownerId: 'u-acheng', orderDate: '2026-10-08', dueDate: null, basePrice: 500 })
  expect(r.status).toBe(200)
  return r.body.id as string
}

it('没有截图不能通过初稿、状态菜单或批量状态触发交付和工资归期', async () => {
  const id = await order()
  expect((await writer.act('order.markDraft', { id })).status).toBe(400)
  expect((await boss.act('order.markDraft', { id })).status).toBe(400)
  expect((await sales.act('order.markDraft', { id })).status).toBe(403)
  expect((await boss.act('order.update', { id, patch: { status: '已交付' } })).status).toBe(400)
  expect((await boss.act('order.bulkStatus', { ids: [id], status: '已发演示' })).status).toBe(400)
  const [row] = await db.select().from(t.orders).where(eq(t.orders.id, id))
  expect(row).toMatchObject({ draftAt: null, status: '未交付' })
  expect((await boss.activity(id)).body.filter((e: { action: string }) => e.action === '修改')).toHaveLength(0)
})

it('拒绝别单、伪装图片和已删除凭证；真实截图可确认且重复请求不重记交付', async () => {
  const id = await order(), other = await order()
  expect((await writer.act('order.markDraft', { id, proofIds: await deliveryProof(writer, other) })).status).toBe(400)
  const fake = await writer.upload(id, '假图片.png', Buffer.from('not an image'), undefined, 'image/png')
  expect((await writer.act('order.markDraft', { id, proofIds: [fake.body.id] })).status).toBe(400)
  const proofIds = await deliveryProof(writer, id)
  await db.update(t.attachments).set({ deletedAt: new Date().toISOString() }).where(eq(t.attachments.id, proofIds[0]))
  expect((await writer.act('order.markDraft', { id, proofIds })).status).toBe(400)
  await db.update(t.attachments).set({ deletedAt: null }).where(eq(t.attachments.id, proofIds[0]))
  for (let i = 0; i < 2; i++) expect((await writer.act('order.markDraft', { id, proofIds })).status).toBe(200)
  expect((await boss.activity(id)).body.filter((e: { action: string }) => e.action === '交付订单')).toHaveLength(1)
  const [row] = await db.select().from(t.orders).where(eq(t.orders.id, id))
  expect(row.status).toBe('已交付')
  expect(row.draftAt).toBeTruthy()
})

it('旧版已记初稿但仍是已发演示的订单，确认交付后补正状态并保留首次交付日期', async () => {
  const id = await order(), draftAt = '2026-09-10T08:00:00.000Z'
  await db.update(t.orders).set({ draftAt, status: '已发演示' }).where(eq(t.orders.id, id))
  expect((await writer.act('order.markDraft', { id })).status).toBe(400)
  const proofIds = await deliveryProof(writer, id)
  for (let i = 0; i < 2; i++) expect((await writer.act('order.markDraft', { id, proofIds })).status).toBe(200)
  const [row] = await db.select().from(t.orders).where(eq(t.orders.id, id))
  expect(row.status).toBe('已交付')
  expect(new Date(row.draftAt!).toISOString()).toBe(draftAt)
  const entries = (await boss.activity(id)).body.filter((e: { action: string }) => e.action === '交付订单')
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ from: '已发演示', to: '已交付' })
})

it('售后只能使用本轮交付截图，完成后不能再更换负责人或期限', async () => {
  const orderId = await order()
  const asId = (await sales.act('aftersale.create', { orderId, req: ['修改图表'] })).body.id
  const ids = { orderId, asId }
  expect((await writer.act('aftersale.finish', ids)).status).toBe(400)
  expect((await writer.act('aftersale.finish', { ...ids, proofIds: await deliveryProof(writer, orderId) })).status).toBe(400)
  const proofIds = await deliveryProof(writer, orderId, asId)
  expect((await sales.act('aftersale.finish', { ...ids, proofIds })).status).toBe(403)
  for (let i = 0; i < 2; i++) expect((await writer.act('aftersale.finish', { ...ids, proofIds })).status).toBe(200)
  expect((await sales.act('aftersale.update', { ...ids, writerId: 'u-boss' })).status).toBe(400)
  const next = (await sales.act('aftersale.create', { orderId, req: ['第二轮修改'] })).body.id
  expect((await writer.act('aftersale.finish', { orderId, asId: next, proofIds })).status).toBe(400)
})

it('开着售后不能交付订单，售后交完后才能交付订单', async () => {
  const orderId = await order()
  const asId = (await sales.act('aftersale.create', { orderId, req: ['先出开题'] })).body.id
  const res = await writer.act('order.markDraft', { id: orderId, proofIds: await deliveryProof(writer, orderId) })
  expect(res.status).toBe(400)
  expect(res.body.error).toContain('跟进')
  expect((await writer.act('aftersale.finish', { orderId, asId, proofIds: await deliveryProof(writer, orderId, asId) })).status).toBe(200)
  const [row] = await db.select().from(t.orders).where(eq(t.orders.id, orderId))
  expect(row).toMatchObject({ draftAt: null, status: '未交付' })
  expect((await writer.act('order.markDraft', { id: orderId, proofIds: await deliveryProof(writer, orderId) })).status).toBe(200)
})

it('合作单的他人跟进不阻挡本人交付，负责人和老板仍须先处理跟进', async () => {
  await db.update(t.users).set({ roleId: 'r-writer', canWrite: true }).where(eq(t.users.id, 'u-yang'))
  const other = await as('xiaoyang')
  const created = await boss.act('order.create', {
    title: '合作交付与本人跟进隔离', channelId, ownerId: 'u-acheng', orderDate: '2026-10-25',
    dueDate: null, basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 100 }, { userId: 'u-yang', pay: 100 }],
  })
  expect(created.status).toBe(200)
  const id = created.body.id
  const followup = await boss.act('aftersale.create', { orderId: id, writerId: 'u-yang', req: ['补充自己的图表'] })
  expect(followup.status).toBe(200)
  const proofIds = await deliveryProof(writer, id)
  expect((await writer.act('order.markDraft', { id, proofIds })).status).toBe(200)
  expect(await db.select().from(t.writerProgress).where(eq(t.writerProgress.orderId, id))).toMatchObject([
    { userId: 'u-xiao', completedProofIds: proofIds, groupProofIds: proofIds },
  ])
  expect((await db.select().from(t.orders).where(eq(t.orders.id, id)))[0]).toMatchObject({ status: '未交付', draftAt: null })
  for (const client of [other, boss]) {
    const result = await client.act('order.markDraft', { id, proofIds: await deliveryProof(client, id) })
    expect(result.status).toBe(400)
    expect(result.body.error).toContain('跟进')
  }
  expect(await db.select().from(t.writerProgress).where(eq(t.writerProgress.orderId, id))).toHaveLength(1)
  expect((await db.select().from(t.afterSales).where(eq(t.afterSales.id, followup.body.id)))[0].doneAt).toBeNull()
  expect((await other.act('aftersale.finish', { orderId: id, asId: followup.body.id, proofIds: await deliveryProof(other, id, followup.body.id) })).status).toBe(200)
  expect((await other.act('order.markDraft', { id, proofIds: await deliveryProof(other, id) })).status).toBe(200)
  expect((await db.select().from(t.orders).where(eq(t.orders.id, id)))[0].status).toBe('已交付')
})

it('存档响应丢失后重试同一上传，只返回原附件，不再重复插入', async () => {
  const orderId = await order(), [id] = await deliveryProof(writer, orderId)
  const uploadId = id.replace('f_', 'up_'), params = { params: Promise.resolve({ id: uploadId }) }
  const headers = { cookie: writer.cookie, 'content-type': 'application/json' }
  const p = await progress(new Request('http://test.local/api/upload/' + uploadId, { headers }), params)
  expect(p.status).toBe(200)
  expect((await p.json()).received).toBeGreaterThan(0)
  const r = await complete(new Request('http://test.local/api/upload/' + uploadId + '/complete', { method: 'POST', headers, body: '{}' }), params)
  expect(r.status).toBe(200)
  expect((await r.json()).id).toBe(id)
  expect(await db.select().from(t.attachments).where(eq(t.attachments.orderId, orderId))).toHaveLength(1)
})


it('收定金后仍须截图确认交付才可结工资，旧草稿不能绕过，交付后可分次结清', async () => {
  const id = await order()
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 300 }] })).status).toBe(200)
  expect((await sales.act('order.addPayment', { id, amount: 200, date: '2026-10-09', tag: '定金', note: '收到客户定金' })).status).toBe(200)
  const save = (amount: number, batch?: string) => boss.act('settle.save', { id: batch, kind: '写手工资', payeeId: 'u-xiao', lines: [{ orderId: id, amount }] })
  const candidates = async () => {
    const r = await wageCandidates(new Request('http://test.local/api/settle/candidates?kind=写手工资&payee=u-xiao', { headers: { cookie: boss.cookie } }), { params: Promise.resolve({}) })
    expect(r.status).toBe(200)
    return (await r.json()).find((o: { orderId: string }) => o.orderId === id)
  }
  expect(await candidates()).toBeUndefined()
  expect((await save(100)).status).toBe(400)
  // 模拟升级前保存但未付款的草稿。
  const batch = 'old-undelivered-draft'
  await db.insert(t.settleBatches).values({ id: batch, no: 'JS-OLD', kind: '写手工资', payeeId: 'u-xiao', status: '草稿', createdBy: 'u-boss' })
  await db.insert(t.settlements).values({ id: 'old-undelivered-line', batchId: batch, orderId: id, kind: '写手工资', payeeId: 'u-xiao', amount: 100, status: '草稿' })
  expect((await save(100, batch)).status).toBe(400)
  expect((await boss.act('settle.confirm', { id: batch })).status).toBe(400)
  const proofIds = await deliveryProof(writer, id)
  // 仅上传文件还不算交付。
  expect((await save(100)).status).toBe(400)
  expect((await writer.act('order.markDraft', { id, proofIds })).status).toBe(200)
  const v = (await writer.boot()).body.orders.find((o: { id: string }) => o.id === id)
  expect(v.status).toBe('已交付')
  expect(v.draftAt).toBeTruthy()
  expect(await candidates()).toMatchObject({ remaining: 200, suggested: true })
  expect((await boss.act('settle.confirm', { id: batch })).status).toBe(200)
  expect((await save(201)).status).toBe(400)
  const rest = await save(200)
  expect(rest.status).toBe(200)
  expect((await boss.act('settle.confirm', { id: rest.body.id })).status).toBe(200)
  expect(await candidates()).toBeUndefined()
  // 新售后不把整单重新变成未交付，也不解锁未完成的追加工资。
  expect((await boss.act('aftersale.create', { orderId: id, req: ['改图'], reason: '新增需求', writerId: 'u-xiao', extra: 80 })).status).toBe(200)
  expect((await db.select().from(t.orders).where(eq(t.orders.id, id)))[0].status).toBe('已交付')
  expect(await candidates()).toBeUndefined()
})
