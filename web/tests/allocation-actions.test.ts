import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, deliveryProof, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'

let boss: Client, sales: Client, writer: Client, channelId: string
const now = '2026-10-16T06:00:00Z'
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '分成制度测试', ownerId: 'u-acheng' })).body.id
  expect((await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })).status).toBe(200)
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })
const base = () => ({ title: '固定分成', channelId, ownerId: 'u-acheng', orderDate: '2026-10-16', dueDate: null, basePrice: 500 })
async function create(patch: Record<string, unknown> = {}, client = boss) {
  const r = await client.act('order.create', { ...base(), ...patch })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  const id = r.body.id as string
  // 本套用例回归旧的固定20%制度；当前新建流程另由 writer-rates-api 覆盖。
  await sql`update orders set writer_rates_enabled=false where id=${id}`
  const requested = (patch.assignees as {userId:string;pay:number|null}[] | undefined) ?? [{userId:'u-xiao',pay:null}]
  expect((await boss.act('order.setWriters', {id,writers:requested})).status).toBe(200)
  return id
}
const view = async (id: string) => (await boss.boot()).body.orders.find((order: any) => order.id === id)

it('按服务端创建日锁定新制度，回填下单日期及请求伪造制度均不能绕过', async () => {
  const id = await create({ orderDate: '2026-09-01', allocationPolicy: 'legacy', assignees: [{ userId: 'u-xiao', pay: 999 }] })
  expect(await view(id)).toMatchObject({ allocationPolicy: 'fixed_60_20_20_v1', commission: 100, bossIncome: 300, assignees: [{ userId: 'u-xiao', pay: 100 }] })
  expect((await boss.act('order.update', { id, patch: { orderDate: '2026-10-01', allocationPolicy: 'legacy' } })).status).toBe(200)
  expect(await view(id)).toMatchObject({ allocationPolicy: 'fixed_60_20_20_v1', commission: 100, assignees: [{ userId: 'u-xiao', pay: 100 }] })
})

it('多个写手共用20%池，默认均分、有效拆分保留，超额与重复写手拒绝', async () => {
  const equal = await create({ basePrice: 500.05, assignees: [{ userId: 'u-xiao', pay: null }, { userId: 'u-boss', pay: null }] })
  expect((await view(equal)).assignees).toEqual([{ userId: 'u-xiao', pay: 50 }, { userId: 'u-boss', pay: 50.01 }])
  const split = await create({ assignees: [{ userId: 'u-xiao', pay: 70 }, { userId: 'u-boss', pay: 30 }] })
  expect(await view(split)).toMatchObject({ writerTotal: 100, externalWriterTotal: 70, bossIncome: 330 })
  for (const assignees of [[{ userId: 'u-xiao', pay: 80 }, { userId: 'u-boss', pay: 80 }], [{ userId: 'u-xiao', pay: 50 }, { userId: 'u-xiao', pay: 50 }]]) {
    expect((await boss.act('order.setWriters', { id: equal, writers: assignees })).status).toBe(400)
  }
})

it('老板自营自写份额归老板，销售默认写手自动计价但仍无权修改或窥见工资', async () => {
  const own = await create({ ownerId: 'u-boss', assignees: [{ userId: 'u-boss', pay: 0 }] })
  expect(await view(own)).toMatchObject({ bossIncome: 500, commission: 0, assignees: [{ userId: 'u-boss', pay: 100 }] })
  const id = await create({}, sales)
  expect((await view(id)).assignees).toEqual([{ userId: 'u-xiao', pay: 100 }])
  expect((await sales.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 1 }] })).status).toBe(403)
  const ownView = (await sales.boot()).body.orders.find((order: any) => order.id === id)
  expect(ownView.assignees[0].pay).toBeUndefined()
  expect((await writer.act('order.update', { id, patch: { basePrice: 1 } })).status).toBe(403)
})

it('原制度订单保持原工资及比例，修改下单日期不会切换制度', async () => {
  vi.setSystemTime('2026-10-15T06:00:00Z')
  let id: string
  try { id = await create({ orderDate: '2026-10-15', assignees: [{ userId: 'u-xiao', pay: 120 }] }) }
  finally { vi.setSystemTime(now) }
  expect((await boss.act('order.update', { id, patch: { orderDate: '2026-10-18', basePrice: 600 } })).status).toBe(200)
  expect(await view(id)).toMatchObject({ allocationPolicy: 'legacy', commission: 240, assignees: [{ userId: 'u-xiao', pay: 120 }] })
})

it('改写手、拆分和批量换写手始终维持20%总额', async () => {
  const id = await create()
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 1 }] })).status).toBe(200)
  expect((await view(id)).assignees[0].pay).toBe(100)
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao' }, { userId: 'u-boss', pay: null }] })).status).toBe(200)
  expect((await view(id)).assignees).toEqual([{ userId: 'u-xiao', pay: 50 }, { userId: 'u-boss', pay: 50 }])
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 25 }, { userId: 'u-boss', pay: 75 }] })).status).toBe(200)
  expect((await boss.act('order.bulkWriters', { ids: [id], writerId: 'u-boss' })).status).toBe(200)
  expect((await view(id)).assignees).toEqual([{ userId: 'u-boss', pay: 100 }])
})

