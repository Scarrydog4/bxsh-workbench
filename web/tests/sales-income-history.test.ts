import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { GET as incomeGet } from '@/app/api/income/route'
import { incomeSettlementSummary, writerIncomeOrders, type IncomeRow } from '@/shared/income'

let boss: Client, sales: Client, yang: Client, writer: Client
const ids: Record<string, string> = {}
const context = { params: Promise.resolve({}) }
const read = async (client: Client, user: string) => {
  const response = await incomeGet(new Request(`http://test.local/api/income?user=${user}`, { headers: { cookie: client.cookie } }), context)
  return { status: response.status, body: await response.json() }
}
let ledgerBefore: unknown

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-15T06:00:00Z')
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); yang = await as('xiaoyang'); writer = await as('xiaosenkai')
  const channelId = (await boss.act('channel.create', { name: '销售历史发放', ownerId: 'u-acheng' })).body.id
  for (const title of ['active', 'deleted', 'returned', 'transferred', 'deleted-transferred', 'unpaid-deleted']) {
    const result = await boss.act('order.create', { title, channelId, ownerId: 'u-acheng', orderDate: '2026-10-15', dueDate: null, basePrice: 100, assignees: [{ userId: 'u-xiao', pay: 20 }] })
    expect(result.status).toBe(200); ids[title] = result.body.id
  }
  for (const [key, amount] of [['active', 10], ['deleted', 7.5], ['returned', 4], ['transferred', 5], ['deleted-transferred', 6]] as const) {
    await sql`insert into settlements (id,order_id,kind,payee_id,amount,status) values (${`paid-${key}`},${ids[key]},'销售提成','u-acheng',${amount},'已确认')`
  }
  await sql`insert into settlements (id,order_id,kind,payee_id,amount,status) values
    ('draft-deleted',${ids.deleted},'销售提成','u-acheng',2,'草稿'),
    ('void-deleted',${ids.deleted},'销售提成','u-acheng',9,'已作废'),
    ('paid-yang',${ids['deleted-transferred']},'销售提成','u-yang',3,'已确认')`
  await sql`update orders set deleted_at='2026-10-16T01:00:00Z' where id in (${ids.deleted},${ids['deleted-transferred']},${ids['unpaid-deleted']})`
  await sql`update orders set status='退单' where id=${ids.returned}`
  await sql`update orders set owner_id='u-yang' where id in (${ids.transferred},${ids['deleted-transferred']})`
  ledgerBefore = await sql`select * from settlements order by id`
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })

it('删除、退单和转交保留本人实发提成，历史行保留实发，未删除退单仍保留原应得', async () => {
  const response = await read(sales, 'u-acheng')
  expect(response.status).toBe(200)
  const rows = response.body.rows as IncomeRow[]
  expect(rows).toHaveLength(5)
  expect(incomeSettlementSummary(rows).paid).toBe(32.5)
  const active = rows.find(row => row.id === ids.active)!
  expect(active).toMatchObject({ kind: '提成', amount: 40, settlement: { paid: 10, unpaid: 30 }, available: 30 })
  for (const [key, paid] of [['deleted', 7.5], ['returned', 4], ['transferred', 5], ['deleted-transferred', 6]] as const) {
    const left = key === 'deleted' || key === 'returned' ? 40 - paid : 0
    expect(rows.find(row => row.id === ids[key])).toMatchObject({ kind: '已发提成', amount: paid, settlement: { paid, unpaid: left }, available: left, left, reserved: 0, pending: 0 })
  }
  expect(rows.some(row => row.id === ids['unpaid-deleted'])).toBe(false)
  const adminRows = (await read(boss, 'u-acheng')).body.rows
  expect(adminRows.map(({ allocationPolicy, suggest, ...row }: any) => row)).toEqual(rows)
  const visibleOrders = (await sales.boot()).body.orders.map((order: { id: string }) => order.id)
  for (const key of ['deleted', 'transferred', 'deleted-transferred']) expect(visibleOrders).not.toContain(ids[key])
  expect(await sql`select * from settlements order by id`).toEqual(ledgerBefore)
})

