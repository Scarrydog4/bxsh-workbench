import { expect, it } from 'vitest'
import { buildIncomeReport, incomeReportSelection, type IncomeReportQuery } from '@/shared/income-report'
import type { Channel, Order, Payment, User } from '@/shared/types'
import type { ChannelReceipt } from '@/shared/channel-receipts'

const admins = new Set(['boss'])
const users = [{ id: 'boss', name: '老板', hue: 120 }, { id: 'sales', name: '销售', hue: 90 }, { id: 'other', name: '另一销售', hue: 30 }] as User[]
const channels = [{ id: 'a', name: '甲渠道', ownerId: 'other' }, { id: 'b', name: '乙渠道', ownerId: 'boss' }] as Channel[]
const order = (id: string, patch: Partial<Order> = {}): Order => ({
  id, no: id, title: id, orderDate: '2026-01-05', dueDate: null, ownerId: 'boss', creatorId: 'boss', channelId: 'a', channelNo: '',
  wechatGroup: '', draftAt: null, type: '', basePrice: 1000, adjustments: [], assignees: [{ userId: 'writer', pay: 200 }], status: '未交付',
  note: '', commissionRate: 0.5, payments: [], attachments: [], afterSales: [], settlements: [], req: {}, nodes: [], receivables: [], reviewFlag: null, deletedAt: null,
  ...patch,
})
const pay = (id: string, date: string, amount: number, tag = '定金'): Payment => ({ id, date, amount, tag, note: '', by: 'other' })
const report = (orders: Order[], query: IncomeReportQuery = { from: '2026-01-01', to: '2026-01-31' }) => buildIncomeReport({ orders, users, channels }, admins, incomeReportSelection(query))
const receipt = (patch: Partial<ChannelReceipt> = {}): ChannelReceipt => ({ id: 'receipt1', no: 'SK1', channelId: 'a', ownerId: 'sales', amount: 1000, date: '2026-01-03', tag: '定金', note: '', createdBy: 'boss', createdAt: '2026-01-03T01:00:00Z', allocated: 0, unallocated: 1000, revision: 1, lines: [], ...patch })

it('无订单的渠道预收按收款日计入现金和分组，未分配明细可解释且不增加净收入', () => {
  const result = buildIncomeReport({ orders: [], users, channels, channelReceipts: [receipt(), receipt({ id: 'void', revoked: { at: '2026-01-04', by: 'boss', reason: '撤销' } }), receipt({ id: 'other-day', date: '2026-01-04' })] }, admins, incomeReportSelection({ dates: ['2026-01-03'] }))
  expect(result.summary).toMatchObject({ orderCount: 0, knownNetIncome: 0, receipts: 1000, netReceipts: 1000, unallocatedReceipts: 1000 })
  expect(result.orders).toEqual([])
  expect(result.channelReceipts).toMatchObject([{ id: 'receipt1', no: 'SK1', date: '2026-01-03', channelName: '甲渠道', ownerName: '销售', unallocated: 1000 }])
  for (const rows of [result.channels, result.sales, result.series]) expect(rows.reduce((sum, row) => sum + row.netReceipts, 0)).toBe(1000)
  expect(result.options.sales.map(row => row.id)).toEqual(['sales'])
  expect(result.series[0].orderIds).toEqual([])
})

it('预收部分分配再全部分配保持原收款日期和现金总额，不重复累计', () => {
  const assigned = order('旧单', { orderDate: '2025-12-01', ownerId: 'sales', payments: [{ ...pay('p1', '2026-01-03', 300.15), receiptId: 'receipt1' }] })
  const r = receipt({ amount: 1000.25, allocated: 300.15, unallocated: 700.1, lines: [{ paymentId: 'p1', orderId: '旧单', no: '旧单', title: '旧单', amount: 300.15 }] })
  const build = () => buildIncomeReport({ orders: [assigned], users, channels, channelReceipts: [r] }, admins, incomeReportSelection({ from: '2026-01-01', to: '2026-01-31' }))
  const partial = build()
  expect(partial.summary).toMatchObject({ receipts: 1000.25, netReceipts: 1000.25, knownNetIncome: 0, unallocatedReceipts: 700.1 })
  expect(partial.orders).toEqual([])
  assigned.payments.push({ ...pay('p2', '2026-01-03', 700.1), receiptId: 'receipt1' }); r.allocated = 1000.25; r.unallocated = 0
  r.lines.push({ paymentId: 'p2', orderId: '旧单', no: '旧单', title: '旧单', amount: 700.1 })
  const full = build()
  expect(full.summary.netReceipts).toBe(1000.25)
  expect(full.channelReceipts).toMatchObject([{ id: 'receipt1', date: '2026-01-03', unallocated: 0 }])
  expect(full.orders).toEqual([])
  expect(full.channelReceipts?.[0].lines).toHaveLength(2)
})

