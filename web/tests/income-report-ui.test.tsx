import { clearReportCache } from '@/client/report-cache'
import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: new Map<number, { deps: any[]; cleanup?: () => void }>(), queue: [] as (() => void)[], session: {} as any, loadIncome: vi.fn() }))
vi.mock('react', async () => ({ ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useId: () => 'income-chart-test',
  useMemo: (factory: () => any) => factory(),
  useEffect: (fn: () => void | (() => void), deps: any[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((v, j) => v !== old.deps[j])) h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, loadIncome: h.loadIncome }))
vi.mock('@/client/prefs', () => ({ usePref: (_key: string, fallback: any) => [fallback, vi.fn()] }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/table-kit', () => ({ DataTable: 'data-table', TableFooter: 'footer', TablePageHeader: 'header' }))
vi.mock('@/client/ui', () => ({ AnimatedNumber: 'animated-number', Avatar: 'avatar', Person: 'person', ChannelAvatar: 'channel-avatar', ChannelName: 'channel-name', Empty: 'empty', Money: 'money', Pill: 'pill', StatusPill: 'status-pill', inputCls: '' }))
vi.mock('@/client/SettlementHistory', () => ({ SettlementHistory: 'history' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/popover', () => ({ Popover: 'popover', PopoverContent: 'popover-content', PopoverTrigger: 'popover-trigger' }))
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: 'checkbox' }))
import { IncomePage } from '@/client/IncomePage'
import { PageLoading } from '@/client/PageLoading'
import { IncomeDateFilter, incomeDateLabel, incomeDateParams, incomePreset, validIncomeDay } from '@/client/IncomeDateFilter'
import { RevenueOverview, IncomeTrend, incomeBucketSelection, incomeReportUrl, reportNetCell } from '@/client/RevenueOverview'
import { PersonalRevenueOverview } from '@/client/PersonalRevenueOverview'
import { IncomeFilterSelect } from '@/client/IncomeFilterSelect'
import { JournalBars, JournalTimeChart, isCurrentChartPeriod } from '@/client/JournalChart'
import { Spark } from '@/client/Spark'
import { daily, Dashboard } from '@/client/Dashboard'
import { ChartSkeleton } from '@/client/PageLoading'
import { Segmented } from '@/client/controls'
import type { IncomeReport, IncomeReportOrder } from '@/shared/income-report'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
// 页签现在由 Segmented 渲染：按文字找到对应项，点击即切到它
const tab = (tree: any, label: string) => { const seg = nodes(tree).find(node => node.type === Segmented && node.props.items.some(([, l]: [string, unknown]) => l === label)); if (!seg) return undefined; const id = seg.props.items.find(([, l]: [string, unknown]) => l === label)[0]; return { props: { onClick: () => seg.props.onChange(id), 'aria-pressed': seg.props.value === id } } }
const button = (tree: any, label: string) => nodes(tree).find(node => node.type === 'button' && text(node) === label) ?? tab(tree, label)
const table = (tree: any) => nodes(tree).find(node => node.type === 'data-table' && node.props.id !== 'income-channel-receipts')
function render(component = RevenueOverview) { h.cursor = 0; h.queue = []; const tree = component(); h.queue.forEach(effect => effect()); return tree }
function trend(props: Parameters<typeof IncomeTrend>[0]) { return JournalTimeChart(IncomeTrend(props).props) }
function cleanup() { h.effects.forEach(effect => effect.cleanup?.()); h.slots = []; h.effects.clear(); h.queue = []; h.cursor = 0 }
afterEach(() => { cleanup(); clearReportCache(); vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const metrics = { sales: 1000, orderCount: 1, knownNetIncome: 800, pendingCount: 1, pendingSales: 500, receipts: 1200, refunds: 200, netReceipts: 1000 }
const originalOrder = { id: 'order1', no: 'DD1', title: '跨期订单', orderDate: '2026-10-08', status: '已交付', deletedAt: null, channelId: 'ch1', channelName: '测试渠道', ownerId: 'sales1', ownerName: '销售', ownerHue: 150, incomeIncluded: true, netIncome: 800, sales: 1000, extraCostTotal: 0, externalWriterCost: 100, commissionCost: 100, receipts: 1200, refunds: 200, periodReceipts: 1000, receiptDates: ['2026-10-08', '2026-10-10'] } satisfies IncomeReportOrder
const fixture = (): IncomeReport => ({ selection: { from: '2026-10-01', to: '2026-10-10', dates: null, granularity: 'day', channelId: null, ownerId: null }, summary: metrics, series: [{ ...metrics, key: '2026-10-10', start: '2026-10-10', end: '2026-10-10', orderIds: ['order1'] }], channels: [{ ...metrics, id: 'ch1', name: '测试渠道' }], sales: [{ ...metrics, id: 'sales1', name: '销售' }], orders: [originalOrder], options: { channels: [{ id: 'ch1', name: '测试渠道' }], sales: [{ id: 'sales1', name: '销售' }] } })
function setup() { h.session = { me: { id: 'boss' }, role: { locked: true }, s: { me: { id: 'boss' }, role: { locked: true }, version: 1, users: [{ id: 'boss', isAdmin: true }, { id: 'sales1', isAdmin: false }] }, views: [{ id: 'order1' }] } }
async function loaded() { render(); await vi.waitFor(() => expect(table(render())).toBeDefined()); return render() }

it('仅有预收款的日期也能钻取金额明细，未分配余额独立展示而不伪装订单', async () => {
  setup()
  const report = fixture(), cash = { ...metrics, orderCount: 0, knownNetIncome: 0, pendingCount: 0, pendingSales: 0, receipts: 500, refunds: 0, netReceipts: 500, unallocatedReceipts: 500 }
  report.summary = cash; report.orders = []
  report.series = [{ ...cash, key: '2026-10-10', start: '2026-10-10', end: '2026-10-10', orderIds: [] }]
  report.channelReceipts = [{ id: 'pre1', no: 'SK20261010001', date: '2026-10-10', channelId: 'ch1', channelName: '测试渠道', ownerId: 'sales1', ownerName: '销售', amount: 500, allocated: 0, unallocated: 500, lines: [] }]
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(report)))
  let tree = await loaded()
  expect(text(tree)).toContain('含未分配预收 ¥500')
  table(tree).props.onRowClick(table(tree).props.rows[0]); render()
  await vi.waitFor(() => expect(table(render())?.props.id).toBe('income-report-orders'))
  tree = render()
  const receipts = nodes(tree).find(node => node.type === 'data-table' && node.props.id === 'income-channel-receipts')
  expect(receipts.props.rows).toHaveLength(1)
  expect(receipts.props.cols.map((col: any) => text(col.cell(receipts.props.rows[0]))).join(' ')).toContain('SK20261010001')
  expect(text(tree)).toContain('0 单 · 1 笔渠道收款')
  expect(table(tree).props.rows).toEqual([])
})

it('今日、本周、本月使用真实业务日期，周/月截至今天，跨年正确', () => {
  expect(incomePreset('today', '2026-01-01')).toMatchObject({ from: '2026-01-01', to: '2026-01-01' })
  expect(incomePreset('week', '2026-01-01')).toMatchObject({ from: '2025-12-29', to: '2026-01-01' })
  expect(incomePreset('month', '2024-02-29')).toMatchObject({ from: '2024-02-01', to: '2024-02-29' })
  expect(validIncomeDay('2026-02-29')).toBe(false)
})
it('离散日期去重排序，不偷偷扩为区间；多选按周钻取只保留原已选日期', () => {
  const selection = { mode: 'dates' as const, from: '2026-10-01', to: '2026-10-15', dates: ['2026-10-10', '2026-10-08', '2026-10-08', '2026-10-15'] }
  const result = incomeBucketSelection(selection, { start: '2026-10-05', end: '2026-10-11' })
  expect(incomeDateParams(result)).toEqual({ dates: '2026-10-08,2026-10-10' })
  const params = new URL(incomeReportUrl(result, 'week', '渠道&1', 'sales1'), 'http://local').searchParams
  expect(params.get('dates')).toBe('2026-10-08,2026-10-10'); expect(params.has('from')).toBe(false); expect(params.get('channelId')).toBe('渠道&1')
  expect(incomeDateLabel({ ...selection, dates: ['2026-10-08', '2026-10-10'] })).toBe('2026-10-08、2026-10-10')
})
it('老板可切换经营、销售和写手收入，员工保留本人收入入口', () => {
  setup(); let tree = render(IncomePage)
  expect(nodes(tree).some(node => node.type === RevenueOverview)).toBe(true)
  expect(button(tree, '工资与提成')).toBeUndefined()
  button(tree, '销售收入').props.onClick(); tree = render(IncomePage)
  expect(nodes(tree).find(node => node.type === PersonalRevenueOverview)?.props.mode).toBe('sales')
  expect(nodes(tree).some(node => node.type === RevenueOverview)).toBe(false)
  button(tree, '写手收入').props.onClick(); tree = render(IncomePage)
  expect(nodes(tree).find(node => node.type === PersonalRevenueOverview)?.props.mode).toBe('writer')
  cleanup(); h.session.role.locked = false; tree = render(IncomePage)
  expect(tree.type.name).toBe('MyIncome')
  expect(button(tree, '销售收入')).toBeUndefined()
  expect(button(tree, '写手收入')).toBeUndefined()
})

it('员工收入订单首次失败显示重试，成功空列表才显示无收入，旧数据刷新失败保留', async () => {
  h.session = { role: { locked: false }, s: { income: {}, version: 1 }, me: { id: 'writer', canWrite: false }, views: [], channel: vi.fn(), user: vi.fn(), can: () => false }
  h.loadIncome.mockResolvedValue(false)
  const mine = () => { const node = IncomePage() as any; return node.type(node.props) }
  let tree = render(mine)
  button(tree, '订单').props.onClick(); tree = render(mine)
  await vi.waitFor(() => expect(nodes(render(mine)).find(n => n.type === PageLoading)?.props.error).toBe(true))
  expect(table(render(mine))).toBeUndefined()
  h.loadIncome.mockImplementation(async () => { h.session.s.income.writer = []; return true })
  nodes(render(mine)).find(n => n.type === PageLoading).props.onRetry(); render(mine)
  await vi.waitFor(() => expect(table(render(mine))).toBeDefined())
  expect(table(render(mine)).props.rows).toEqual([])
  h.loadIncome.mockResolvedValue(false); h.session.s.version++
  render(mine); await Promise.resolve()
  expect(table(render(mine))).toBeDefined()
  expect(nodes(render(mine)).some(n => n.type === PageLoading)).toBe(false)
})
it('只在下单日期命中时展示净收入，现金跨期不带入净收入，未定工资不当零', () => {
  expect(reportNetCell(originalOrder)).toBe('¥800.00')
  expect(reportNetCell({ ...originalOrder, incomeIncluded: false })).toBe('—')
  expect(reportNetCell({ ...originalOrder, netIncome: null })).toBe('工资未定')
})
it('日期钻取重新查询该日，展示新日期范围的实收和下单口径，返回恢复原期', async () => {
  setup()
  const fetcher = vi.fn(async (url: string) => {
    const params = new URL(url, 'http://local').searchParams
    const report = fixture()
    if (params.get('from') === '2026-10-10' && params.get('to') === '2026-10-10') {
      report.summary = { ...metrics, orderCount: 0, knownNetIncome: 0, netReceipts: -200 }
      report.orders = [{ ...originalOrder, incomeIncluded: false, receipts: 0, refunds: 200, periodReceipts: -200, receiptDates: ['2026-10-10'] }]
    }
    return Response.json(report)
  }); vi.stubGlobal('fetch', fetcher)
  render()
  nodes(render()).find(node => node.type === IncomeDateFilter).props.onChange({ mode: 'range', from: '2026-10-01', to: '2026-10-10', dates: [] })
  let tree = await loaded()
  expect(text(tree)).toContain('1 单工资未定，未计入净收入')
  const groupTable = table(tree); groupTable.props.onRowClick(groupTable.props.rows[0]); render()
  await vi.waitFor(() => expect(table(render())?.props.id).toBe('income-report-orders'))
  tree = render(); const details = table(tree)
  expect(fetcher.mock.calls.some(([url]) => url.includes('from=2026-10-10&to=2026-10-10'))).toBe(true)
  expect(details.props.rows[0]).toMatchObject({ incomeIncluded: false, periodReceipts: -200, receiptDates: ['2026-10-10'] })
  expect(text(details.props.cols.find((col: any) => col.id === 'netIncome').cell(details.props.rows[0]))).toBe('—')
  const filter = nodes(tree).find(node => node.type === IncomeDateFilter)
  expect(filter.props.value).toMatchObject({ from: '2026-10-10', to: '2026-10-10' })
  nodes(tree).find(node => node.props['aria-label'] === '返回收入汇总').props.onClick(); render()
  await vi.waitFor(() => expect(table(render())?.props.id).toBe('income-report-date'))
  expect(fetcher.mock.calls.filter(([url]: any[]) => url.includes('from=2026-10-01'))).toHaveLength(1)
})
it('渠道排行完整展示，钻取后主数和明细使用该渠道查询，付款日期单独呈现', async () => {
  setup(); const report = fixture()
  report.channels = Array.from({ length: 8 }, (_, i) => ({ ...metrics, id: `ch${i + 1}`, name: `渠道${i + 1}`, knownNetIncome: 1000 - i }))
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes('channelId=ch1') ? { ...report, summary: { ...metrics, knownNetIncome: 70 } } : report)); vi.stubGlobal('fetch', fetcher)
  let tree = await loaded(); button(tree, '渠道排行').props.onClick(); tree = render()
  expect(table(tree).props.rows).toHaveLength(8)
  table(tree).props.onRowClick(table(tree).props.rows[0]); render()
  await vi.waitFor(() => expect(text(render())).toContain('¥70'))
  tree = render()
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain('channelId=ch1')
  const details = table(tree)
  expect(details.props.rows).toHaveLength(1)
  expect(text(details.props.cols.find((col: any) => col.id === 'receiptDates').cell(originalOrder))).toBe('2026-10-08、2026-10-10')
})
it('渠道钻取后改销售保留渠道，日期钻取后改渠道或粒度保留当日范围', async () => {
  setup()
  const fetcher = vi.fn(async (_url: string) => Response.json(fixture())); vi.stubGlobal('fetch', fetcher)
  const lastParams = () => new URL(fetcher.mock.calls.at(-1)![0], 'http://local').searchParams
  render()
  nodes(render()).find(node => node.type === IncomeDateFilter).props.onChange({ mode: 'range', from: '2026-10-01', to: '2026-10-10', dates: [] })
  let tree = await loaded(); button(tree, '渠道排行').props.onClick(); tree = render()
  table(tree).props.onRowClick(table(tree).props.rows[0]); render()
  await vi.waitFor(() => expect(table(render())?.props.id).toBe('income-report-orders'))
  nodes(render()).find(node => node.props['aria-label'] === '收入销售筛选').props.onChange('sales1'); render()
  await vi.waitFor(() => expect(lastParams().get('ownerId')).toBe('sales1'))
  expect(lastParams().get('channelId')).toBe('ch1')
  await loaded(); tree = render(); button(tree, '按日期').props.onClick(); tree = render()
  table(tree).props.onRowClick(table(tree).props.rows[0]); render()
  await vi.waitFor(() => expect(table(render())?.props.id).toBe('income-report-orders'))
  nodes(render()).find(node => node.props['aria-label'] === '收入渠道筛选').props.onChange('ch2'); render()
  await vi.waitFor(() => expect(lastParams().get('channelId')).toBe('ch2'))
  expect(lastParams().get('from')).toBe('2026-10-10'); expect(lastParams().get('to')).toBe('2026-10-10'); expect(lastParams().get('ownerId')).toBe('sales1')
  await loaded(); tree = render(); table(tree).props.onRowClick(table(tree).props.rows[0]); tree = render()
  expect(tab(tree, '按周')).toBeUndefined()
  expect(lastParams().get('granularity')).toBe('day')
  expect(lastParams().get('from')).toBe('2026-10-10'); expect(lastParams().get('channelId')).toBe('ch2'); expect(lastParams().get('ownerId')).toBe('sales1')
})

it.each(['', '__none__'])('无渠道分组 %s 钻取只查未填渠道，换销售与统计粒度保留筛选', async groupId => {
  setup()
  const noChannelOrder = { ...originalOrder, id: 'cost1', channelId: '', channelName: '未填渠道', title: '底价单', commissionCost: 0 }
  const report = fixture()
  report.orders = [originalOrder, noChannelOrder]
  report.channels.push({ ...metrics, id: groupId, name: '未填渠道' })
  report.options.channels.push({ id: '__none__', name: '未填渠道' })
  const fetcher = vi.fn(async (url: string) => {
    const noChannel = new URL(url, 'http://local').searchParams.get('channelId') === '__none__'
    return Response.json(noChannel ? { ...report, orders: [noChannelOrder] } : report)
  }); vi.stubGlobal('fetch', fetcher)
  const lastParams = () => new URL(fetcher.mock.calls.at(-1)![0], 'http://local').searchParams
  let tree = await loaded(); button(tree, '渠道排行').props.onClick(); tree = render()
  const group = table(tree).props.rows.find((row: any) => row.name === '未填渠道')
  expect(group.orderIds).toEqual(['cost1'])
  table(tree).props.onRowClick(group); render()
  await vi.waitFor(() => expect(table(render())?.props.id).toBe('income-report-orders'))
  expect(lastParams().get('channelId')).toBe('__none__')
  expect(table(render()).props.rows.map((row: any) => row.id)).toEqual(['cost1'])
  expect(text(render())).toContain('未填渠道')
  nodes(render()).find(node => node.props['aria-label'] === '收入销售筛选').props.onChange('sales1'); render()
  await vi.waitFor(() => expect(lastParams().get('ownerId')).toBe('sales1'))
  expect(lastParams().get('channelId')).toBe('__none__')
  tree = await loaded(); button(tree, '按周').props.onClick(); render()
  expect(lastParams().get('granularity')).toBe('week'); expect(lastParams().get('channelId')).toBe('__none__')
})

it('老板总览直接显示销售贡献，按销售明细显示老板所得而非销售提成', async () => {
  setup(); const report = fixture()
  report.summary = { ...metrics, knownNetIncome: 140 }
  report.sales = [{ ...metrics, id: 'boss', name: '老板', knownNetIncome: 100 }, { ...metrics, id: 'sales1', name: '小马', knownNetIncome: 40 }]
  report.orders = [{ ...originalOrder, sales: 100, extraCostTotal: 0, externalWriterCost: 20, commissionCost: 40, netIncome: 40 }]
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes('ownerId=sales1') ? { ...report, sales: [report.sales[1]], summary: { ...metrics, knownNetIncome: 40 } } : report))
  vi.stubGlobal('fetch', fetcher)
  let tree = await loaded()
  expect(text(tree)).toContain('老板净收入'); expect(text(tree)).toContain('自营 ¥100')
  button(tree, '销售贡献 ¥40.00').props.onClick(); tree = render()
  expect(table(tree).props.id).toBe('income-report-sales')
  expect(table(tree).props.cols.find((col: any) => col.id === 'knownNetIncome').header).toBe('给老板赚的净收入')
  const row = table(tree).props.rows.find((row: any) => row.id === 'sales1')
  expect(row.knownNetIncome).toBe(40)
  table(tree).props.onRowClick(row); render()
  await vi.waitFor(() => expect(table(render())?.props.id).toBe('income-report-orders'))
  tree = render(); expect(table(tree).props.rows[0]).toMatchObject({ netIncome: 40, extraCostTotal: 0, externalWriterCost: 20, commissionCost: 40 })
  const before = fetcher.mock.calls.at(-1)![0]
  button(tree, '销售贡献 ¥40.00').props.onClick(); tree = render()
  expect(table(tree).props.id).toBe('income-report-sales')
  expect(nodes(tree).find(node => node.props['aria-label'] === '收入销售筛选').props.value).toBe('sales1')
  expect(fetcher.mock.calls.at(-1)![0]).toBe(before)
})
it('趋势点悬停、键盘聚焦和触屏点击即时显示日期与双指标，Escape可关闭', () => {
  const row = fixture().series[0]
  const component = () => <IncomeTrend rows={[row]} metric="knownNetIncome"/>
  const draw = () => render(() => trend(component().props))
  let tree = draw()
  const point = nodes(tree).find(node => node.props.role === 'button')
  expect(point.props.tabIndex).toBe(0)
  expect(point.props['aria-label']).toContain('2026-10-10，销售额 ¥1,000.00，净收入 ¥800.00，实收 ¥1,000.00')
  expect(nodes(point).find(node => node.type === 'rect').props.width).toBeGreaterThan(20)
  point.props.onMouseEnter(); tree = draw()
  expect(text(nodes(tree).find(node => node.props.role === 'tooltip'))).toContain('2026-10-10销售额¥1,000.00净收入¥800.00实收¥1,000.00')
  expect(nodes(tree).find(node => node.type === 'circle').props.r).toBe(5)
  tree.props.onMouseLeave(); expect(nodes(draw()).some(node => node.props.role === 'tooltip')).toBe(false)
  point.props.onFocus(); expect(nodes(draw()).some(node => node.props.role === 'tooltip')).toBe(true)
  point.props.onBlur(); expect(nodes(draw()).some(node => node.props.role === 'tooltip')).toBe(false)
  point.props.onClick(); tree = draw(); expect(nodes(tree).some(node => node.props.role === 'tooltip')).toBe(true)
  tree.props.onKeyDown({ key: 'Escape' }); expect(nodes(draw()).some(node => node.props.role === 'tooltip')).toBe(false)
})
it('按周提示只列真正选中的日期，不把未选日期夹入统计范围', () => {
  const row = { ...fixture().series[0], key: '2026-10-05', start: '2026-10-05', end: '2026-10-11' }
  const draw = () => render(() => trend({ rows: [row], metric: 'netReceipts', selection: { mode: 'dates', from: '2026-10-08', to: '2026-10-10', dates: ['2026-10-08', '2026-10-10'] } }))
  let tree = draw(); nodes(tree).find(node => node.props.role === 'button').props.onFocus(); tree = draw()
  const tip = text(nodes(tree).find(node => node.props.role === 'tooltip'))
  expect(tip).toContain('2026-10-08、2026-10-10'); expect(tip).not.toContain('2026-10-09')
  expect(tip).toContain('净收入¥800.00实收¥1,000.00')
})

