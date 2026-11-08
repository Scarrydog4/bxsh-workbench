import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/reports/sales-income/route'
import { GET as writerGet } from '@/app/api/reports/writer-income/route'
import { GET as personalGet } from '@/app/api/reports/personal-income/route'
import type { SalesIncomeReport } from '@/shared/sales-income-report'
import { sql } from '@/server/db'
import { as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, acheng: Client, yang: Client, writer: Client, channelId: string
const orders: Record<string, string> = {}
const params = { params: Promise.resolve({}) }
const read = (client?: Client, query = '') => GET(new Request(`http://test.local/api/reports/sales-income?from=2026-10-09&to=2026-10-15${query}`,
  { headers: client ? { cookie: client.cookie } : {} }), params)
const body = async (query = '') => (await (await read(boss, query)).json()) as SalesIncomeReport
let ledgerBefore: unknown

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-08T06:00:00Z')
  await resetDb(); boss = await as('boss'); acheng = await as('acheng'); yang = await as('xiaoyang'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '销售收入验收渠道', ownerId: 'u-acheng' })).body.id
  for (const [title, ownerId, orderDate, basePrice, salesMode] of [
    ['阿城有效订单', 'u-acheng', '2026-10-10', 100, 'commission'],
    ['小羊有效订单', 'u-yang', '2026-10-11', 200, 'commission'],
    ['已转交订单', 'u-acheng', '2026-10-09', 100, 'commission'],
    ['已删除订单', 'u-acheng', '2026-10-10', 100, 'commission'],
    ['底价订单', 'u-acheng', '2026-10-10', 500, 'cost'],
  ] as const) {
    const result = await boss.act('order.create', { title, ownerId, orderDate, basePrice, salesMode, channelId, dueDate: null, assignees: [{ userId: 'u-xiao', pay: 20 }] })
    expect(result.status).toBe(200); orders[title] = result.body.id
  }
  for (const [id, title, payee, amount, at, status, kind] of [
    ['p1', '阿城有效订单', 'u-acheng', 10, '2026-10-12T02:00:00Z', '已确认', '销售提成'],
    ['p2', '阿城有效订单', 'u-acheng', 5, '2026-10-12T03:00:00Z', '已确认', '销售提成'],
    ['undated', '阿城有效订单', 'u-acheng', 7, null, '已确认', '销售提成'],
    ['draft', '阿城有效订单', 'u-acheng', 100, '2026-10-12T02:00:00Z', '草稿', '销售提成'],
    ['void', '阿城有效订单', 'u-acheng', 200, '2026-10-12T02:00:00Z', '已作废', '销售提成'],
    ['p3', '小羊有效订单', 'u-yang', 30, '2026-10-15T02:00:00Z', '已确认', '销售提成'],
    ['old-owner', '已转交订单', 'u-acheng', 12, '2026-10-12T02:00:00Z', '已确认', '销售提成'],
    ['new-owner', '已转交订单', 'u-yang', 8, '2026-10-15T02:00:00Z', '已确认', '销售提成'],
    ['deleted', '已删除订单', 'u-acheng', 4, '2026-10-12T02:00:00Z', '已确认', '销售提成'],
    ['writer', '阿城有效订单', 'u-xiao', 17, '2026-10-12T02:00:00Z', '已确认', '写手工资'],
  ] as const) await sql`insert into settlements (id, order_id, payee_id, amount, confirmed_at, status, kind)
    values (${id}, ${orders[title]}, ${payee}, ${amount}, ${at}, ${status}, ${kind})`
  await sql`update orders set owner_id='u-yang' where id=${orders['已转交订单']}`
  await sql`update orders set deleted_at='2026-10-13T00:00:00Z' where id=${orders['已删除订单']}`
  ledgerBefore = await sql`select * from settlements order by id`
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })

it('老板可查看销售收入，销售/写手及普通全局收入角色不能越权，个人接口仍锁定本人', async () => {
  expect((await read()).status).toBe(401)
  for (const client of [acheng, yang, writer]) expect((await read(client, '&payeeId=u-acheng')).status).toBe(403)
  const role = await boss.act('role.save', { name: '普通全局收入角色', perms: ['income.all', 'order.view'], rowScope: 'all', fields: { sales: true, writerPay: 'all', commission: 'all', profit: true, channelNo: true } })
  expect(role.status).toBe(200)
  await boss.act('user.update', { id: 'u-yang', patch: { roleId: role.body.id } })
  expect((await read(await as('xiaoyang'))).status).toBe(403)
  await boss.act('user.update', { id: 'u-yang', patch: { roleId: 'r-sales' } })
  expect((await personalGet(new Request('http://test.local/api/reports/personal-income?user=u-acheng', { headers: { cookie: boss.cookie } }), params)).status).toBe(403)
})

