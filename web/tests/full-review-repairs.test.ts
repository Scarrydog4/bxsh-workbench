import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { deliveryProof, as, resetDb, closeDb, loginAs, PW, type Client } from './helpers'
import { sql } from '@/server/db'
import { getCtx } from '@/server/session'
import { query } from '@/server/assistant/query'
import { incomeSummary } from '@/shared/income'
import type { OrderView } from '@/shared/types'
import { receiptMatches } from '@/shared/reconciliation'
import { POST as uploadInit } from '@/app/api/upload/route'
import { PUT as uploadPut } from '@/app/api/upload/[id]/route'
import { POST as uploadDone } from '@/app/api/upload/[id]/complete/route'

let boss: Client, sales: Client, other: Client, writer: Client, writer2: Client
let channelId: string
const day = '2026-10-08'
const view = async (id: string, client = boss): Promise<OrderView> => (await client.boot()).body.orders.find((o: OrderView) => o.id === id)
async function order(extra: object = {}) {
  const r = await boss.act('order.create', { title: '修复验收', orderDate: day, dueDate: null, type: '', ownerId: 'u-acheng', channelId, basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 400 }], ...extra })
  expect(r.status).toBe(200)
  return r.body.id as string
}
async function ctx(client: Client) { return (await getCtx(new Request('http://test.local', { headers: { cookie: client.cookie } })))! }