it('收入页默认查询本月并按日统计，凌晨打开不是一片 ¥0', async () => {
  setup()
  const fetcher = vi.fn(async (_url: string) => Response.json(fixture()))
  vi.stubGlobal('fetch', fetcher)
  const tree = await loaded(), filter = nodes(tree).find(node => node.type === IncomeDateFilter)
  expect(filter.props.value).toEqual(incomePreset('month'))
  const params = new URL(fetcher.mock.calls[0][0], 'http://local').searchParams
  expect(params.get('from')).toBe(incomePreset('month').from)
  expect(params.get('to')).toBe(incomePreset('month').to)
  expect(params.get('granularity')).toBe('day')
  expect(button(tree, '按日').props['aria-pressed']).toBe(true)
})

it('整片绘图区跟随鼠标选最近日期，缩放后仍能切换提示与键盘导航', () => {
  const first = { ...fixture().series[0], pendingCount: 0 }
  const last = { ...first, key: '2026-10-11', start: '2026-10-11', end: '2026-10-11', knownNetIncome: 320, netReceipts: 500, orderCount: 2 }
  const draw = () => render(() => trend({ rows: [first, last], metric: 'knownNetIncome' }))
  const move = (x: number) => draw().props.onPointerMove({ clientX: x, currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 600 }) } })
  const tip = () => text(nodes(draw()).find(node => node.props.role === 'tooltip'))
  move(120)
  expect(tip()).toContain('2026-10-10')
  move(680)
  expect(tip()).toContain('2026-10-11')
  expect(tip()).toContain('净收入¥320.00实收¥500.00接单2 单')
  draw().props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() })
  expect(tip()).toContain('2026-10-10')
  draw().props.onKeyDown({ key: 'End', preventDefault: vi.fn() })
  expect(tip()).toContain('2026-10-11')
  draw().props.onMouseLeave()
  expect(tip()).toBe('')
})