it('全部销售汇总与逐人金额相等；只统计提成，剩余按选中接单期关联订单', async () => {
  const all = await body(), a = await body('&payeeId=u-acheng'), y = await body('&payeeId=u-yang')
  expect(all.summary).toMatchObject({ earned: 158, commission: 158, wages: 0, paid: 69, remaining: 98, orderCount: 3 })
  expect(a.summary).toMatchObject({ earned: 40, paid: 31, remaining: 18, orderCount: 1 })
  expect(y.summary).toMatchObject({ earned: 118, paid: 38, remaining: 80, orderCount: 2 })
  expect(all.summary.earned).toBe(a.summary.earned + y.summary.earned)
  expect(all.summary.paid).toBe(a.summary.paid + y.summary.paid)
  expect(all.options.sales.map(person => person.id)).toEqual(['u-acheng', 'u-yang'])
  expect(all.orders.every(order => order.kind === '销售提成')).toBe(true)
  expect(all.orders.some(order => order.id === orders['底价订单'])).toBe(false)
  expect(all.series.find(day => day.key === '2026-10-10')).toMatchObject({ earned: 40, remaining: 18, paid: 0 })
  expect(all.series.find(day => day.key === '2026-10-12')).toMatchObject({ earned: 0, remaining: 0, paid: 31 })
  expect(all.undatedPaid).toBe(7); expect(all.undatedCount).toBe(1)
  expect(await sql`select * from settlements order by id`).toEqual(ledgerBefore)
})

it('转交和删除保留历史实发，逐单标明领取人，不能被全部销售合并到新归属人', async () => {
  const all = await body(), transferred = all.orders.filter(order => order.id === orders['已转交订单'])
  expect(transferred).toHaveLength(2)
  expect(new Set(transferred.map(order => order.key)).size).toBe(2)
  expect(transferred.find(order => order.payeeId === 'u-acheng')).toMatchObject({ payeeName: '阿城', included: false, earned: 0, paid: 12, remaining: 0 })
  expect(transferred.find(order => order.payeeId === 'u-yang')).toMatchObject({ payeeName: '小羊老师', included: true, earned: 28, paid: 8, remaining: 20 })
  expect(all.orders.find(order => order.id === orders['已删除订单'])).toMatchObject({ accessible: false, included: false, paid: 4 })
  expect(all.sales.find(person => person.id === 'u-acheng')).toMatchObject({ paid: 31 })
})

it('日收入按接单日、已结算按实际结算日，周月/不连续日期和渠道筛选复用同一口径', async () => {
  const dayResponse = await GET(new Request('http://test.local/api/reports/sales-income?from=2026-10-12&to=2026-10-12&payeeId=u-acheng', { headers: { cookie: boss.cookie } }), params)
  const day: SalesIncomeReport = await dayResponse.json()
  expect(day.summary).toMatchObject({ earned: 0, paid: 31, remaining: 0 })
  expect(day.hourly!.hours[10].paid).toBe(26)
  expect(day.hourly!.hours[11].paid).toBe(5)
  const week = await body('&granularity=week'), month = await body('&granularity=month')
  expect(week.series.map(row => row.remaining)).toEqual([98, 0])
  expect(month.series[0]).toMatchObject({ earned: 158, remaining: 98, paid: 69 })
  const days: SalesIncomeReport = await (await GET(new Request('http://test.local/api/reports/sales-income?dates=2026-10-10,2026-10-12', { headers: { cookie: boss.cookie } }), params)).json()
  expect(days.summary).toMatchObject({ earned: 40, remaining: 18, paid: 31 })
  expect((await body(`&channelId=${channelId}`)).summary).toEqual((await body()).summary)
  expect((await body('&channelId=missing')).summary).toMatchObject({ earned: 0, paid: 0, remaining: 0 })
})

it('写手收入只向老板开放，与销售共用日期渠道筛选，只合计工资和本人实发', async () => {
  const readWriter = (client: Client, query = '') => writerGet(new Request(`http://test.local/api/reports/writer-income?from=2026-10-09&to=2026-10-15${query}`, { headers: { cookie: client.cookie } }), params)
  // 上一个用例变更过小羊的角色，会撤销旧会话；重新登录验证真实权限拒绝。
  for (const client of [acheng, await as('xiaoyang'), writer]) expect((await readWriter(client)).status).toBe(403)
  const response = await readWriter(boss, '&payeeId=u-xiao')
  expect(response.status).toBe(200)
  const report = await response.json() as SalesIncomeReport
  expect(report.summary).toMatchObject({ earned: 80, wages: 80, commission: 0, paid: 17, remaining: 63, orderCount: 4 })
  expect(report.orders.every(order => order.kind === '写手工资' && order.payeeId === 'u-xiao')).toBe(true)
  expect(report.options.sales.map(person => person.id)).toEqual(['u-xiao'])
  expect(report.peopleByPeriod?.['2026-10-10'].map(person => person.id)).toEqual(['u-xiao'])
  expect(report.series.find(day => day.key === '2026-10-10')).toMatchObject({ wages: 40, paid: 0, remaining: 23 })
  const filtered = await (await readWriter(boss, `&channelId=${channelId}`)).json()
  expect(filtered.summary).toEqual(report.summary)
  expect((await readWriter(boss, '&payeeId=u-acheng')).status).toBe(404)
  expect(await sql`select * from settlements order by id`).toEqual(ledgerBefore)
})

it('拒绝无效人员和日期，空查询保留零收入销售，停用的历史销售仍可查询', async () => {
  expect((await read(boss, '&payeeId=u-xiao')).status).toBe(404)
  expect((await read(boss, '&granularity=year')).status).toBe(400)
  await boss.act('user.update', { id: 'u-acheng', patch: { active: false } })
  const report = await body('&payeeId=u-acheng')
  expect(report.options.sales.some(person => person.id === 'u-acheng')).toBe(true)
  expect(report.summary.paid).toBe(31)
})