it('渠道转交和分配前后整笔现金固定原销售，净收入仍归订单当前销售，撤销主笔不计入现金', () => {
  const r = receipt({ amount: 800, unallocated: 800 }), assigned = order('转交单', { ownerId: 'other' })
  const run = (ownerId: string) => buildIncomeReport({ orders: [assigned], users, channels, channelReceipts: [r] }, admins,
    incomeReportSelection({ from: '2026-01-01', to: '2026-01-31', ownerId }))
  expect(run('sales').summary.netReceipts).toBe(800)
  assigned.payments.push({ ...pay('allocation', '2026-01-03', 800), receiptId: r.id })
  r.allocated = 800; r.unallocated = 0; r.lines = [{ paymentId: 'allocation', orderId: assigned.id, no: assigned.no, title: assigned.title, amount: 800 }]
  expect(run('sales').summary).toMatchObject({ netReceipts: 800, knownNetIncome: 0, orderCount: 0 })
  expect(run('sales').channelReceipts?.[0].lines).toHaveLength(1)
  expect(run('other').summary).toMatchObject({ netReceipts: 0, knownNetIncome: 400, orderCount: 1 })
  r.revoked = { by: 'boss', at: '2026-01-04', reason: '记错' }
  expect(run('sales').summary.netReceipts).toBe(0)
})

it('未分配预收按收款归属快照筛选，不随渠道当前默认归属变化', () => {
  const selected = incomeReportSelection({ from: '2026-01-01', to: '2026-01-31', channelId: 'a', ownerId: 'sales' })
  const result = buildIncomeReport({ orders: [], users, channels, channelReceipts: [receipt(), receipt({ id: 'other', ownerId: 'other' }), receipt({ id: 'other-channel', channelId: 'b' })] }, admins, selected)
  expect(result.summary.netReceipts).toBe(1000)
  expect(result.channelReceipts?.map(row => row.id)).toEqual(['receipt1'])
  expect(result.sales.map(row => row.id)).toEqual(['sales'])
})

it('老板自写不扣内部工资，也不把内部工资再次加到收入；销售自写内部价仍计算提成', () => {
  const result = report([
    order('老板自营自写', { assignees: [{ userId: 'boss', pay: 500 }] }),
    order('老板自营未填内部价', { assignees: [{ userId: 'boss', pay: null }] }),
    order('销售接单老板写', { ownerId: 'sales', assignees: [{ userId: 'boss', pay: 500 }] }),
  ])
  expect(result.summary).toMatchObject({ knownNetIncome: 2750, pendingCount: 0, orderCount: 3 })
  expect(result.orders.find(row => row.id === '销售接单老板写')).toMatchObject({ netIncome: 750, externalWriterCost: 0, commissionCost: 250 })
  expect(result.orders.find(row => row.id === '老板自营自写')).toMatchObject({ netIncome: 1000, externalWriterCost: 0, commissionCost: 0 })
})

it('未知工资保留 null，不混成零利润；前任销售已经发的提成仍作为成本', () => {
  const result = report([
    order('工资未定', { assignees: [{ userId: 'writer', pay: null }] }),
    order('内部计价未定', { ownerId: 'sales', assignees: [{ userId: 'boss', pay: null }] }),
    order('没有分配', { assignees: [] }),
    order('以前已发提成', { settlements: [{ id: 's', kind: '销售提成', payeeId: 'sales', status: '已确认', amount: 300, note: '', migrated: false, batchId: null, received: false }] }),
  ])
  expect(result.summary).toMatchObject({ knownNetIncome: 500, pendingCount: 3, pendingSales: 3000, orderCount: 4 })
  expect(result.orders.filter(row => row.netIncome === null)).toHaveLength(3)
  expect(result.orders.find(row => row.id === '工资未定')!.externalWriterCost).toBeNull()
  expect(result.orders.find(row => row.id === '以前已发提成')!.commissionCost).toBe(300)
})