it('单日使用柱形并直接标金额，退款负值正常显示，空序列不报错', () => {
  const row = { ...fixture().series[0], netReceipts: -200, refunds: 200 }
  const tree = render(() => trend({ rows: [row], metric: 'netReceipts' }))
  const bar = nodes(tree).find(node => node.type === 'rect' && node.props.width === 64)
  expect(bar.props.height).toBeGreaterThan(0)
  expect(bar.props.className).toBe('text-danger')
  expect(text(tree)).toContain('¥-200')
  expect(text(tree)).toContain('2026-10-10')
  cleanup()
  expect(() => render(() => trend({ rows: [], metric: 'knownNetIncome' }))).not.toThrow()
})

it('日期间隔按真实时间比例绘制，悬停选中实际最近的日期', () => {
  const rows = ['2026-10-01', '2026-10-02', '2026-10-11'].map(day => ({ ...fixture().series[0], key: day, start: day, end: day }))
  const draw = () => render(() => trend({ rows, metric: 'knownNetIncome' }))
  let tree = draw()
  const points = nodes(tree).filter(node => node.type === 'circle')
  expect((points[1].props.cx - points[0].props.cx) / (points[2].props.cx - points[0].props.cx)).toBeCloseTo(.1)
  tree.props.onPointerMove({ clientX: 300, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 680 }) } })
  tree = draw()
  expect(text(nodes(tree).find(node => node.props.role === 'tooltip'))).toContain('2026-10-02')
})

