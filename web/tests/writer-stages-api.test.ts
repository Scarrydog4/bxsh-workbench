import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, deliveryProof, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { GET as settlementOrder } from '@/app/api/settle/order/route'

let boss: Client, writer: Client, other: Client, sales: Client, channelId: string
const day = '2026-10-15', writerId = 'u-xiao', otherId = 'u-yang'
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL?.includes('/workbench_writer_stage_api_test')) throw new Error('本文件只能使用独立 writer-stage 测试库')
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-15T06:00:00Z')
  await resetDb()
  await sql`update users set can_write=true,role_id='r-writer' where id=${otherId}`
  boss = await as('boss'); writer = await as('xiaosenkai'); other = await as('xiaoyang'); sales = await as('acheng')
  channelId = (await boss.act('channel.create', { name: '阶段工资回归', ownerId: 'u-acheng' })).body.id
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })
async function order(pay = 100, multi = false) {
  const result = await boss.act('order.create', { title: '阶段工资测试', channelId, ownerId: 'u-acheng', orderDate: day, dueDate: null, basePrice: 500, assignees: [{ userId: writerId, pay }, ...(multi ? [{ userId: otherId, pay: 200 }] : [])] })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  // 历史三阶段约定作为显式旧订单 fixture，不依赖新订单默认规则。
  await sql`update orders set writer_pay_plan='staged' where id=${result.body.id}`
  return result.body.id as string
}
async function stage(id: string, type: 'completed' | 'groupSent', client = writer, userId = writerId) {
  const input = { id, userId, stage: type, proofIds: await deliveryProof(client, id) }
  const result = await client.act('order.writerStage', input)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return input
}
async function stored(id: string) { return (await sql`select writer_pay_plan,status,draft_at,graduated_at from orders where id=${id}`)[0] }
async function summary(id: string, payee = writerId) {
  const response = await settlementOrder(new Request(`http://test.local/api/settle/order?order=${id}&kind=${encodeURIComponent('写手工资')}&payee=${payee}`, { headers: { cookie: boss.cookie } }), { params: Promise.resolve({}) })
  expect(response.status).toBe(200)
  return response.json()
}
const payment = (id: string, amount: number, payeeId = writerId) => ({ requestId: randomUUID(), orderId: id, kind: '写手工资', payeeId, amount, date: day })

it('历史三阶段订单：无图、越级、手动状态不能绕过；交付按钮一次交付', async () => {
  const id = await order()
  expect(await stored(id)).toMatchObject({ writer_pay_plan: 'staged', status: '未交付', draft_at: null })
  expect((await writer.act('order.writerStage', { id, userId: writerId, stage: 'completed', proofIds: [] })).status).toBe(400)
  expect((await writer.act('order.writerStage', { id, userId: writerId, stage: 'groupSent', proofIds: await deliveryProof(writer, id) })).status).toBe(400)
  expect((await boss.act('order.update', { id, patch: { status: '已交付' } })).status).toBe(400)
  expect((await boss.act('order.bulkStatus', { ids: [id], status: '已交付' })).status).toBe(400)
  expect((await boss.act('order.confirmGraduation', { id })).status).toBe(400)
  expect((await boss.act('settle.pay', payment(id, 1))).status).toBe(200)
  expect((await summary(id)).available).toBe(99)
  expect((await writer.act('order.markDraft', { id, proofIds: await deliveryProof(writer, id) })).status).toBe(200)
  expect((await stored(id)).status).toBe('已交付')
})

it('两名写手交付记录隔离，工资不随阶段变化；重复提交不改时间', async () => {
  const id = await order(300, true), first = await stage(id, 'completed')
  expect(await stored(id)).toMatchObject({ status: '未交付', draft_at: null })
  expect((await summary(id)).available).toBe(300)
  expect((await summary(id)).writerStages.map((s: { amount: number }) => s.amount)).toEqual([150, 60, 90])
  expect((await summary(id, otherId)).available).toBe(200)
  const [before] = await sql`select * from writer_progress where order_id=${id} and user_id=${writerId}`
  expect((await writer.act('order.writerStage', first)).status).toBe(200)
  expect((await sql`select completed_at from writer_progress where order_id=${id} and user_id=${writerId}`)[0].completed_at).toEqual(before.completed_at)
  await stage(id, 'completed', other, otherId)
  expect(await stored(id)).toMatchObject({ status: '未交付', draft_at: null })
  expect((await boss.act('order.update', { id, patch: { status: '已交付' } })).status).toBe(400)
  await stage(id, 'groupSent')
  expect(await stored(id)).toMatchObject({ status: '未交付', draft_at: null })
  expect((await summary(id)).available).toBe(300)
  expect((await summary(id, otherId)).available).toBe(200)
  expect((await writer.act('order.confirmGraduation', { id })).status).toBe(403)
  expect((await boss.act('order.confirmGraduation', { id })).status).toBe(200)
  expect((await summary(id)).available).toBe(300)
  expect((await summary(id, otherId)).available).toBe(200)
  await stage(id, 'groupSent', other, otherId)
  const delivered = await stored(id)
  expect(delivered.status).toBe('已交付'); expect(delivered.draft_at).toBeTruthy()
  expect((await summary(id, otherId)).available).toBe(200)
  expect((await boss.act('order.confirmGraduation', { id })).status).toBe(200)
  expect((await stored(id)).graduated_at).toEqual(delivered.graduated_at)
  expect((await sql`select id from settlements where order_id=${id}`)).toHaveLength(0)
})

