import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, deliveryProof, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { GET as settlementOrder } from '@/app/api/settle/order/route'

let boss: Client, writer: Client, other: Client, sales: Client, channelId: string
const day = '2026-10-16', writerId = 'u-xiao', otherId = 'u-yang'
const plan = 'completed_balance_50_50'
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL?.includes('/workbench_writer_stage_api_test')) throw new Error('本文件只能使用独立 writer-stage 测试库')
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-16T06:00:00Z')
  await resetDb()
  await sql`update users set can_write=true,role_id='r-writer' where id=${otherId}`
  boss = await as('boss'); writer = await as('xiaosenkai'); other = await as('xiaoyang'); sales = await as('acheng')
  channelId = (await boss.act('channel.create', { name: '两期工资回归', ownerId: 'u-acheng' })).body.id
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })
async function order(pay = 100, secondPay?: number) {
  const result = await boss.act('order.create', {
    title: '两期工资测试', channelId, ownerId: 'u-acheng', orderDate: day, dueDate: null,
    basePrice: (pay + (secondPay ?? 0)) * 5,
    assignees: [{ userId: writerId, pay }, ...(secondPay === undefined ? [] : [{ userId: otherId, pay: secondPay }])],
  })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return result.body.id as string
}
async function stage(id: string, stage: 'completed' | 'groupSent', client = writer, userId = writerId) {
  const input = { id, userId, stage, proofIds: await deliveryProof(client, id) }
  const result = await client.act('order.writerStage', input)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return input
}
async function summary(id: string, payee = writerId) {
  const response = await settlementOrder(new Request(`http://test.local/api/settle/order?order=${id}&kind=${encodeURIComponent('写手工资')}&payee=${payee}`, { headers: { cookie: boss.cookie } }), { params: Promise.resolve({}) })
  expect(response.status).toBe(200)
  return response.json()
}
async function view(id: string, client = boss) { return (await client.boot()).body.orders.find((row: { id: string }) => row.id === id) }
const wage = (id: string, amount: number, payeeId = writerId) => ({ requestId: randomUUID(), orderId: id, kind: '写手工资', payeeId, amount, date: day })
async function receive(id: string, amount: number, tag = '尾款') {
  const requestId = randomUUID()
  const result = await boss.act('order.addPayment', { id, amount, date: day, tag, requestId })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return `pay_${requestId}`
}

it('新订单仍自动计价，工资建议只看客户收款，交付独立记录', async () => {
  const id = await order()
  expect(await view(id)).toMatchObject({ writerPayPlan: plan, allocationPolicy: 'fixed_60_20_20_v1', commission: 100, bossIncome: 300, assignees: [{ userId: writerId, pay: 100 }] })
  expect((await summary(id)).writerStages.map((row: { key: string; amount: number }) => [row.key, row.amount])).toEqual([['completed', 50], ['balance', 50]])
  expect((await summary(id)).available).toBe(100)
  expect((await writer.act('order.writerStage', { id, userId: writerId, stage: 'completed', proofIds: [] })).status).toBe(400)
  expect((await writer.act('order.writerStage', { id, userId: writerId, stage: 'groupSent', proofIds: await deliveryProof(writer, id) })).status).toBe(400)
  await stage(id, 'completed')
  expect(await summary(id)).toMatchObject({ available: 100, paid: 0, suggest: 0 })
  expect((await boss.act('settle.pay', wage(id, 50))).status).toBe(200)
  await receive(id, 500)
  expect(await summary(id)).toMatchObject({ paid: 50, available: 50 })
  expect((await boss.act('order.confirmGraduation', { id })).status).toBe(400)
  expect((await boss.act('settle.pay', wage(id, 1))).status).toBe(200)
  await stage(id, 'groupSent')
  expect(await summary(id)).toMatchObject({ paid: 51, available: 49, suggest: 49 })
  expect((await view(id)).status).toBe('已交付')
})

