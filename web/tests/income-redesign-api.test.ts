import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { sql } from '@/server/db'
import { runJobs } from '@/server/jobs'
import { GET as ordersGet } from '@/app/api/orders/route'
import { GET as incomeGet } from '@/app/api/income/route'
import { GET as settleGet } from '@/app/api/settle/order/route'
import { as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, sales: Client, writer: Client, channelId: string
const ctx = { params: Promise.resolve({}) }
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-16T06:00:00Z')
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '自主发放验收', ownerId: 'u-acheng' })).body.id
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })
async function create(client = boss) {
  const r = await client.act('order.create', { title: '自主发放', channelId, ownerId: 'u-acheng', orderDate: '2026-10-16', dueDate: null, basePrice: 1000 })
  expect(r.status).toBe(200); return r.body.id as string
}
const input = (orderId: string, amount: number, kind = '写手工资', payeeId = 'u-xiao') => ({ requestId: randomUUID(), orderId, amount, kind, payeeId })
const banned = /allocation|fixed_60|percent|commissionRate|writerPayPlan|writerStages/
const get = async (route: typeof incomeGet, path: string, client: Client) => {
  const r = await route(new Request(`http://test.local${path}`, { headers: { cookie: client.cookie } }), ctx)
  return { status: r.status, body: await r.json() }
}
it('三角色在 boot、收入、订单接口裁剪制度，写手不返回客户金额', async () => {
  const id = await create(sales)
  const b = (await boss.boot()).body
  expect(b.orders.find((o: any) => o.id === id).assignees).toEqual([{ userId: 'u-xiao', pay: 200 }])
  expect(JSON.stringify(b)).toMatch(/allocationPolicy/)
  for (const client of [sales, writer]) {
    const boot = (await client.boot()).body
    expect(JSON.stringify(boot)).not.toMatch(banned)
    const detail = await get(ordersGet, `/api/orders?ids=${id}`, client)
    expect(detail.status).toBe(200); expect(JSON.stringify(detail.body)).not.toMatch(banned)
    const income = await get(incomeGet, '/api/income', client)
    expect(income.status).toBe(200); expect(JSON.stringify(income.body)).not.toMatch(banned)
    const row = income.body.rows.find((r: any) => r.id === id)
    expect(row).toMatchObject({ due: 200, paid: 0, left: 200, over: 0, custStage: 'none', depositAt: null, paidUpAt: null })
    expect(row).not.toHaveProperty('suggest')
    expect((await get(settleGet, `/api/settle/order?order=${id}&kind=写手工资&payee=u-xiao`, client)).status).toBe(403)
    if (client === writer) {
      for (const object of [row, boot.orders.find((o: any) => o.id === id)]) for (const key of ['sales', 'received', 'payments', 'basePrice', 'unpaid']) expect(object).not.toHaveProperty(key)
    }
  }
  const spoof = await sales.act('order.create', { title: '伪填工资', channelId, ownerId: 'u-acheng', orderDate: '2026-10-16', dueDate: null, basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 999 }] })
  expect(spoof.status).toBe(200)
  expect((await boss.boot()).body.orders.find((o: any) => o.id === spoof.body.id).assignees[0].pay).toBe(200)
})
it('自定义结算管理员可以看建议，但仍无制度字段', async () => {
  const id = await create()
  const role = await boss.act('role.save', { name: '结算执行人', perms: ['order.view', 'settle.manage', 'income.all'], rowScope: 'all', fields: { sales: false, writerPay: 'all', commission: 'all', profit: false, channelNo: false } })
  expect(role.status).toBe(200)
  await boss.act('user.update', { id: 'u-yang', patch: { roleId: role.body.id } })
  const manager = await as('xiaoyang')
  const summary = await get(settleGet, `/api/settle/order?order=${id}&kind=写手工资&payee=u-xiao`, manager)
  expect(summary.status).toBe(200); expect(summary.body).toMatchObject({ due: 200, suggest: 0 })
  expect(JSON.stringify(summary.body)).not.toMatch(banned)
  expect(JSON.stringify((await manager.boot()).body)).not.toMatch(banned)
})
it('未收款、未交付、退单和超发都成功；所有入口保留金额和收款人校验', async () => {
  const id = await create()
  expect((await boss.act('settle.pay', input(id, .01))).status).toBe(200)
  await boss.act('order.update', { id, patch: { status: '退单' } })
  expect((await boss.act('settle.pay', { ...input(id, 250), note: '额外补发' })).status).toBe(200)
  expect((await boss.boot()).body.audit.some((a: any) => a.objectId === id && a.note.includes('超出应得 ¥50.01') && a.note.includes('额外补发'))).toBe(true)
  for (const amount of [0, -.01, 1.001, 1_000_000.01]) {
    expect((await boss.act('settle.pay', input(id, amount))).status).toBe(400)
    expect((await boss.act('settle.save', { kind: '写手工资', payeeId: 'u-xiao', lines: [{ orderId: id, amount }] })).status).toBe(400)
  }
  for (const payeeId of ['u-boss', 'u-acheng', 'missing']) {
    expect((await boss.act('settle.pay', input(id, 1, '写手工资', payeeId))).status).toBe(400)
    expect((await boss.act('settle.payBatch', { requestId: randomUUID(), kind: '写手工资', payeeId, lines: [{ orderId: id, amount: 1 }] })).status).toBe(400)
    expect((await boss.act('settle.save', { kind: '写手工资', payeeId, lines: [{ orderId: id, amount: 1 }] })).status).toBe(400)
  }
  // 有历史工资记录的前任写手可以补发。
  await sql`delete from order_writers where order_id=${id}`
  expect((await boss.act('settle.pay', input(id, 1))).status).toBe(200)
  const salesId = await create()
  expect((await boss.act('settle.pay', input(salesId, 300, '销售提成', 'u-acheng'))).status).toBe(200)
  await sql`update orders set owner_id='u-yang' where id=${salesId}`
  expect((await boss.act('settle.pay', input(salesId, 1, '销售提成', 'u-acheng'))).status).toBe(200)
})
it('累计实发包含无 batch 的历史同步款，排除草稿和作废，按三角色裁剪', async () => {
  const id = await create()
  await sql`insert into settlements (id,order_id,kind,payee_id,amount,status,migrated) values
    ('history-30',${id},'写手工资','u-xiao',2035,'已确认',true),
    ('history-draft',${id},'写手工资','u-xiao',40,'草稿',false),
    ('history-void',${id},'写手工资','u-xiao',50,'已作废',false)`
  const [total] = await sql`select sum(amount)::float8 as paid from settlements where status='已确认'`
  const b = (await boss.boot()).body
  expect(b.settlementSummary.paid).toBe(total.paid)
  const w = (await writer.boot()).body
  const [writerTotal] = await sql`select sum(amount)::float8 as paid from settlements where status='已确认' and payee_id='u-xiao'`
  expect(w.settlementSummary.paid).toBe(writerTotal.paid)
  expect(w.settlementSummary.rows.every((r: any) => r.payeeId === 'u-xiao')).toBe(true)
  expect((await sales.boot()).body.settlementSummary.rows.every((r: any) => r.payeeId === 'u-acheng')).toBe(true)
})
it('系统草稿一次性作废并留痕，手工草稿和已确认流水不变；定时任务不再生成草稿', async () => {
  const id = await create()
  for (const [batch, creator, status, payee] of [['auto', 'system', '草稿', 'u-xiao'], ['auto-boss', 'system', '草稿', 'u-boss'], ['manual', 'u-boss', '草稿', 'u-xiao'], ['confirmed', 'system', '已确认', 'u-xiao']]) {
    await sql`insert into settle_batches (id,no,kind,payee_id,status,created_by) values (${batch},${batch},'写手工资',${payee},${status},${creator})`
    await sql`insert into settlements (id,batch_id,order_id,kind,payee_id,amount,status) values (${batch},${batch},${id},'写手工资',${payee},100,${status})`
  }
  expect((await boss.act('settle.confirm', { id: 'auto-boss' })).status).toBe(400)
  const before = await sql`select * from settlements where status='已确认' order by id`
  const migration = await readFile('drizzle/0019_retire_system_settlement_drafts.sql', 'utf8')
  await sql.unsafe(migration); await sql.unsafe(migration)
  expect(await sql`select id,status from settle_batches where id in ('auto','auto-boss','manual','confirmed') order by id`).toEqual([
    { id: 'auto', status: '已作废' }, { id: 'auto-boss', status: '已作废' }, { id: 'confirmed', status: '已确认' }, { id: 'manual', status: '草稿' },
  ])
  expect(await sql`select * from settlements where status='已确认' order by id`).toEqual(before)
  expect(await sql`select note from audit where object_id in ('auto','auto-boss')`).toEqual([{ note: '改为收入页直接发放' }, { note: '改为收入页直接发放' }])
  expect((await runJobs(new Date('2026-10-16T06:00:00Z'))).drafts).toBe(0)
  expect(await sql`select id from settle_batches where created_by='system' and status='草稿'`).toHaveLength(0)
})