it('科研图保留零基线与等距刻度，给极值留白，不用渐变夸大面积', () => {
  const first = { ...fixture().series[0], knownNetIncome: 630 }
  const last = { ...first, key: '2026-10-11', start: '2026-10-11', end: '2026-10-11', knownNetIncome: -120 }
  const tree = render(() => trend({ rows: [first, last], metric: 'knownNetIncome' }))
  expect(text(tree)).toContain('金额 / 元')
  expect(text(tree)).toContain('日期')
  expect(nodes(tree).some(node => node.type === 'linearGradient')).toBe(false)
  const ticks = nodes(tree).filter(node => node.type === 'text' && node.props.textAnchor === 'end').map(node => Number(text(node).replaceAll(',', ''))).filter(Number.isFinite)
  expect(ticks).toContain(0)
  expect(ticks[0]).toBeLessThan(-120)
  expect(ticks.at(-1)).toBeGreaterThan(630)
  expect(ticks.slice(1).every((value, i) => value - ticks[i] === ticks[1] - ticks[0])).toBe(true)
  const points = nodes(tree).filter(node => node.type === 'circle')
  expect(points[0].props.cy).toBeGreaterThan(30)
  expect(points[1].props.cy).toBeLessThan(172)
  expect(points.every(node => node.props.fill === 'hsl(var(--card))')).toBe(true)
})