it('下单与收款独立按业务日期筛选；退单、回收站的真实现金保留，撤销付款排除', () => {
  const result = report([
    order('旧单本月回款', { orderDate: '2025-12-01', payments: [pay('p1', '2026-01-03', 100), pay('p2', '2026-01-08', 30, '退款'), { ...pay('revoked', '2026-01-08', 500), revoked: { at: '2026-01-09', by: 'boss', reason: '记错' } }] }),
    order('本月单下月收款', { payments: [pay('p3', '2026-02-01', 200)] }),
    order('退单', { status: '退单', payments: [pay('p4', '2026-01-05', 50), pay('p5', '2026-01-06', 20, '退款')] }),
    order('回收站', { deletedAt: '2026-01-09T12:00:00Z', payments: [pay('p6', '2026-01-07', 80)] }),
  ])
  expect(result.summary).toMatchObject({ orderCount: 1, knownNetIncome: 800, receipts: 230, refunds: 50, netReceipts: 180 })
  expect(result.orders.find(row => row.id === '旧单本月回款')).toMatchObject({ incomeIncluded: false, periodReceipts: 70, receiptDates: ['2026-01-03', '2026-01-08'] })
  expect(result.orders.find(row => row.id === '退单')!.incomeIncluded).toBe(false)
  expect(result.orders.find(row => row.id === '回收站')!.deletedAt).toBeTruthy()
  expect(result.series.find(row => row.key === '2026-01-03')).toMatchObject({ orderCount: 0, knownNetIncome: 0, netReceipts: 100, orderIds: ['旧单本月回款'] })
})

it('多选日期去重并排除中间未选天；分组与日期桶两种金额均和总计一致', () => {
  const orders = [
    order('同单跨天', { orderDate: '2026-01-05', payments: [pay('one', '2026-01-05', 0.1), pay('two', '2026-01-07', 0.2), pay('unselected', '2026-01-06', 900)] }),
    order('未选日下单', { orderDate: '2026-01-06', payments: [pay('selected', '2026-01-07', 10)] }),
    order('另一渠道', { channelId: 'b', ownerId: 'sales', orderDate: '2026-01-07' }),
  ]
  const result = report(orders, { dates: ['2026-01-07', '2026-01-05', '2026-01-05'] })
  expect(result.selection.dates).toEqual(['2026-01-05', '2026-01-07'])
  expect(result.series.map(row => row.key)).toEqual(['2026-01-05', '2026-01-07'])
  expect(result.summary).toMatchObject({ orderCount: 2, knownNetIncome: 1200, receipts: 10.3, netReceipts: 10.3 })
  for (const rows of [result.channels, result.sales, result.series]) {
    expect(rows.reduce((sum, row) => sum + row.knownNetIncome, 0)).toBe(result.summary.knownNetIncome)
    expect(Math.round(rows.reduce((sum, row) => sum + row.netReceipts, 0) * 100)).toBe(1030)
  }
  const weekly = report(orders, { dates: ['2026-01-05', '2026-01-07'], granularity: 'week' })
  expect(weekly.series).toHaveLength(1)
  expect(new Set(weekly.series[0].orderIds).size).toBe(weekly.series[0].orderIds.length)
})

it('渠道和销售按订单归属交叉筛选，不按渠道默认负责人或收款经手人', () => {
  const result = report([
    order('符合两项', { ownerId: 'sales', payments: [pay('p', '2026-01-03', 100)] }),
    order('另一渠道', { ownerId: 'sales', channelId: 'b', payments: [pay('p2', '2026-01-03', 999)] }),
    order('另一销售', { ownerId: 'other', payments: [pay('p3', '2026-01-03', 999)] }),
  ], { from: '2026-01-01', to: '2026-01-31', ownerId: 'sales', channelId: 'a' })
  expect(result.orders.map(row => row.id)).toEqual(['符合两项'])
  expect(result.summary).toMatchObject({ knownNetIncome: 400, netReceipts: 100 })
  expect(result.sales.map(row => row.id)).toEqual(['sales'])
  expect(result.options.channels.map(row => row.id).sort()).toEqual(['a', 'b'])
})

