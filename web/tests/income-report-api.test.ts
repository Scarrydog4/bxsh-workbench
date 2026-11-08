import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/reports/income/route'
import { as, closeDb, resetDb, type Client } from './helpers'
import type { IncomeReport } from '@/shared/income-report'
import { businessDate } from '@/shared/format'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client, channel: string
const get = (client?: Client, query = 'from=2026-01-01&to=2026-01-31') => GET(new Request(`http://test.local/api/reports/income?${query}`, { headers: client ? { cookie: client.cookie } : {} }), { params: Promise.resolve({}) })
// 历史约定用例固定在制度切换之前，避免测试运行日期改写预期工资。
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T04:00:00Z')) })
afterEach(() => vi.useRealTimers())
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng')
  channel = (await boss.act('channel.create', { name: '统计测试渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

it('统计专属于老板，即使有 income.all 和全局订单字段的普通角色也无法读取', async () => {
  expect((await get()).status).toBe(401)
  expect((await get(writer)).status).toBe(403); expect((await get(sales)).status).toBe(403)
  const role = await boss.act('role.save', { name: '收入查询员', perms: ['income.all', 'order.view'], rowScope: 'all', fields: { sales: true, writerPay: 'all', commission: 'all', profit: true, channelNo: true } })
  expect(role.status).toBe(200)
  expect((await boss.act('user.update', { id: 'u-yang', patch: { roleId: role.body.id } })).status).toBe(200)
  expect((await get(await as('xiaoyang'))).status).toBe(403)
  expect((await get(boss)).status).toBe(200)
})

it('接口真实加载回收站现金、未定工资和跨期收款，并对非法日期返回400', async () => {
  const create = async (title: string, orderDate: string, pay: number | null = 100) => {
    const response = await boss.act('order.create', { title, orderDate, dueDate: null, channelId: channel, ownerId: 'u-boss', basePrice: 500, assignees: [{ userId: 'u-xiao', pay }] })
    expect(response.status).toBe(200); return response.body.id as string
  }
  const old = await create('旧订单本月收款', '2025-12-01'), deleted = await create('已删除有收款', '2026-01-04'), pending = await create('工资未定', '2026-01-06', null)
  expect((await boss.act('order.addPayment', { id: old, date: '2026-01-09', amount: 150, tag: '定金' })).status).toBe(200)
  expect((await boss.act('order.addPayment', { id: deleted, date: '2026-01-08', amount: 50, tag: '全款' })).status).toBe(200)
  expect((await boss.act('order.addPayment', { id: deleted, date: '2026-01-08', amount: 20, tag: '退款' })).status).toBe(200)
  expect((await boss.act('order.delete', { ids: [deleted] })).status).toBe(200)
  const response = await get(boss), body: IncomeReport = await response.json()
  expect(response.status).toBe(200)
  expect(body.summary).toMatchObject({ orderCount: 1, knownNetIncome: 0, pendingCount: 1, receipts: 200, refunds: 20, netReceipts: 180 })
  expect(body.orders.find(row => row.id === pending)).toMatchObject({ netIncome: null, incomeIncluded: true })
  expect(body.orders.find(row => row.id === old)).toMatchObject({ incomeIncluded: false, periodReceipts: 150 })
  expect(body.orders.find(row => row.id === deleted)?.deletedAt).toBeTruthy()
  for (const query of ['dates=2026-01-01&from=2026-01-01&to=2026-01-31', 'from=2026-02-30&to=2026-03-01', 'granularity=year', 'dates=']) expect((await get(boss, query)).status).toBe(400)
})


it('全公司总览包含销售给老板的净收入，100销售额扣20工资与40提成后为40', async () => {
  const response = await boss.act('order.create', { title: '销售给老板净赚40', orderDate: '2026-02-10', dueDate: null, channelId: channel, ownerId: 'u-acheng', basePrice: 100, assignees: [{ userId: 'u-xiao', pay: 20 }] })
  expect(response.status).toBe(200)
  expect((await boss.act('order.addPayment', { id: response.body.id, date: '2026-02-10', amount: 100, tag: '全款' })).status).toBe(200)
  const query = 'from=2026-02-01&to=2026-02-28'
  const report: IncomeReport = await (await get(boss, query)).json()
  expect(report.selection.ownerId).toBeNull()
  expect(report.summary).toMatchObject({ knownNetIncome: 40, netReceipts: 100, orderCount: 1 })
  expect(report.sales.find(row => row.id === 'u-acheng')).toMatchObject({ knownNetIncome: 40, netReceipts: 100 })
  expect(report.orders.find(row => row.id === response.body.id)).toMatchObject({ sales: 100, externalWriterCost: 20, commissionCost: 40, netIncome: 40 })
  const salesReport: IncomeReport = await (await get(boss, query + '&ownerId=u-acheng')).json()
  expect(salesReport.summary.knownNetIncome).toBe(40)
  const ownReport: IncomeReport = await (await get(boss, query + '&ownerId=u-boss')).json()
  expect(ownReport.summary.knownNetIncome).toBe(0)
  expect(ownReport.orders).toHaveLength(0)
})

it('小时接口从真实业务审计关联录入时刻，不把补录日期塞进当前小时', async () => {
  vi.useRealTimers()
  const day = businessDate(new Date())
  const created = await boss.act('order.create', { title: '小时统计测试', orderDate: day, dueDate: null, channelId: channel, ownerId: 'u-boss', basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 200 }] })
  expect(created.status).toBe(200)
  expect((await boss.act('order.addPayment', { id: created.body.id, date: day, amount: 123, tag: '定金' })).status).toBe(200)
  const response = await get(boss, `from=${day}&to=${day}&granularity=day`), body: IncomeReport = await response.json()
  expect(response.status).toBe(200)
  expect(body.hourly!.hours.reduce((sum, hour) => sum + hour.orderCount, 0)).toBe(1)
  expect(body.hourly!.hours.reduce((sum, hour) => sum + hour.netReceipts, 0)).toBe(123)
  expect(body.hourly!.unknownItems.some(item => item.id === created.body.id)).toBe(false)
  const backfill = '2026-01-10'
  expect((await boss.act('order.addPayment', { id: created.body.id, date: backfill, amount: 44, tag: '定金' })).status).toBe(200)
  const old: IncomeReport = await (await get(boss, `from=${backfill}&to=${backfill}&granularity=day`)).json()
  expect(old.hourly!.unknown.netReceipts).toBe(44)
  expect(old.hourly!.hours.reduce((sum, hour) => sum + hour.netReceipts, 0)).toBe(0)
})