it('工作台本月序列补齐到今天，上月同期按相同天数对照', () => {
  const views = [{ orderDate: '2026-10-01', sales: 100 }, { orderDate: '2026-10-03', sales: 80 }, { orderDate: '2026-09-02', sales: 50 }, { orderDate: '2026-09-20', sales: 999 }] as any
  const { cur, last, days } = daily(views, '2026-10-03', v => v.sales ?? 0)
  expect(cur).toEqual([100, 0, 80])
  expect(last).toEqual([0, 50, 0])
  expect(days.at(-1)).toBe('10月3日')
  expect(daily(views, '2026-03-31', () => 1).last).toHaveLength(28)
})

it('今日收入保留实际零值但仅以虚线连接，历史段与已结束的日期选择保持实线', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T16:20:00Z')) // 北京时间 11-04
  const rows = ['2026-11-02', '2026-11-03', '2026-11-04'].map((day, i) => ({ ...metrics, key: day, start: day, end: day, orderIds: [], knownNetIncome: i === 2 ? 0 : 100 }))
  const props = IncomeTrend({ rows, metric: 'knownNetIncome' }).props
  expect(props.rows.map((row: any) => row.value)).toEqual([100, 100, 0])
  expect(props.rows.map((row: any) => row.inProgress)).toEqual([false, false, true])
  const tree = render(() => JournalTimeChart(props))
  const completed = nodes(tree).find(node => node.props['data-chart-line'] === 'completed')
  const current = nodes(tree).find(node => node.props['data-chart-line'] === 'current')
  expect(completed.props.d.match(/ L/g)).toHaveLength(1)
  expect(current.props.d.match(/ L/g)).toHaveLength(1)
  expect(current.props.strokeDasharray).toBe('4 4')
  expect(text(tree)).toContain('截至当前，当前时段尚未结束')
  expect(nodes(tree).find(node => node.props.role === 'button' && node.props['aria-label'].startsWith('2026-11-04')).props['aria-label']).toContain('截至当前')
  expect(isCurrentChartPeriod('2026-11-01', '2026-11-30', { from: '2026-11-01', to: '2026-11-03' })).toBe(false)
  expect(isCurrentChartPeriod('2026-11-01', '2026-11-30', { from: '2026-11-01', to: '2026-11-05', dates: ['2026-11-01', '2026-11-05'] })).toBe(false)
  expect(isCurrentChartPeriod('2026-11-01', '2026-11-30')).toBe(true)
})

it('今天的小时图只将尚未结束的一小时标为截至当前', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T02:20:00Z'))
  const hourly = { day: '2026-11-04', throughHour: 10, hours: Array.from({ length: 24 }, (_, i) => ({ ...metrics, key: `${String(i).padStart(2, '0')}:00`, orderIds: [] })), unknown: { ...metrics, key: 'unknown', orderIds: [] }, unknownItems: [] }
  const props = IncomeTrend({ rows: [], metric: 'knownNetIncome', hourly }).props
  expect(props.rows.filter((row: any) => row.inProgress).map((row: any) => row.key)).toEqual(['10:00'])
  const historical = IncomeTrend({ rows: [], metric: 'knownNetIncome', hourly: { ...hourly, day: '2026-11-03', throughHour: 23 } }).props
  expect(historical.rows.some((row: any) => row.inProgress)).toBe(false)
})

it('工作台累计图只把今日段改为虚线，上月同期与累计金额不变', () => {
  const values = [100, 150, 150], compare = [50, 70, 90]
  const tree = Spark({ values, compare, kind: 'line', inProgress: true, active: null, onActive: vi.fn(), label: '本月累计' })
  const completed = nodes(tree).find(node => node.props['data-chart-line'] === 'completed')
  const current = nodes(tree).find(node => node.props['data-chart-line'] === 'current')
  expect(completed.props.d).toBe('M4,20.66666666666667L120,4')
  expect(current.props.d).toBe('M120,4L236,4')
  expect(current.props.strokeDasharray).toBe('4 4')
  expect(nodes(tree).find(node => node.props.strokeDasharray === '3 3')).toBeDefined()
  expect(tree.props['aria-label']).toContain('截至当前')
  expect(values).toEqual([100, 150, 150]); expect(compare).toEqual([50, 70, 90])
})

it('每月对比等待收入时不展示假零值，销售额和单量仍可切换，失败重试后保留真实收入', () => {
  h.session = { me: { id: 'boss', isAdmin: true }, can: () => true, views: [{ orderDate: '2026-11-04', sales: 800 }], s: { income: {}, version: 1 } }
  h.loadIncome.mockReturnValue(new Promise(() => {}))
  const overview = (Dashboard() as any).type
  const boss = render(overview) as any
  cleanup()
  const bossTree = render(() => boss.type({ ...boss.props, date: '2026-11-04' }))
  const month = nodes(bossTree).find(node => node.type?.name === 'MonthTrend'), retry = vi.fn()
  const props = { ...month.props, onRetryIncome: retry }
  cleanup()
  const draw = () => render(() => month.type(props))
  let tree = draw()
  expect(nodes(tree).some(node => node.type === ChartSkeleton)).toBe(true)
  expect(text(tree)).not.toContain('¥0')
  expect(text(tree)).toContain('销售额 ¥800')
  const choose = (value: string) => nodes(tree).find(node => node.type?.name === 'SectionTitle').props.action.props.onChange(value)
  choose('sales'); tree = draw()
  expect(nodes(tree).filter(node => node.type === 'button')).toHaveLength(6)
  expect(nodes(tree).some(node => node.type === ChartSkeleton)).toBe(false)
  expect(nodes(tree).filter(node => node.type === 'button').every(node => !node.props['aria-label'].includes('净收入'))).toBe(true)
  choose('n'); tree = draw()
  expect(text(tree)).toContain('1单')
  choose('net'); props.incomeError = true; tree = draw()
  const error = nodes(tree).find(node => node.type?.name === 'IncomeLoadError')
  error.props.onRetry(); expect(retry).toHaveBeenCalledOnce()
  expect(text(tree)).toContain('暂不可用')
  props.income = [{ date: '2026-11-04', amount: 120, kind: '订单收入' }]; tree = draw()
  expect(text(tree)).toContain('净收入 ¥120')
  expect(nodes(tree).some(node => node.type?.name === 'IncomeLoadError')).toBe(false)
})

it('工作台收入请求失败把重试状态传给收入卡与月度图，重试成功恢复', async () => {
  h.session = { me: { id: 'boss', isAdmin: true }, can: () => true, views: [], s: { income: {}, version: 1 } }
  h.loadIncome.mockResolvedValue(false)
  const overview = (Dashboard() as any).type
  render(overview)
  await vi.waitFor(() => expect(render(overview).props.incomeError).toBe(true))
  const failed = render(overview) as any
  h.loadIncome.mockResolvedValue(true)
  failed.props.onRetryIncome(); render(overview)
  await vi.waitFor(() => expect(h.loadIncome).toHaveBeenCalledTimes(2))
  expect(render(overview).props.incomeError).toBe(false)
  cleanup()
  const bossTree = render(() => failed.type(failed.props))
  expect(nodes(bossTree).some(node => node.type?.name === 'IncomeLoadError')).toBe(true)
  const month = nodes(bossTree).find(node => node.type?.name === 'MonthTrend')
  expect(month.props.incomeError).toBe(true)
  expect(month.props.onRetryIncome).toBe(failed.props.onRetryIncome)
})