it('历史发放按收款人隔离，当前销售只剩扣除前任实发后的应得', async () => {
  const rows = (await read(yang, 'u-yang')).body.rows as IncomeRow[]
  expect(rows).toHaveLength(2)
  expect(rows.find(row => row.id === ids.transferred)).toMatchObject({ kind: '提成', amount: 35, settlement: { paid: 0, unpaid: 35 } })
  expect(rows.find(row => row.id === ids['deleted-transferred'])).toMatchObject({ kind: '已发提成', amount: 3, due: 34, settlement: { paid: 3, unpaid: 31 }, available: 31 })
  expect((await read(yang, 'u-acheng')).status).toBe(403)
  expect((await read(writer, 'u-acheng')).status).toBe(403)
  const writerRows = (await read(writer, 'u-xiao')).body.rows as IncomeRow[]
  expect(writerRows.some(row => row.kind.includes('提成'))).toBe(false)
})

it('禁止查看提成时也不泄露删除订单的历史已发金额', async () => {
  const role = await boss.act('role.save', { name: '无提成可见', perms: ['order.view', 'income.view'], rowScope: 'owned', fields: { sales: true, writerPay: 'none', commission: 'none', profit: false, channelNo: false } })
  expect(role.status).toBe(200)
  expect((await boss.act('user.update', { id: 'u-acheng', patch: { roleId: role.body.id } })).status).toBe(200)
  sales = await as('acheng')
  const response = await read(sales, 'u-acheng')
  expect(response.status).toBe(200)
  expect(response.body.rows).toEqual([])
})

it('删除或移出写手后保留35元历史实发，不能再次发放也不开放原订单', async () => {
  const channelId = (await boss.act('channel.create', { name: '写手历史发放', ownerId: 'u-boss' })).body.id
  const history: string[] = []
  for (const [label, amount] of [['删除', 10], ['移出', 25]] as const) {
    const created = await boss.act('order.create', { title: `历史工资${label}`, channelId, ownerId: 'u-boss', orderDate: '2026-10-15', dueDate: null, basePrice: 100, assignees: [{ userId: 'u-xiao', pay: 40 }] })
    expect(created.status).toBe(200)
    const id = created.body.id; history.push(id)
    await sql`insert into settlements (id,order_id,kind,payee_id,amount,status) values (${`wage-${label}`},${id},'写手工资','u-xiao',${amount},'已确认')`
    if (label === '删除') await sql`update orders set deleted_at='2026-10-16T01:00:00Z' where id=${id}`
    else await sql`delete from order_writers where order_id=${id}`
  }
  const before = await sql`select * from settlements order by id`
  const rows = (await read(writer, 'u-xiao')).body.rows as IncomeRow[]
  const historical = rows.filter(row => history.includes(row.id))
  expect(historical).toHaveLength(2)
  expect(incomeSettlementSummary(rows).paid).toBe(35)
  expect(writerIncomeOrders(historical).reduce((sum, row) => sum + row.amount!, 0)).toBe(35)
  for (const row of historical) expect(row).toMatchObject({ kind: '已发工资', amount: row.settlement!.paid, left: row.id === history[0] ? 30 : 0, pending: 0, reserved: 0 })
  expect((await read(boss, 'u-xiao')).body.rows.filter((row: IncomeRow) => history.includes(row.id)).map(({ allocationPolicy, suggest, writerStages, ...row }: any) => row)).toEqual(historical)
  const visibleOrders = (await writer.boot()).body.orders.map((order: { id: string }) => order.id)
  for (const id of history) expect(visibleOrders).not.toContain(id)
  expect(await sql`select * from settlements order by id`).toEqual(before)
})