it('改价、追加减免及撤销按现有拆分比例自动更新工资，不产生舍入超额', async () => {
  const id = await create({ assignees: [{ userId: 'u-xiao', pay: 30 }, { userId: 'u-boss', pay: 70 }] })
  expect((await boss.act('order.update', { id, patch: { basePrice: 800 } })).status).toBe(200)
  expect((await view(id)).assignees).toEqual([{ userId: 'u-xiao', pay: 48 }, { userId: 'u-boss', pay: 112 }])
  expect((await boss.act('order.addAdjustment', { id, amount: 50, reason: '增加需求' })).status).toBe(200)
  expect((await view(id)).assignees).toEqual([{ userId: 'u-xiao', pay: 51 }, { userId: 'u-boss', pay: 119 }])
  const adjustmentId = (await view(id)).adjustments[0].id
  expect((await boss.act('order.revokeAdjustment', { id, adjustmentId, reason: '撤回增加' })).status).toBe(200)
  expect((await view(id)).assignees).toEqual([{ userId: 'u-xiao', pay: 48 }, { userId: 'u-boss', pay: 112 }])
  expect((await boss.act('order.addAdjustment', { id, amount: -900, reason: '不允许负金额' })).status).toBe(400)
})

it('售后不能独立追加工资，新增需求加价沿用20%且重试不重复加价', async () => {
  const id = await create()
  expect((await boss.act('aftersale.create', { orderId: id, req: ['新增功能'], reason: '新增需求', extra: 20 })).status).toBe(400)
  const asId = (await boss.act('aftersale.create', { orderId: id, req: ['新增功能'] })).body.id
  expect((await boss.act('aftersale.reason', { orderId: id, asId, reason: '新增需求', extra: 20 })).status).toBe(400)
  const payload = { orderId: id, asId, reason: '新增需求', charge: 100, requestId: randomUUID() }
  expect((await boss.act('aftersale.reason', payload)).status).toBe(200)
  expect((await boss.act('aftersale.reason', payload)).status).toBe(200)
  expect(await view(id)).toMatchObject({ sales: 600, assignees: [{ userId: 'u-xiao', pay: 120 }] })
  expect((await view(id)).afterSales[0].extra).toBe(0)
})

it('草稿不占额，降价按总应得检查已发，原确认流水不变', async () => {
  const id = await create({ basePrice: 1000 })
  const proofIds = await deliveryProof(writer, id)
  expect((await writer.act('order.writerStage', { id, userId: 'u-xiao', stage: 'completed', proofIds })).status).toBe(200)
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: id, kind: '写手工资', payeeId: 'u-xiao', amount: 50 })).status).toBe(200)
  expect((await boss.act('settle.save', { kind: '写手工资', payeeId: 'u-xiao', lines: [{ orderId: id, amount: 30 }] })).status).toBe(200)
  expect((await boss.act('order.update', { id, patch: { basePrice: 600 } })).status).toBe(200)
  for (const [action, data] of [
    ['order.setWriters', { id, writers: [{ userId: 'u-boss', pay: null }] }],
    ['order.bulkWriters', { ids: [id], writerId: 'u-boss' }],
  ] as const) expect((await boss.act(action, data)).status).toBe(400)
  expect(await view(id)).toMatchObject({ sales: 600, assignees: [{ userId: 'u-xiao', pay: 120 }] })
  const rows = (await view(id)).settlements
  expect(rows.find((row: any) => row.status === '已确认')?.amount).toBe(50)
  expect(rows.find((row: any) => row.status === '草稿')?.amount).toBe(30)
})

it('销售草稿不限制降价，已发记录保持不变', async () => {
  const id = await create()
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: id, kind: '销售提成', payeeId: 'u-acheng', amount: 40 })).status).toBe(200)
  expect((await boss.act('settle.save', { kind: '销售提成', payeeId: 'u-acheng', lines: [{ orderId: id, amount: 50 }] })).status).toBe(200)
  expect((await boss.act('order.update', { id, patch: { basePrice: 400 } })).status).toBe(200)
  expect(await view(id)).toMatchObject({ sales: 400, commission: 80 })
})

it('底价保留原工资，新制销售不能切底价绕规则，仅老板可切换', async () => {
  expect((await sales.act('order.create', { ...base(), salesMode: 'cost' })).status).toBe(403)
  const id = await create({ salesMode: 'cost', assignees: [{ userId: 'u-xiao', pay: 80 }] })
  expect(await view(id)).toMatchObject({ bossIncome: 420, commission: 0, assignees: [{ userId: 'u-xiao', pay: 80 }] })
  expect((await boss.act('order.update', { id, patch: { salesMode: 'commission' } })).status).toBe(200)
  expect(await view(id)).toMatchObject({ commission: 100, bossIncome: 300, assignees: [{ userId: 'u-xiao', pay: 100 }] })
  expect((await sales.act('order.update', { id, reason: '切换规避', patch: { salesMode: 'cost' } })).status).toBe(403)
  expect((await boss.act('order.update', { id, patch: { salesMode: 'cost' } })).status).toBe(200)
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 80 }] })).status).toBe(200)
  expect((await boss.act('order.update', { id, patch: { basePrice: 600 } })).status).toBe(200)
  expect(await view(id)).toMatchObject({ commission: 0, bossIncome: 520, assignees: [{ userId: 'u-xiao', pay: 80 }] })
  const rows = await sql`select allocation_policy from orders where id=${id}`
  expect(rows[0].allocation_policy).toBe('fixed_60_20_20_v1')
})