it('折线铺满横向区域且悬停仍命中最近日期，柱形桶的位置与命中不变', () => {
  const onActive = vi.fn(), props = { values: [100, 150, 200], active: 2, onActive, label: '本月累计' }
  const line = Spark({ ...props, kind: 'line', inProgress: true })
  expect(nodes(line).find(node => node.type === 'circle')?.props.cx).toBe(236)
  expect(nodes(line).find(node => node.type === 'line')?.props.x1).toBe(236)
  const point = (x: number) => ({ clientX: x, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 240 }) } })
  line.props.onPointerMove(point(70)); expect(onActive).toHaveBeenLastCalledWith(1)
  line.props.onPointerMove(point(238)); expect(onActive).toHaveBeenLastCalledWith(2)
  line.props.onPointerMove(point(0)); expect(onActive).toHaveBeenLastCalledWith(0)
  const bars = Spark({ ...props, kind: 'bars' })
  expect(nodes(bars).filter(node => node.type === 'rect').map(node => node.props.x)).toEqual([14.399999999999999, 94.4, 174.4])
  bars.props.onPointerMove(point(70)); expect(onActive).toHaveBeenLastCalledWith(0)
  const single = Spark({ ...props, values: [100], kind: 'line', inProgress: true })
  expect(nodes(single).find(node => node.type === 'circle')?.props.cx).toBe(120)
  const empty = Spark({ ...props, values: [], kind: 'line' })
  empty.props.onPointerMove(point(70)); expect(onActive).toHaveBeenLastCalledWith(null)
})

it('横向金额图的退款负数位于零线左侧，零金额不画假条形', () => {
  const plot = render(() => JournalBars({ label: '金额', rows: [
    { key: 'refund', name: '退款', label: '退款', value: -200, valueLabel: '¥-200', readings: [] },
    { key: 'zero', name: '空', label: '空', value: 0, valueLabel: '¥0', readings: [] },
  ] }))
  const bars = nodes(plot).filter(node => node.type === 'span' && node.props.style?.width)
  expect(Number.parseFloat(bars[0].props.style.width)).toBeGreaterThan(0)
  expect(bars[0].props.className).toContain('bg-danger')
  expect(bars[1].props.style.width).toBe('0%')
  expect(Number.parseFloat(bars[1].props.style.left)).toBeGreaterThan(Number.parseFloat(bars[0].props.style.left))
})

it('日收入显示小时轴与完整日期时段，未来小时和无具体时分的金额不混入曲线', () => {
  const hourly = { day: '2026-10-22', throughHour: 10, hours: Array.from({ length: 24 }, (_, i) => ({ ...metrics, key: `${String(i).padStart(2, '0')}:00`, knownNetIncome: i === 9 ? 100 : 0, orderIds: [] })), unknown: { ...metrics, key: 'unknown', knownNetIncome: 300, orderIds: [] }, unknownItems: [] }
  const props = IncomeTrend({ rows: fixture().series, metric: 'knownNetIncome', hourly }).props
  expect(props).toMatchObject({xLabel:'小时', hourly:true,kind:'bar'})
  expect(props.rows).toHaveLength(11)
  expect(props.rows[9]).toMatchObject({ tick: '09:00', value: 100, label: '2026-10-22 09:00 — 09:59' })
  expect(props.rows.reduce((sum: number, row: any) => sum + row.value, 0)).toBe(100)
  let tree = render(() => JournalTimeChart(props))
  nodes(tree).find(node => node.props.role === 'button' && node.props['aria-label'].startsWith('2026-10-22 09:00')).props.onFocus()
  tree = render(() => JournalTimeChart(props))
  expect(text(nodes(tree).find(node => node.props.role === 'tooltip'))).toContain('2026-10-22 09:00 — 09:59')
})

const salesMetrics = { earned: 200, commission: 200, wages: 0, paid: 70, remaining: 130, pendingCount: 0, orderCount: 1 }
const salesFixture = () => ({
  selection: { from: '2026-10-01', to: '2026-10-10', dates: null, granularity: 'day', channelId: null, ownerId: null },
  payeeId: null, summary: salesMetrics,
  series: [{ ...salesMetrics, key: '2026-10-10', start: '2026-10-10', end: '2026-10-10' }],
  channels: [{ ...salesMetrics, id: 'ch1', name: '测试渠道', avatar: '/channel.png' }],
  sales: [{ ...salesMetrics, id: 'sales1', name: '阿城', avatar: '/sales.png' }],
  options: { channels: [{ id: 'ch1', name: '测试渠道', avatar: '/channel.png' }], sales: [{ id: 'sales1', name: '阿城', avatar: '/sales.png' }] },
  orders: [{ key: 'sales1:order1:销售提成', id: 'order1', no: 'DD1', title: 'AJ 测试订单', orderDate: '2026-10-10', status: '未交付',
    channelId: 'ch1', channelName: '测试渠道', accessible: true, kind: '销售提成', included: true, earned: 200, paid: 70, remaining: 130,
    payeeId: 'sales1', payeeName: '阿城', payeeAvatar: '/sales.png' }],
  undatedCount: 0, undatedPaid: 0,
})
const salesOverview = () => PersonalRevenueOverview({ mode: 'sales' })
const incomeFilter = (tree: any, label: string) => nodes(tree).find(node => node.type === IncomeFilterSelect && node.props['aria-label'] === label)
function personalSetup(locked = true) {
  setup()
  h.session.role = { locked, fields: { commission: locked ? 'all' : 'own', writerPay: 'none' } }
  h.session.me = { id: locked ? 'boss' : 'sales1', canWrite: false }
  h.session.can = () => true; h.session.user = () => undefined
}
async function loadedPersonal(component = salesOverview) {
  render(component)
  await vi.waitFor(() => expect(table(render(component))).toBeDefined())
  return render(component)
}