it('截图必须属于本单、本人上传且真实有效；管理员可代交，阶段凭证禁止删除', async () => {
  const id = await order(100, true), elsewhere = await order()
  const input = { id, userId: writerId, stage: 'completed' }
  expect((await sales.act('order.writerStage', { ...input, proofIds: [] })).status).toBe(403)
  expect((await other.act('order.writerStage', { ...input, proofIds: await deliveryProof(other, id) })).status).toBe(403)
  expect((await writer.act('order.writerStage', { ...input, proofIds: await deliveryProof(writer, elsewhere) })).status).toBe(400)
  const otherProof = await deliveryProof(other, id)
  expect((await writer.act('order.writerStage', { ...input, proofIds: otherProof })).status).toBe(403)
  const fake = await writer.upload(id, 'invalid.png', Buffer.from('not-image'), undefined, 'image/png')
  expect((await writer.act('order.writerStage', { ...input, proofIds: [fake.body.id] })).status).toBe(400)
  const removed = await deliveryProof(writer, id)
  expect((await writer.act('attachment.remove', { id: removed[0] })).status).toBe(200)
  expect((await writer.act('order.writerStage', { ...input, proofIds: removed })).status).toBe(400)
  const bossProof = await deliveryProof(boss, id)
  expect((await boss.act('order.writerStage', { ...input, proofIds: bossProof })).status).toBe(200)
  expect((await boss.act('attachment.remove', { id: bossProof[0] })).status).toBe(400)
  expect((await sql`select deleted_at from attachments where id=${bossProof[0]}`)[0].deleted_at).toBeNull()
})

it('快捷、批量、手工草稿确认自由发放；草稿不占额，超发有记录', async () => {
  const id = await order()
  const first = payment(id, 20)
  expect((await boss.act('settle.pay', first)).status).toBe(200)
  expect((await boss.act('settle.pay', first)).status).toBe(200)
  expect(await summary(id)).toMatchObject({ paid: 20, left: 80, available: 80, suggest: 0 })
  const draft = await boss.act('settle.save', { kind: '写手工资', payeeId: writerId, lines: [{ orderId: id, amount: 130 }] })
  expect(draft.status).toBe(200)
  expect((await summary(id)).available).toBe(80)
  expect((await boss.act('settle.confirm', { id: draft.body.id })).status).toBe(200)
  const bulk = { requestId: randomUUID(), kind: '写手工资', payeeId: writerId, date: day, lines: [{ orderId: id, amount: .01 }] }
  expect((await boss.act('settle.payBatch', bulk)).status).toBe(200)
  expect((await boss.act('settle.payBatch', bulk)).status).toBe(200)
  expect(await summary(id)).toMatchObject({ due: 100, paid: 150.01, left: 0, over: 50.01 })
  expect((await writer.act('settle.pay', payment(id, 30))).status).toBe(403)
})

it('旧单沿用全额规则，切换拒绝旧工资草稿且保留历史付款，不据旧交付补阶段', async () => {
  const id = await order()
  await sql`update orders set writer_pay_plan='full' where id=${id}`
  expect((await writer.act('order.markDraft', { id, proofIds: await deliveryProof(writer, id) })).status).toBe(200)
  const legacy = await stored(id)
  expect((await summary(id)).available).toBe(100)
  expect((await boss.act('settle.pay', payment(id, 60))).status).toBe(200)
  const draft = await boss.act('settle.save', { kind: '写手工资', payeeId: writerId, lines: [{ orderId: id, amount: 40 }] })
  expect(draft.status).toBe(200)
  expect((await boss.act('order.enableStagedPay', { id })).status).toBe(400)
  expect((await boss.act('settle.void', { id: draft.body.id, reason: '切换规则' })).status).toBe(200)
  expect((await writer.act('order.enableStagedPay', { id })).status).toBe(403)
  expect((await boss.act('order.enableStagedPay', { id })).status).toBe(200)
  expect((await boss.act('order.enableStagedPay', { id })).status).toBe(200)
  expect((await stored(id)).draft_at).toEqual(legacy.draft_at)
  expect((await sql`select user_id from writer_progress where order_id=${id}`)).toHaveLength(0)
  expect(await summary(id)).toMatchObject({ paid: 60, unpaid: 40, available: 40 })
  await stage(id, 'completed'); expect((await summary(id)).available).toBe(40)
  await stage(id, 'groupSent'); expect((await summary(id)).available).toBe(40)
})

it('调整工资或写手不抹掉阶段，也不把已交付的单打回未交付', async () => {
  const id = await order()
  await stage(id, 'completed'); await stage(id, 'groupSent')
  const delivered = await stored(id)
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: otherId, pay: 200 }, { userId: writerId, pay: 150 }] })).status).toBe(200)
  expect(await stored(id)).toMatchObject({ status: '已交付', draft_at: delivered.draft_at })
  expect((await summary(id)).available).toBe(150)
  expect((await summary(id, otherId)).available).toBe(200)
  await stage(id, 'completed', other, otherId)
  expect((await stored(id)).status).toBe('已交付')
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: writerId, pay: 150 }] })).status).toBe(200)
  expect(await stored(id)).toMatchObject({ status: '已交付', draft_at: delivered.draft_at })
  expect((await sql`select user_id from writer_progress where order_id=${id}`)).toHaveLength(2)
})
