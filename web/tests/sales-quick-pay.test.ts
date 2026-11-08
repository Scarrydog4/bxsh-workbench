import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, resetDb, type Client } from './helpers'
import { businessDate } from '@/shared/format'
import { GET as imageGet } from '@/app/api/settle/[id]/images/[hash]/route'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client, other: Client, channelId: string, order: string
const day = '2026-10-15'
const priorDay = '2026-10-14'
const shot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='
const input = (amount: number) => ({ requestId: randomUUID(), kind: '销售提成', orderId: order, payeeId: 'u-acheng', amount })
const boot = async (c: Client) => (await c.boot()).body
const create = async (pay: number | null = 300) => {
  const r = await boss.act('order.create', { title: '销售逐单结算', orderDate: day, dueDate: null, channelId, ownerId: 'u-acheng', basePrice: 600, assignees: [{ userId: 'u-xiao', pay }] })
  expect(r.status).toBe(200)
  return r.body.id as string
}
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-15T06:00:00Z')
  await resetDb()
  boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng'); other = await as('xiaoyang')
  channelId = (await boss.act('channel.create', { name: '销售逐单结算验证', ownerId: 'u-acheng' })).body.id
  order = await create()
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })

it('销售和写手不能自行发提成，也不能给错误归属或自营账号发提成', async () => {
  expect((await sales.act('settle.pay', input(100))).status).toBe(403)
  expect((await writer.act('settle.pay', input(100))).status).toBe(403)
  expect((await boss.act('settle.pay', { ...input(100), payeeId: 'u-yang' })).status).toBe(400)
  expect((await boss.act('settle.pay', { ...input(100), payeeId: 'u-boss' })).status).toBe(400)
  const pending = await create(null)
  const r = await boss.act('settle.pay', { ...input(1), orderId: pending }); expect(r.status).toBe(200)
  expect((await boss.act('settle.void', { id: r.body.id, reason: '测试重置' })).status).toBe(200)
})

let first: ReturnType<typeof input> & { date: string; note: string; shots: string[] }
it('未收齐仍允许管理员部分发提成；日期、文字、截图同笔保存，并发重试不重复', async () => {
  first = { ...input(100), date: priorDay, note: '先发100提成，余款50下次结', shots: [shot] }
  const r = await Promise.all([boss.act('settle.pay', first), boss.act('settle.pay', first)])
  expect(r.map(x => x.status)).toEqual([200, 200])
  expect(r[0].body.id).toBe(r[1].body.id)
  const b = await boot(sales)
  expect(b.batches.filter((b: any) => b.status === '已确认')).toHaveLength(1)
  const batch = b.batches.find((b: any) => b.status === '已确认')
  expect(batch).toMatchObject({ kind: '销售提成', status: '已确认', payeeId: 'u-acheng', note: first.note, total: 100 })
  expect(businessDate(batch.confirmedAt)).toBe(priorDay)
  expect(batch.lines[0].note).toContain(`${priorDay} 结算 ¥100 · 老板`)
  expect(batch.lines[0].note).toContain('仅记录付款日期')
  expect(batch.shots).toHaveLength(1)
  const row = b.income['u-acheng'].find((r: { id: string }) => r.id === order)
  expect(row).toMatchObject({ amount: 150, available: 50, settlement: { paid: 100, unpaid: 50 } })
  expect((await boot(writer)).batches).toHaveLength(0)
  const url = batch.shots[0], [, , , id, , hash] = url.split('/')
  for (const [client, status] of [[sales, 200], [writer, 404], [other, 404]] as const) {
    const result = await imageGet(new Request(`http://test.local${url}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({ id, hash }) })
    expect(result.status).toBe(status)
  }
})

it('同一请求不能改结算类型、金额或日期，非法日期不能落款', async () => {
  expect((await boss.act('settle.pay', { ...first, kind: '写手工资' })).status).toBe(400)
  expect((await boss.act('settle.pay', { ...first, amount: 50 })).status).toBe(400)
  expect((await boss.act('settle.pay', { ...first, date: day })).status).toBe(400)
  expect((await boss.act('settle.pay', { ...input(1), date: '2026-02-30' })).status).toBe(400)
  expect((await boss.act('settle.pay', { ...input(1), date: businessDate(new Date(Date.now() + 86_400_000)) })).status).toBe(400)
  expect((await boss.act('settle.pay', input(1.001))).status).toBe(400)
  expect((await boot(sales)).batches.filter((b: any) => b.status === '已确认')).toHaveLength(1)
})

it('草稿不占额，多次结算可超发，实发和超发金额分别记录', async () => {
  const draft = await boss.act('settle.save', { kind: '销售提成', payeeId: 'u-acheng', lines: [{ orderId: order, amount: 20 }] })
  expect(draft.status).toBe(200)
  expect((await boss.act('settle.pay', input(50))).status).toBe(200)
  expect((await boss.act('settle.pay', input(.01))).status).toBe(200)
  expect((await boss.act('settle.void', { id: draft.body.id, reason: '改为逐笔发放' })).status).toBe(200)
  const row = (await boot(sales)).income['u-acheng'].find((r: { id: string }) => r.id === order)
  expect(row).toMatchObject({ due: 150, paid: 150.01, left: 0, over: .01, settle: '已结', reserved: 0 })
})

it('按销售提成字段权限授权，不借写手工资权限绕过', async () => {
  const fresh = await create()
  const fields = { sales: false, writerPay: 'all', commission: 'own', profit: false, channelNo: false }
  const role = await boss.act('role.save', { name: '结算助手', perms: ['order.view', 'settle.manage'], fields, rowScope: 'all' })
  expect(role.status).toBe(200)
  expect((await boss.act('user.update', { id: 'u-yang', patch: { roleId: role.body.id } })).status).toBe(200)
  other = await as('xiaoyang')
  expect((await other.act('settle.pay', { ...input(1), orderId: fresh })).status).toBe(403)
  expect((await boss.act('role.save', { id: role.body.id, name: '结算助手', perms: ['order.view', 'settle.manage'], fields: { ...fields, writerPay: 'none', commission: 'all' }, rowScope: 'all' })).status).toBe(200)
  expect((await other.act('settle.pay', { ...input(1), orderId: fresh })).status).toBe(200)
  expect((await other.act('settle.pay', { ...input(1), kind: '写手工资', orderId: fresh, payeeId: 'u-xiao' })).status).toBe(403)
})