it('老板销售收入默认今日，展示提成、实际已结算与关联订单剩余', async () => {
  personalSetup()
  const fetcher = vi.fn(async (_url: string) => Response.json(salesFixture()))
  vi.stubGlobal('fetch', fetcher)
  const tree = await loadedPersonal()
  const firstUrl = new URL(fetcher.mock.calls[0][0] as string, 'http://local')
  expect(firstUrl.pathname).toBe('/api/reports/sales-income')
  expect(firstUrl.searchParams.get('from')).toBe(incomePreset('today').from)
  expect(firstUrl.searchParams.get('to')).toBe(incomePreset('today').to)
  expect(firstUrl.searchParams.has('payeeId')).toBe(false)
  expect(text(tree)).toContain('应得提成¥200')
  expect(text(tree)).toContain('已结算¥70.00按实际结算日')
  expect(text(tree)).toContain('待结算'); expect(text(tree)).toContain('¥130.00')
  const columns = table(tree).props.cols
  expect(columns.filter((col: any) => table(tree).props.defaultVisibility[col.id] !== false).map((col: any) => col.header)).toEqual(['销售', '应得提成', '已结算', '待结算', '订单数'])
  expect(columns.map((col: any) => col.header)).toEqual(expect.arrayContaining(['人员头像', '销售姓名', '平均单收入', '金额未定项']))
  expect(incomeFilter(tree, '销售收入人员筛选').props.options).toEqual(salesFixture().options.sales)
  const chart = nodes(tree).find(node => node.type === JournalTimeChart)
  expect(chart.props.rows[0].readings).toEqual([{ label: '应得提成', value: '¥200.00', tone: 'primary' }, { label: '已结算', value: '¥70.00' }])
})

it('切销售和渠道后日期钻取、返回仍保留人员与渠道，明细展示订单名及每单金额', async () => {
  personalSetup()
  const fetcher = vi.fn(async (_url: string) => Response.json(salesFixture()))
  vi.stubGlobal('fetch', fetcher)
  let tree = await loadedPersonal()
  nodes(tree).find(node => node.type === IncomeDateFilter).props.onChange({ mode: 'range', from: '2026-10-01', to: '2026-10-10', dates: [] })
  tree = await loadedPersonal()
  incomeFilter(tree, '销售收入人员筛选').props.onChange('sales1')
  tree = await loadedPersonal()
  let query = new URL(fetcher.mock.calls.at(-1)![0], 'http://local').searchParams
  expect(query.get('payeeId')).toBe('sales1'); expect(query.get('from')).toBe('2026-10-01'); expect(query.get('to')).toBe('2026-10-10')
  incomeFilter(tree, '个人收入渠道筛选').props.onChange('ch1')
  tree = await loadedPersonal()
  table(tree).props.onRowClick(table(tree).props.rows[0])
  tree = await loadedPersonal()
  query = new URL(fetcher.mock.calls.at(-1)![0], 'http://local').searchParams
  expect(Object.fromEntries(query)).toMatchObject({ from: '2026-10-10', to: '2026-10-10', payeeId: 'sales1', channelId: 'ch1' })
  const detail = table(tree)
  expect(detail.props.id).toBe('sales-income-orders')
  expect(detail.props.rows[0]).toMatchObject({ title: 'AJ 测试订单', payeeName: '阿城', earned: 200, paid: 70, remaining: 130 })
  expect(detail.props.cols.map((col: any) => col.header)).toContain('本期已结算')
  const renderedAmounts = detail.props.cols.filter((col: any) => ['title', 'earned', 'paid', 'remaining'].includes(col.id)).map((col: any) => text(col.cell(detail.props.rows[0])))
  expect(renderedAmounts).toEqual(['AJ 测试订单', '¥200.00', '¥70.00', '¥130.00'])
  nodes(tree).find(node => node.props['aria-label'] === '返回个人收入汇总').props.onClick()
  tree = await loadedPersonal()
  query = new URL(fetcher.mock.calls.at(-1)![0], 'http://local').searchParams
  expect(table(tree).props.id).toBe('sales-income-date')
  expect(fetcher.mock.calls.some(([url]: any[]) => url.includes('from=2026-10-01') && url.includes('payeeId=sales1') && url.includes('channelId=ch1'))).toBe(true)

  button(tree, '按销售').props.onClick(); tree = render(salesOverview)
  expect(table(tree).props.rows[0].name).toBe('阿城')
  const nameCell = table(tree).props.cols[0].cell(table(tree).props.rows[0])
  expect(nodes(nameCell).find(node => node.type === 'avatar').props.user.avatar).toBe('/sales.png')
})

it('员工总览继续查询本人接口，不出现切换其他销售的入口', async () => {
  personalSetup(false)
  const report = salesFixture()
  const { sales: _sales, payeeId: _payee, ...personal } = report
  const fetcher = vi.fn(async (_url: string) => Response.json({ ...personal, options: { channels: report.options.channels } }))
  vi.stubGlobal('fetch', fetcher)
  const tree = await loadedPersonal(() => PersonalRevenueOverview())
  expect(new URL(fetcher.mock.calls[0][0], 'http://local').pathname).toBe('/api/reports/personal-income')
  expect(incomeFilter(tree, '销售收入人员筛选')).toBeUndefined()
  expect(button(tree, '按销售')).toBeUndefined()
  expect(table(tree).props.id).toBe('personal-income-date')
  expect(text(tree)).toContain('已领取')
})

it('手机点按趋势保留对应金额，纵向滑动与取消手势不误选日期', () => {
  const draw = () => render(() => trend({ rows: fixture().series, metric: 'knownNetIncome' }))
  const touch = (x: number, y: number) => ({ pointerType: 'touch', clientX: x, clientY: y })
  let tree = draw()
  tree.props.onPointerDown(touch(150, 40))
  nodes(tree).find(node => node.props.role === 'button').props.onClick()
  tree = draw()
  tree.props.onMouseLeave()
  nodes(tree).find(node => node.props.role === 'button').props.onBlur()
  expect(text(nodes(draw()).find(node => node.props.role === 'tooltip'))).toContain('净收入¥800')
  tree = draw()
  tree.props.onPointerDown(touch(150, 40))
  tree.props.onPointerMove(touch(152, 80))
  nodes(tree).find(node => node.props.role === 'button').props.onClick()
  expect(nodes(draw()).some(node => node.props.role === 'tooltip')).toBe(false)
  tree = draw()
  tree.props.onPointerDown(touch(150, 40))
  tree.props.onPointerCancel()
  nodes(tree).find(node => node.props.role === 'button').props.onClick()
  expect(nodes(draw()).some(node => node.props.role === 'tooltip')).toBe(false)
})

it('横向图手机点按固定完整金额，切换行同步内容，滚动和Escape能关闭', () => {
  const props = { label: '渠道收入', rows: [
    { key: 'one', name: '渠道一', label: '渠道一', value: 100, valueLabel: '¥100', readings: [{ label: '净收入', value: '¥100' }] },
    { key: 'two', name: '渠道二', label: '渠道二', value: 250, valueLabel: '¥250', readings: [{ label: '净收入', value: '¥250' }] },
  ] }
  const draw = () => render(() => JournalBars(props))
  const rows = (tree: any) => nodes(tree).filter(node => node.type === 'button')
  const openTip = (tree: any) => nodes(tree).find(node => node.props.open === true)
  let tree = draw()
  tree.props.onPointerDown({ pointerType: 'touch', clientX: 100, clientY: 20 })
  rows(tree)[0].props.onClick()
  tree = draw(); rows(tree)[0].props.onMouseLeave(); rows(tree)[0].props.onBlur()
  expect(text(openTip(draw()))).toContain('净收入¥100')
  tree = draw(); tree.props.onPointerDown({ pointerType: 'touch', clientX: 100, clientY: 60 }); rows(tree)[1].props.onClick()
  expect(text(openTip(draw()))).toContain('净收入¥250')
  expect(nodes(draw()).filter(node => node.props.open === true)).toHaveLength(1)
  nodes(draw()).find(node => node.props.onScroll).props.onScroll()
  expect(openTip(draw())).toBeUndefined()
  tree = draw(); rows(tree)[1].props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
  expect(text(openTip(draw()))).toContain('净收入¥250')
  nodes(draw()).find(node => node.props.open === false).props.onOpenChange(false)
  expect(text(openTip(draw()))).toContain('净收入¥250')
  draw().props.onKeyDown({ key: 'Escape' })
  expect(openTip(draw())).toBeUndefined()
})