it('上海日界、周一至周日跨年、闰月和零流水日期不依赖运行时区', () => {
  expect(incomeReportSelection({}, new Date('2026-01-31T16:01:00Z'))).toMatchObject({ from: '2026-02-01', to: '2026-02-01' })
  const weekly = report([order('跨年单', { orderDate: '2026-01-01' })], { from: '2025-12-29', to: '2026-01-05', granularity: 'week' })
  expect(weekly.series.map(row => [row.start, row.end, row.orderCount])).toEqual([['2025-12-29', '2026-01-04', 1], ['2026-01-05', '2026-01-11', 0]])
  expect(report([], { from: '2024-02-28', to: '2024-03-01' }).series.map(row => row.key)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
  expect(report([], { from: '2024-02-28', to: '2024-03-01', granularity: 'month' }).series[0]).toMatchObject({ start: '2024-02-01', end: '2024-02-29' })
  for (const query of [{ from: '2026-02-29', to: '2026-03-01' }, { dates: ['2026-01-01'], from: '2026-01-01', to: '2026-01-02' }, { dates: [] }, { from: '2026-01-02', to: '2026-01-01' }, { from: '2026-01-01' }]) expect(() => incomeReportSelection(query)).toThrow()
})

it('单日按北京时间小时统计录单和实收，缺时间、补录日期不匹配的款项单列，合计不变', () => {
  const day = '2026-01-05'
  const orders = [order('native', { payments: [pay('known', day, 100), pay('unknown', day, 50), pay('backfill', day, 30, '退款')] }), order('old')]
  const result = buildIncomeReport({ orders, users, channels, recordedTimes: {
    orders: { native: '2026-01-05T01:20:00Z' }, payments: { known: '2026-01-05T02:45:00Z', backfill: '2026-01-06T01:00:00Z' }, channelReceipts: {},
  } }, admins, incomeReportSelection({ from: day, to: day }))
  expect(result.hourly?.hours).toHaveLength(24)
  expect(result.hourly?.hours[9]).toMatchObject({ key: '09:00', knownNetIncome: 800, orderCount: 1 })
  expect(result.hourly?.hours[10]).toMatchObject({ netReceipts: 100, orderCount: 0 })
  expect(result.hourly?.unknown).toMatchObject({ knownNetIncome: 800, netReceipts: 20, refunds: 30, orderCount: 1 })
  expect(result.hourly?.unknownItems.map(item => item.id).sort()).toEqual(['backfill', 'old', 'unknown'])
  const buckets = [...result.hourly!.hours, result.hourly!.unknown]
  for (const key of ['knownNetIncome', 'netReceipts', 'orderCount', 'refunds'] as const) expect(buckets.reduce((sum, row) => sum + row[key], 0)).toBe(result.summary[key])
  expect(result.summary).toMatchObject({ knownNetIncome: 1600, netReceipts: 120 })
})

it('小时统计中渠道主收款计一次，分配子付款不重复；跨上海午夜和渠道筛选正确', () => {
  const day = '2026-01-03', r = receipt({ amount: 300, unallocated: 0, allocated: 300 })
  const result = buildIncomeReport({ orders: [order('assigned', { payments: [{ ...pay('child', day, 300), receiptId: r.id }] })], users, channels, channelReceipts: [r], recordedTimes: {
    orders: {}, payments: { child: '2026-01-02T16:10:00Z' }, channelReceipts: { [r.id]: '2026-01-02T16:10:00Z' },
  } }, admins, incomeReportSelection({ from: day, to: day, ownerId: 'sales' }))
  expect(result.hourly!.hours[0].netReceipts).toBe(300)
  expect(result.hourly!.unknownItems).toEqual([])
  expect(result.hourly!.hours.reduce((sum, row) => sum + row.netReceipts, 0)).toBe(300)
  expect(result.summary.netReceipts).toBe(300)
})

it('销售额按下单日计原售价及调整，工资未定和成本不扣销售额，退单回收站不计',()=>{
  const result=report([
    order('a',{basePrice:1000,extraCosts:[{id:'cost',amount:400}] as Order['extraCosts']}),
    order('b',{basePrice:2000,assignees:[{userId:'writer',pay:null}]}),
    order('return',{basePrice:900,status:'退单'}),
    order('trash',{basePrice:700,deletedAt:'2026-01-06T00:00:00Z'}),
    order('old',{basePrice:600,orderDate:'2025-12-31',payments:[pay('old-pay','2026-01-05',100)]}),
  ])
  expect(result.summary.sales).toBe(3000)
  expect(result.summary.orderCount).toBe(2)
  expect(result.series.reduce((n,r)=>n+r.sales,0)).toBe(3000)
  expect(result.channels.reduce((n,r)=>n+r.sales,0)).toBe(3000)
})
