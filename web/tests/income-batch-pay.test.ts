import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, resetDb, type Client } from './helpers'
import { businessDate } from '@/shared/format'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client, other: Client, channelId: string
const day = '2026-10-15'
const shot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='
const shot2 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const boot = async (c = boss) => (await c.boot()).body
const create = async (pay: number | null = 100, _delivered = true) => {
  const r = await boss.act('order.create', { title: '批量结算回归', orderDate: day, dueDate: null, channelId, ownerId: 'u-acheng', basePrice: 500, assignees: [{ userId: 'u-xiao', pay }] })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  const id = r.body.id as string
  // 本测试覆盖发放，无需先交付；交付接口由 writer-stages-api 验证。
  return id
}
const payload = (lines: { orderId: string; amount: number }[], kind = '写手工资', payeeId = 'u-xiao') => ({ requestId: randomUUID(), kind, payeeId, lines })
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-15T06:00:00Z')
  await resetDb(); boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng'); other = await as('xiaoyang')
  channelId = (await boss.act('channel.create', { name: '批量发放验证', ownerId: 'u-acheng' })).body.id
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })

it('多单、多截图、一次备注原子确认；并发重试及顺序改变不会重复发放', async () => {
  const a = await create(100), b = await create(80)
  const p = { ...payload([{ orderId: a, amount: 100 }, { orderId: b, amount: 80 }]), note: '一起发放', shots: [shot, shot2] }
  const rr = await Promise.all([boss.act('settle.payBatch', p), boss.act('settle.payBatch', { ...p, lines: [...p.lines].reverse() })])
  expect(rr.map(r => r.status)).toEqual([200, 200]); expect(rr[0].body).toEqual(rr[1].body)
  expect(rr[0].body).toMatchObject({ amount: 180, count: 2 })
  const batch = (await boot()).batches.find((x: { id: string }) => x.id === rr[0].body.id)
  expect(batch).toMatchObject({ total: 180, status: '已确认', note: '一起发放', payeeId: 'u-xiao' })
  expect(batch.shots).toHaveLength(2); expect(batch.lines).toHaveLength(2)
  expect(businessDate(batch.confirmedAt)).toBe(day)
  expect((await boot(writer)).batches.some((x: { id: string }) => x.id === batch.id)).toBe(true)
  expect((await boot(other)).batches.some((x: { id: string }) => x.id === batch.id)).toBe(false)
  for (const delta of [{ note: '换备注' }, { shots: [shot] }, { lines: [{ orderId: a, amount: 99 }, { orderId: b, amount: 80 }] }, { kind: '销售提成' }]) expect((await boss.act('settle.payBatch', { ...p, ...delta })).status).toBe(400)
  expect((await boss.act('settle.void', { id: batch.id, reason: '测试撤销' })).status).toBe(200)
  expect((await boss.act('settle.payBatch', p)).status).toBe(400)
})

it('部分已发只补精确余款，批量后累计不重复发放', async () => {
  const a = await create(100), b = await create(80)
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: a, payeeId: 'u-xiao', amount: 40 })).status).toBe(200)
  const result = await boss.act('settle.payBatch', payload([{ orderId: a, amount: 60 }, { orderId: b, amount: 80 }]))
  expect(result.status).toBe(200)
  expect(result.body).toMatchObject({ amount: 140, count: 2 })
  const state = await boot(writer)
  const batch = state.batches.find((x: { id: string }) => x.id === result.body.id)
  expect(batch.lines.find((x: { orderId: string }) => x.orderId === a).amount).toBe(60)
  const confirmedForA = state.batches.filter((x: { status: string }) => x.status === '已确认')
    .flatMap((x: { lines: { orderId: string; amount: number }[] }) => x.lines)
    .filter((x: { orderId: string }) => x.orderId === a)
  expect(confirmedForA.map((x: { amount: number }) => x.amount).sort((x: number, y: number) => x - y)).toEqual([40, 60])
  expect(confirmedForA.reduce((sum: number, x: { amount: number }) => sum + x.amount, 0)).toBe(100)
  expect(state.income['u-xiao'].find((x: { id: string }) => x.id === a)).toMatchObject({ available: 0, settlement: { paid: 100, unpaid: 0 } })
})