it('老板写手收入复用销售表格，人员日期筛选、头像列和每单工资可用', async () => {
  personalSetup()
  const report = salesFixture()
  report.summary = { ...salesMetrics, commission: 0, wages: 200 }
  report.orders = report.orders.map(order => ({ ...order, kind: '写手工资', payeeId: 'writer1', payeeName: '森凯', payeeAvatar: '/writer.png' })) as any
  report.options.sales = [{ id: 'writer1', name: '森凯', avatar: '/writer.png' }]
  report.sales = [{ ...report.summary, ...report.options.sales[0] }]
  const fetcher = vi.fn(async (_url: string) => Response.json(report))
  vi.stubGlobal('fetch', fetcher)
  const writerOverview = () => PersonalRevenueOverview({ mode: 'writer' })
  let tree = await loadedPersonal(writerOverview)
  expect(new URL(fetcher.mock.calls[0][0], 'http://local').pathname).toBe('/api/reports/writer-income')
  expect(text(tree)).toContain('应得工资¥200')
  expect(table(tree).props.id).toBe('writer-income-sales')
  expect(incomeFilter(tree, '写手收入人员筛选').props.kind).toBe('writer')
  incomeFilter(tree, '写手收入人员筛选').props.onChange('writer1')
  tree = await loadedPersonal(writerOverview)
  expect(new URL(fetcher.mock.calls.at(-1)![0], 'http://local').searchParams.get('payeeId')).toBe('writer1')
  table(tree).props.onRowClick(table(tree).props.rows[0])
  tree = await loadedPersonal(writerOverview)
  const detail = table(tree)
  expect(detail.props.id).toBe('writer-income-orders')
  expect(detail.props.rows[0]).toMatchObject({ title: 'AJ 测试订单', payeeName: '森凯', earned: 200, paid: 70, remaining: 130 })
  expect(detail.props.cols.map((col: any) => col.header)).toEqual(expect.arrayContaining(['人员头像', '渠道头像', '销售头像', '交付日期', '截止日期', '结算状态', '写手比例']))
  expect(detail.props.defaultVisibility.avatar).toBe(false)
  const avatar = detail.props.cols.find((col: any) => col.id === 'avatar').cell(detail.props.rows[0])
  expect(avatar.props.user.avatar).toBe('/writer.png')
})

it('周柱横轴与提示使用实际选中日期，止于今天；金额纵轴取整数', async () => {
  const { visiblePeriod, incomeAxisMoney }=await import('@/client/income-display')
  const range={from:'2026-11-01',to:'2026-11-30'}
  expect(visiblePeriod(range,{start:'2026-10-26',end:'2026-11-01'},'2026-11-05')?.short).toBe('11-01')
  expect(visiblePeriod(range,{start:'2026-11-02',end:'2026-11-08'},'2026-11-05')?.short).toBe('11-02 — 11-05')
  expect(visiblePeriod(range,{start:'2026-11-09',end:'2026-11-15'},'2026-11-05')).toBeNull()
  expect(incomeAxisMoney(400)).toBe('400')
})

const reportViews = [
  { name: '经营收入', component: RevenueOverview, report: fixture, channel: '收入渠道筛选', person: '收入销售筛选' },
  { name: '写手收入', component: () => PersonalRevenueOverview({mode:'writer'}), report: salesFixture, channel: '个人收入渠道筛选', person: '写手收入人员筛选' },
  { name: '销售收入', component: salesOverview, report: salesFixture, channel: '个人收入渠道筛选', person: '销售收入人员筛选' },
  { name: '本人收入', component: () => PersonalRevenueOverview(), report: salesFixture, channel: '个人收入渠道筛选', person: '' },
]
const september = {mode:'range' as const, from:'2026-09-01', to:'2026-09-30', dates:[]}
const datePicker = (tree: any) => nodes(tree).find(node => node.type === IncomeDateFilter)

it.each(reportViews)('$name 单独选日期时显示日期空态，渠道无匹配时清除渠道仍在所选日期', async view => {
  personalSetup(view.name !== '本人收入')
  const report = view.report()
  report.orders = []
  if ('receipts' in report.summary) Object.assign(report.summary, {receipts:0, refunds:0})
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(report)))
  datePicker(render(view.component)).props.onChange(september)
  let tree = await loadedPersonal(view.component)
  const empty = table(tree).props.empty
  expect(empty.type(empty.props).props.title).toBe('所选日期暂无收入')
  expect(empty.props.clear).toBeUndefined()
  incomeFilter(tree, view.channel).props.onChange('ch1')
  tree = await loadedPersonal(view.component)
  const filtered = table(tree).props.empty
  expect(filtered.type(filtered.props).props.title).toBe('当前筛选下没有数据')
  filtered.props.clear()
  tree = await loadedPersonal(view.component)
  expect(datePicker(tree).props.value).toEqual(september)
  expect(incomeFilter(tree, view.channel).props.value).toBe('')
})

it.each(reportViews)('$name 搜索无结果后只执行表格的清除动作，保留期间、按周和报表筛选', async view => {
  personalSetup(view.name !== '本人收入')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(view.report())))
  datePicker(render(view.component)).props.onChange(september)
  let tree = await loadedPersonal(view.component)
  button(tree, '按周').props.onClick()
  tree = await loadedPersonal(view.component)
  incomeFilter(tree, view.channel).props.onChange('ch1')
  tree = await loadedPersonal(view.component)
  if (view.person) {
    incomeFilter(tree, view.person).props.onChange('sales1')
    tree = await loadedPersonal(view.component)
  }
  const clearSearch = vi.fn()
  table(tree).props.filteredEmpty(clearSearch).props.clear()
  tree = await loadedPersonal(view.component)
  expect(clearSearch).toHaveBeenCalledOnce()
  expect(datePicker(tree).props.value).toEqual(september)
  expect(button(tree, '按周').props['aria-pressed']).toBe(true)
  expect(incomeFilter(tree, view.channel).props.value).toBe('ch1')
  if (view.person) expect(incomeFilter(tree, view.person).props.value).toBe('sales1')
})