it('定金决定建议比例，写手只获收款灯而看不到客户金额', async () => {
  const id = await order()
  await stage(id, 'completed'); await stage(id, 'groupSent')
  await receive(id, 200, '定金')
  expect((await summary(id)).available).toBe(100)
  let limited = await view(id, writer)
  expect(limited.customerPaidUpAt).toBeNull()
  expect(limited.basePrice).toBeUndefined(); expect(limited.payments).toBeUndefined(); expect(limited.sales).toBeUndefined(); expect(limited.payStatus).toBeUndefined()
  await receive(id, 300)
  expect((await summary(id)).available).toBe(100)
  limited = await view(id, writer)
  expect(limited.customerPaidUpAt).toBeTruthy()
  expect(limited.payments).toBeUndefined()
  const first = (await summary(id)).writerStages[0]
  const second = (await summary(id)).writerStages[1]
  expect(first).toMatchObject({ eligible: true, amount: 50 }); expect(second).toMatchObject({ eligible: true, amount: 50 })
})

it('两名写手截图隔离：本人本单真实图片才可解锁，另一写手不被代交', async () => {
  const id = await order(100, 200), elsewhere = await order()
  const input = { id, userId: writerId, stage: 'completed' }
  expect((await sales.act('order.writerStage', { ...input, proofIds: [] })).status).toBe(403)
  expect((await other.act('order.writerStage', { ...input, proofIds: await deliveryProof(other, id) })).status).toBe(403)
  expect((await writer.act('order.writerStage', { ...input, proofIds: await deliveryProof(writer, elsewhere) })).status).toBe(400)
  expect((await writer.act('order.writerStage', { ...input, proofIds: await deliveryProof(other, id) })).status).toBe(403)
  const fake = await writer.upload(id, 'invalid.png', Buffer.from('not-image'), undefined, 'image/png')
  expect((await writer.act('order.writerStage', { ...input, proofIds: [fake.body.id] })).status).toBe(400)
  await stage(id, 'completed')
  expect((await summary(id)).available).toBe(100); expect((await summary(id, otherId)).available).toBe(200)
  await receive(id, 1500)
  const group = await stage(id, 'groupSent')
  expect((await summary(id)).available).toBe(100); expect((await summary(id, otherId)).available).toBe(200)
  expect((await boss.act('attachment.remove', { id: group.proofIds[0] })).status).toBe(400)
  await stage(id, 'completed', other, otherId)
  expect((await summary(id, otherId)).available).toBe(200)
  await stage(id, 'groupSent', other, otherId)
  expect((await summary(id, otherId)).available).toBe(200)
})

it('单笔、批量和草稿确认可超发，撤销收款只改建议，不改已有实发', async () => {
  const id = await order()
  const first = wage(id, 20)
  expect((await boss.act('settle.pay', first)).status).toBe(200)
  expect((await boss.act('settle.pay', first)).status).toBe(200)
  const receiptId = await receive(id, 500)
  const draft = await boss.act('settle.save', { kind: '写手工资', payeeId: writerId, lines: [{ orderId: id, amount: 180 }] })
  expect(draft.status).toBe(200)
  expect(await summary(id)).toMatchObject({ left: 80, suggest: 80 })
  const paidBefore = await sql`select id,amount,status,confirmed_at from settlements where order_id=${id} and status='已确认' order by id`
  expect((await boss.act('order.revokePayment', { id, paymentId: receiptId, reason: '撤销记错收款' })).status).toBe(200)
  expect(await sql`select id,amount,status,confirmed_at from settlements where order_id=${id} and status='已确认' order by id`).toEqual(paidBefore)
  expect((await boss.act('settle.confirm', { id: draft.body.id })).status).toBe(200)
  const bulk = { requestId: randomUUID(), kind: '写手工资', payeeId: writerId, date: day, lines: [{ orderId: id, amount: .01 }] }
  expect((await boss.act('settle.payBatch', bulk)).status).toBe(200)
  expect((await boss.act('settle.payBatch', bulk)).status).toBe(200)
  expect(await summary(id)).toMatchObject({ due: 100, paid: 200.01, left: 0, over: 100.01, suggest: 0, custStage: 'none' })
  expect((await writer.act('settle.pay', wage(id, 1))).status).toBe(403)
})

it('渠道批量收款同步更新建议，整笔撤销后已发工资保留', async () => {
  const first = await order(), second = await order()
  for (const id of [first, second]) { await stage(id, 'completed'); await stage(id, 'groupSent') }
  const result = await boss.act('channelReceipt.create', { requestId: randomUUID(), channelId, amount: 1000, date: day, tag: '全款', mode: 'allocate', lines: [{ orderId: first, amount: 500 }, { orderId: second, amount: 500 }] })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  expect((await summary(first)).available).toBe(100); expect((await summary(second)).available).toBe(100)
  expect((await boss.act('settle.pay', wage(first, 100))).status).toBe(200)
  expect((await boss.act('channelReceipt.revoke', { id: result.body.id, reason: '测试撤销整笔收款' })).status).toBe(200)
  expect(await summary(first)).toMatchObject({ paid: 100, available: 0, unpaid: 0 })
  expect(await summary(second)).toMatchObject({ paid: 0, available: 100, suggest: 0 })
  expect((await view(second, writer)).customerPaidUpAt).toBeNull()
})