it('未交付、应得未定、应得为零或已结均可由老板发放', async () => {
  const valid = await create(), undelivered = await create(100, false), unknown = await create(null), zero = await create(0), paid = await create()
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: paid, payeeId: 'u-xiao', amount: 100 })).status).toBe(200)
  const before = (await boot()).batches.length
  for (const id of [undelivered, unknown, zero, paid]) expect((await boss.act('settle.payBatch', payload([{ orderId: valid, amount: 100 }, { orderId: id, amount: 100 }]))).status).toBe(200)
  expect((await boot()).batches).toHaveLength(before + 4)
})

it('草稿不占额，追加未完成可发，批量每行使用老板自定金额', async () => {
  const a = await create(), b = await create()
  expect((await boss.act('settle.save', { kind: '写手工资', payeeId: 'u-xiao', lines: [{ orderId: a, amount: 30 }] })).status).toBe(200)
  expect((await boss.act('aftersale.create', { orderId: b, writerId: 'u-xiao', req: ['新增图表'], raw: '', reason: '新增需求', extra: 80 })).status).toBe(200)
  expect((await boss.act('settle.payBatch', payload([{ orderId: a, amount: 125.01 }, { orderId: b, amount: 25 }]))).body).toMatchObject({ amount: 150.01, count: 2 })
  const rows = (await boot()).income['u-xiao']
  expect(rows.find((r: any) => r.id === a)).toMatchObject({ paid: 125.01, left: 0, over: 25.01, reserved: 0 })
  expect(rows.find((r: any) => r.id === b)).toMatchObject({ due: 180, paid: 25, left: 155 })
})

it('销售批量可发未收款、底价和未知工资订单；无关人和管理员不能收款', async () => {
  const a = await create(), b = await create(300)
  const p = { ...payload([{ orderId: a, amount: 200 }, { orderId: b, amount: 100 }], '销售提成', 'u-acheng'), date: businessDate(new Date(Date.now() - 86_400_000)) }
  for (const c of [sales, writer]) expect((await c.act('settle.payBatch', p)).status).toBe(403)
  for (const payeeId of ['u-yang', 'u-boss']) expect((await boss.act('settle.payBatch', { ...p, payeeId })).status).toBe(400)
  const unknown = await create(null)
  expect((await boss.act('settle.payBatch', payload([{ orderId: unknown, amount: 1 }], '销售提成', 'u-acheng'))).status).toBe(200)
  const cost = await create()
  expect((await boss.act('order.update', { id: cost, patch: { salesMode: 'cost' } })).status).toBe(200)
  expect((await boss.act('settle.payBatch', payload([{ orderId: cost, amount: 200 }], '销售提成', 'u-acheng'))).status).toBe(200)
  const result = await boss.act('settle.payBatch', p); expect(result.status).toBe(200); expect(result.body.amount).toBe(300)
  const batch = (await boot()).batches.find((x: { id: string }) => x.id === result.body.id)
  expect(businessDate(batch.confirmedAt)).toBe(p.date)
})

it('重复订单、非法日期和分位金额拒绝，退单允许发放', async () => {
  const a = await create()
  const p = payload([{ orderId: a, amount: 100 }])
  expect((await boss.act('settle.payBatch', { ...p, lines: [...p.lines, ...p.lines] })).status).toBe(400)
  for (const date of ['2026-02-30', businessDate(new Date(Date.now() + 86_400_000))]) expect((await boss.act('settle.payBatch', { ...p, date })).status).toBe(400)
  expect((await boss.act('settle.payBatch', { ...p, lines: [{ orderId: a, amount: 99.999 }] })).status).toBe(400)
  expect((await boss.act('order.update', { id: a, patch: { status: '退单' } })).status).toBe(200)
  expect((await boss.act('settle.payBatch', p)).status).toBe(200)
})

it('管理金额字段权限与订单可见范围均校验', async () => {
  const a = await create()
  const fields = { sales: false, writerPay: 'own', commission: 'all', profit: false, channelNo: false }
  const role = await boss.act('role.save', { name: '批量助手', perms: ['order.view', 'settle.manage'], fields, rowScope: 'all' })
  expect((await boss.act('user.update', { id: 'u-yang', patch: { roleId: role.body.id } })).status).toBe(200)
  other = await as('xiaoyang')
  expect((await other.act('settle.payBatch', payload([{ orderId: a, amount: 100 }]))).status).toBe(403)
  expect((await boss.act('role.save', { id: role.body.id, name: '批量助手', perms: ['order.view', 'settle.manage'], fields: { ...fields, writerPay: 'all' }, rowScope: 'owned' })).status).toBe(200)
  expect((await other.act('settle.payBatch', payload([{ orderId: a, amount: 100 }]))).status).toBe(404)
})