beforeAll(async () => {
  await resetDb()
  await sql`insert into users(id,name,account,password_hash,role_id,can_write,must_change_password) select 'writer2','第二写手','writer2',password_hash,'r-writer',true,false from users where id='u-xiao'`
  boss = await as('boss'); sales = await as('acheng'); other = await as('xiaoyang'); writer = await as('xiaosenkai'); writer2 = await as('writer2')
  channelId = (await boss.act('channel.create', { name: '修复专用渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

it('同一收款并发、断线后重试只记录一次；新请求仍可登记相同金额', async () => {
  const id = await order(), payload = { id, amount: 300, date: day, tag: '定金', note: '渠道转账', requestId: randomUUID() }
  const results = await Promise.all([sales.act('order.addPayment', payload), sales.act('order.addPayment', payload)])
  expect(results.map(r => r.status)).toEqual([200, 200])
  expect((await sales.act('order.addPayment', payload)).status).toBe(200)
  expect(await view(id)).toMatchObject({ received: 300, payments: [expect.objectContaining({ amount: 300 })] })
  expect((await sales.act('order.addPayment', { ...payload, amount: 301 })).status).toBe(400)
  expect((await sales.act('order.addPayment', { ...payload, requestId: randomUUID() })).status).toBe(200)
  expect((await view(id)).received).toBe(600)
})

it('小数拆笔结清、退款及加价后筛选正确', async () => {
  const id = await order({ basePrice: 600.60 })
  for (const amount of [200.20, 400.40]) await sales.act('order.addPayment', { id, amount, date: day, tag: '收款', note: '分笔收款' })
  const v = await view(id)
  expect(v).toMatchObject({ sales: 600.6, received: 600.6, unpaid: 0, payStatus: '已收齐' })
  expect(receiptMatches(v, 'paid')).toBe(true)
  expect(receiptMatches(v, 'partial')).toBe(false)
  await boss.act('order.addAdjustment', { id, amount: -0.30, reason: '减免' })
  await sales.act('order.addPayment', { id, amount: 0.30, date: day, tag: '退款', note: '退回差额' })
  expect(await view(id)).toMatchObject({ sales: 600.3, received: 600.3, unpaid: 0 })
})

it('回收站限制归属范围，关闭查看订单后也不能导出', async () => {
  const own = await order(), foreign = await order({ ownerId: 'u-yang' })
  await boss.act('order.delete', { ids: [own, foreign] })
  const [r] = await sql`select perms from roles where id='r-sales'`
  await sql`update roles set perms=${JSON.stringify([...r.perms, 'trash.view'])}::jsonb where id='r-sales'`
  const b = (await sales.boot()).body
  expect(b.trash.map((o: OrderView) => o.id)).toContain(own)
  expect(b.trash.map((o: OrderView) => o.id)).not.toContain(foreign)
  await sql`update roles set perms=${JSON.stringify(['order.export', 'trash.view'])}::jsonb where id='r-sales'`
  expect((await sales.boot()).body.trash).toEqual([])
  expect((await sales.exportXlsx()).status).toBe(403)
  await sql`update roles set perms=${JSON.stringify(r.perms)}::jsonb where id='r-sales'`
})

it('有分配权限但工资隐藏时，添加写手保留原工资，伪造空工资会被拒绝', async () => {
  const id = await order(), [r] = await sql`select perms from roles where id='r-sales'`
  await sql`update roles set perms=${JSON.stringify([...r.perms, 'order.assign'])}::jsonb where id='r-sales'`
  expect((await view(id, sales)).assignees[0].pay).toBeUndefined()
  expect((await sales.act('order.setWriters', { id, writers: [{ userId: 'u-xiao' }, { userId: 'writer2', pay: null }] })).status).toBe(200)
  expect((await view(id)).assignees[0].pay).toBe(400)
  expect((await sales.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: null }] })).status).toBe(403)
  expect((await view(id)).assignees[0].pay).toBe(400)
  await sql`update roles set perms=${JSON.stringify(r.perms)}::jsonb where id='r-sales'`
})

it('未完成售后不能丢掉负责人，明确交接后新写手能回复和交付', async () => {
  const id = await order()
  const a = (await boss.act('aftersale.create', { orderId: id, req: ['修改图表'] })).body.id
  const before = (await view(id)).afterSales[0]
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'writer2', pay: 200 }] })).status).toBe(400)
  await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 400 }, { userId: 'writer2', pay: 200 }] })
  expect((await boss.act('aftersale.update', { orderId: id, asId: a, writerId: 'writer2' })).status).toBe(200)
  expect((await view(id)).afterSales[0]).toMatchObject({ writerId: 'writer2', due: before.due, confirmBy: before.confirmBy })
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'writer2', pay: 200 }] })).status).toBe(200)
  expect(await view(id, writer)).toBeUndefined()
  expect((await writer2.act('aftersale.confirm', { orderId: id, asId: a, due: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(200)
  expect((await writer2.act('aftersale.finish', { orderId: id, asId: a, proofIds: await deliveryProof(writer2, id, a) })).status).toBe(200)
})

it('转交后原销售保留已发提成，新销售的明细、首页、助手都为剩余应得', async () => {
  const ch = (await boss.act('channel.create', { name: '转交专用', ownerId: 'u-acheng' })).body.id
  const id = await order({ title: '转交收入唯一验收', channelId: ch })
  await sql`update orders set commission_rate=.1 where id=${id}`
  await sql`insert into settlements(id,kind,payee_id,order_id,amount,status) values ('review-paid','销售提成','u-acheng',${id},20,'已确认')`
  await boss.act('channel.update', { id: ch, patch: { ownerId: 'u-yang' } })
  const old = (await sales.boot()).body, current = (await other.boot()).body
  expect(old.orders.some((o: OrderView) => o.id === id)).toBe(false)
  expect(old.income['u-acheng'].find((r: { id: string }) => r.id === id)).toMatchObject({ amount: 20, kind: '已发提成' })
  const rows = current.income['u-yang'].filter((r: { id: string }) => r.id === id)
  expect(incomeSummary(rows, '2026-10').amount).toBe(40)
  expect(await view(id, other)).toMatchObject({ commission: 40, salesSettle: '未结算' })
  expect(await query(await ctx(other), 'summarize_orders', { query: '转交收入唯一验收', metric: 'commission' })).toMatchObject({ groups: [{ amount: 40 }] })
  expect((await view(id)).bossIncome).toBe(540)
})

it('旧单本月追加工资计入本月首页收入', async () => {
  const id = await order({ orderDate: '2026-09-10', assignees: [{ userId: 'u-xiao', pay: 0 }] })
  const a = (await boss.act('aftersale.create', { orderId: id, req: ['补充需求'], reason: '新增需求', extra: 50 })).body.id
  await sql`update after_sales set start='2026-10-01T00:00:00+08:00' where id=${a}`
  const rows = (await writer.boot()).body.income['u-xiao'].filter((r: { id: string }) => r.id === id)
  expect(incomeSummary(rows, '2026-10')).toEqual({ amount: 50, pending: 0 })
})

it('北京时间月初交稿的查询分组和 Excel 初稿日期一致', async () => {
  const id = await order({ title: '北京时间初稿唯一验收' })
  await sql`update orders set draft_at='2026-09-30T16:30:00Z' where id=${id}`
  expect(await query(await ctx(boss), 'summarize_orders', { query: '北京时间初稿唯一验收', dateField: 'draftAt', from: '2026-10-01', to: '2026-10-01', groupBy: 'month' })).toMatchObject({ total: 1, groups: [{ group: '2026-10', count: 1 }] })
  const out = await boss.exportXlsx([id]), book = new ExcelJS.Workbook()
  await book.xlsx.load(out.buf as never)
  const sheet = book.worksheets[0], headers = sheet.getRow(1).values as string[]
  expect(sheet.getRow(2).getCell(headers.indexOf('初稿日期')).value).toBe('2026-10-01')
})

it('上传开始后失去订单权限或售后责任，完成接口不再挂载文件', async () => {
  const id = await order({ assignees: [{ userId: 'u-xiao', pay: 400 }, { userId: 'writer2', pay: 200 }] })
  const a = (await boss.act('aftersale.create', { orderId: id, req: ['改图'] })).body.id
  const headers = { cookie: writer.cookie, 'content-type': 'application/json' }
  async function start(afterSaleId?: string) {
    const r = await uploadInit(new Request('http://test.local/api/upload', { method: 'POST', headers, body: JSON.stringify({ orderId: id, afterSaleId, name: 'review.txt', size: 1 }) }), { params: Promise.resolve({}) })
    expect(r.status).toBe(200)
    const u = await r.json(), params = { params: Promise.resolve({ id: u.id }) }
    expect((await uploadPut(new Request(`http://test.local/api/upload/${u.id}?offset=0`, { method: 'PUT', headers, body: 'x' }), params)).status).toBe(200)
    return params
  }
  const asUpload = await start(a), ordinary = await start()
  await boss.act('aftersale.update', { orderId: id, asId: a, writerId: 'writer2' })
  const done = (p: { params: Promise<{ id: string }> }) => uploadDone(new Request('http://test.local/api/upload/complete', { method: 'POST', headers, body: '{}' }), p)
  expect((await done(asUpload)).status).toBe(404)
  await boss.act('order.setWriters', { id, writers: [{ userId: 'writer2', pay: 200 }] })
  expect((await done(ordinary)).status).toBe(404)
  expect((await view(id)).attachments).toHaveLength(0)
})

it('并发五次错误密码累计到锁定，正确密码在锁定期也被拒绝', async () => {
  const failures = await Promise.all(Array.from({ length: 5 }, () => loginAs('writer2', 'wrong-pass')))
  expect(failures.every(r => [401, 429].includes(r.status))).toBe(true)
  const [u] = await sql`select locked_until from users where id='writer2'`
  expect(new Date(u.locked_until).getTime()).toBeGreaterThan(Date.now())
  expect((await loginAs('writer2', PW)).status).toBe(429)
})