it('退款、加价改变收款灯和建议；零价单无建议', async () => {
  const id = await order()
  await stage(id, 'completed'); await stage(id, 'groupSent'); await receive(id, 500)
  expect((await boss.act('settle.pay', wage(id, 50))).status).toBe(200)
  const refunded = await receive(id, 100, '退款')
  expect(await summary(id)).toMatchObject({ paid: 50, available: 50 })
  expect((await boss.act('order.revokePayment', { id, paymentId: refunded, reason: '退错款撤销' })).status).toBe(200)
  expect((await summary(id)).available).toBe(50)
  expect((await boss.act('order.addAdjustment', { id, amount: 100, reason: '新增需求' })).status).toBe(200)
  // 应得120，收到500/600，建议100减去已发50。
  expect(await summary(id)).toMatchObject({ paid: 50, available: 70, suggest: 50 })
  const zero = await order(0)
  await stage(zero, 'completed'); await stage(zero, 'groupSent')
  expect((await view(zero, writer)).customerPaidUpAt).toBeNull()
  expect((await summary(zero)).writerStages[1].eligible).toBe(false)
})

it('旧计划切换保留交付和已发，不影响剩余应得', async () => {
  const id = await order()
  await sql`update orders set writer_pay_plan='staged' where id=${id}`
  await stage(id, 'completed'); await stage(id, 'groupSent')
  expect((await boss.act('settle.pay', wage(id, 70))).status).toBe(200)
  const evidence = await sql`select * from writer_progress where order_id=${id}`
  const paid = await sql`select id,amount,status,confirmed_at from settlements where order_id=${id} order by id`
  expect((await writer.act('order.enableStagedPay', { id, plan })).status).toBe(403)
  expect((await boss.act('order.enableStagedPay', { id, plan })).status).toBe(200)
  expect(await sql`select * from writer_progress where order_id=${id}`).toEqual(evidence)
  expect(await sql`select id,amount,status,confirmed_at from settlements where order_id=${id} order by id`).toEqual(paid)
  expect(await summary(id)).toMatchObject({ paid: 70, available: 30, unpaid: 30, suggest: 0 })
  expect((await boss.act('order.enableStagedPay', { id, plan: 'staged' })).status).toBe(400)
  await receive(id, 500)
  expect(await summary(id)).toMatchObject({ paid: 70, available: 30, unpaid: 30 })
  const legacy = await order()
  await sql`update orders set writer_pay_plan='full' where id=${legacy}`
  expect((await writer.act('order.markDraft', { id: legacy, proofIds: await deliveryProof(writer, legacy) })).status).toBe(200)
  expect((await summary(legacy)).available).toBe(100)
  expect((await view(legacy)).writerPayPlan).toBe('full')
})

it('新单写手一个交付按钮即可交付；两位写手时都交了才算已交付，不出现待发客户', async () => {
  const id = await order()
  const deliver = async (client: Client) => client.act('order.markDraft', { id, proofIds: await deliveryProof(client, id) })
  expect((await deliver(writer)).status).toBe(200)
  expect((await view(id)).status).toBe('已交付')
  expect((await view(id)).draftAt).toBeTruthy()
  const two = await order(100, 60)
  expect((await writer.act('order.markDraft', { id: two, proofIds: await deliveryProof(writer, two) })).status).toBe(200)
  expect((await view(two)).status).toBe('未交付')
  expect((await other.act('order.markDraft', { id: two, proofIds: await deliveryProof(other, two) })).status).toBe(200)
  expect((await view(two)).status).toBe('已交付')
  const third = await order(100, 60)
  expect((await boss.act('order.markDraft', { id: third, proofIds: await deliveryProof(boss, third) })).status).toBe(200)
  expect((await view(third)).status).toBe('已交付')
  expect((await boss.act('order.update', { id: (await order()), patch: { status: '已交付' } })).status).toBe(400)
})
