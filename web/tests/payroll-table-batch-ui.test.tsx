import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IncomeRow } from '@/shared/income'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => unknown)[], prefs: {} as Record<string, any>, session: {} as any, openOrder: vi.fn(), payBatch: vi.fn(), loadIncome: vi.fn() }))
vi.mock('react', async () => ({ ...await vi.importActual('react'), useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => unknown) => { h.effects.push(fn) },
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, loadIncome: h.loadIncome }))
vi.mock('@/client/store-p2', () => ({ payIncomeBatchWithOutcome: h.payBatch }))
vi.mock('@/client/prefs', () => ({ usePref: (key: string, fallback: unknown) => [h.prefs[key] ?? fallback, (value: any) => { h.prefs[key] = typeof value === 'function' ? value(h.prefs[key] ?? fallback) : value }] }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: h.openOrder }) }))
vi.mock('@/client/controls', () => ({ HeaderBar: 'header-bar', PersonFilter: 'person-filter', Segmented: 'segmented' }))
vi.mock('@/client/ui', () => ({ Money: 'money', Person: 'person', ChannelName: 'channel-name', StatusPill: 'status-pill', Avatar: 'avatar', Empty: 'empty', SkeletonRows: 'skeleton', inputCls: '' }))
vi.mock('@/client/table-kit', () => ({ DataTable: 'table', TablePageHeader: 'table-page-header' }))
vi.mock('@/client/SettlementNote', () => ({ SettlementNote: 'settlement-note' }))
vi.mock('@/client/SettlementHistory', () => ({ SettlementHistory: 'settlement-history' }))
vi.mock('@/client/SettlePage', () => ({ SettlementRecords: 'settlement-records' }))
vi.mock('@/client/PayButton', () => ({ PayButton: 'pay-button', CustLight: 'cust-light', defaultPay: (r: any) => r.suggest > 0 ? r.suggest : r.left ?? 0 }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: 'checkbox' }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
import { PayrollPage } from '@/client/PayrollPage'
import { PageLoading } from '@/client/PageLoading'
import { IncomeDateFilter, matchesIncomeDate } from '@/client/IncomeDateFilter'
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const income = (id: string, amount: number, patch: Partial<IncomeRow> = {}): IncomeRow => ({ key: id, id, no: `DD-${id}`, title: `完整订单名称-${id}`, date: '2026-10-20', status: '已交付', kind: '工资', amount, due: amount, paid: 0, left: amount, suggest: amount, pay: '', ...patch })
const page = () => { h.cursor = 0; return PayrollPage() }
const gridNode = (tree: any) => nodes(tree).find(n => n.type?.name === 'PayrollGrid')
const table = (tree: any) => nodes(tree).find(n => n.type === 'table')
const flushEffects = () => { for (const run of h.effects.splice(0)) run() }
function initGrid() { const element = gridNode(page()), props = { ...element.props }; h.slots = []; h.cursor = 0; h.effects = []; return { render: () => { h.cursor = 0; return element.type(props) }, props } }
const checkbox = (grid: any, row: any) => nodes(grid.props.cols.find((col: any) => col.id === 'title').cell(row)).find(n => n.type === 'checkbox')
const footer = (grid: any, rows = grid.props.rows) => { const node = grid.props.footer({ getRowModel: () => ({ rows: rows.map((original: any) => ({ original })) }) }); return node.type(node.props) }
beforeEach(() => { h.slots = []; h.cursor = 0; h.effects = []; h.prefs = {}; h.loadIncome.mockReset().mockResolvedValue(true); h.session = { me: { id: 'boss' }, channel: () => undefined, user: () => undefined, s: { version: 1, batches: [], orders: [], users: [{ id: 'a', name: '阿城', isSales: true }, { id: 'b', name: '小羊老师', isSales: true }], income: { a: [income('a1', 100, { suggest: 80 }), income('a2', 120)], b: [income('b1', 90)] } } } })
afterEach(() => { vi.clearAllMocks() })

it('工资首次请求失败可重试，失败刷新保留旧表', async () => {
  const previous = h.session.s.income
  h.session.s.income = {}; h.loadIncome.mockResolvedValue(false)
  page(); flushEffects()
  await vi.waitFor(() => expect(nodes(page()).find(n => n.type === PageLoading)?.props.error).toBe(true))
  expect(gridNode(page())).toBeUndefined()
  const retry = nodes(page()).find(n => n.type === PageLoading)
  h.effects = []; retry.props.onRetry()
  h.loadIncome.mockImplementation(async () => { h.session.s.income = previous; return true })
  page(); flushEffects()
  await vi.waitFor(() => expect(gridNode(page())).toBeDefined())
  h.effects = []; h.loadIncome.mockResolvedValue(false)
  page(); flushEffects(); await Promise.resolve(); await Promise.resolve()
  expect(gridNode(page()).props.rows).toHaveLength(3)
  expect(nodes(page()).some(n => n.type === PageLoading)).toBe(false)
})

it('可选列读取已授权订单数据，默认隐藏且不改原应发实发；无权字段不加入列设置', () => {
  h.session.s.orders = [{ id: 'a1', orderDate: '2026-10-20', dueDate: '2026-11-01', channelId: 'ch', ownerId: 'b', creatorId: 'boss', assignees: [{ userId: 'a' }], sales: 1400, received: 640, unpaid: 760, extraCostTotal: 400, allocationBase: 1000, bossIncome: 900, payPending: false, note: '实物外包另计', writerPayPlan: 'completed_balance_50_50' }]
  h.session.channel = (id: string) => id === 'ch' ? { id, name: '测试渠道', avatar: '/channel.png' } : undefined
  h.session.user = (id: string) => h.session.s.users.find((u: any) => u.id === id)
  const { render } = initGrid(), grid = table(render()), row = grid.props.rows.find((r: any) => r.id === 'a1')
  const col = (id: string) => grid.props.cols.find((c: any) => c.id === id)
  expect(col('channel').cell(row).props.channel).toMatchObject({ name: '测试渠道', avatar: '/channel.png' })
  expect(col('owner').cell(row).props.user.name).toBe('小羊老师')
  expect(col('extraCostTotal').cell(row).props.value).toBe(400)
  expect(col('bossIncome').cell(row).props.value).toBe(900)
  expect(col('dueDate').sort(row)).toBe('2026-11-01')
  expect(col('note').filterValue?.(row) ?? col('note').sort(row)).toBe('实物外包另计')
  for (const id of ['channel', 'owner', 'dueDate', 'note', 'extraCostTotal', 'paidDate']) expect(grid.props.defaultVisibility[id]).toBe(false)
  expect(row).toMatchObject({ due: 100, paid: 0, left: 100 })
  delete row.order.bossIncome
  expect(table(render()).props.cols.some((c: any) => c.id === 'bossIncome')).toBe(false)
  expect(col('received').cell({ ...row, order: undefined }).props.value).toBeUndefined()
})

it('发放列按本人本单和类型隔离，排除作废草稿，不拿导入时间冒充发放日期', () => {
  const batch = (id: string, patch = {}) => ({ id, payeeId: 'a', kind: '写手工资', status: '已确认', confirmedAt: '2026-10-15T16:30:00Z', createdAt: '2026-10-27T00:00:00Z', lines: [{ orderId: 'a1', amount: 30 }, { orderId: 'a2', amount: 20 }], ...patch })
  h.session.s.batches = [batch('ok'), batch('history', { historical: true, confirmedAt: null }), batch('void', { status: '已作废' }), batch('draft', { status: '草稿' }), batch('other-person', { payeeId: 'b' }), batch('other-kind', { kind: '销售提成' }), batch('other-order', { lines: [{ orderId: 'other', amount: 80 }] })]
  const { render } = initGrid(), grid = table(render()), row = grid.props.rows.find((r: any) => r.id === 'a1')
  expect(row).toMatchObject({ paidRecords: 2, paidDate: '2026-10-16', undatedPayment: true, paid: 0 })
  expect(text(grid.props.cols.find((c: any) => c.id === 'paidDate').cell(row))).toContain('另有日期未记录')
  grid.props.cols.find((c: any) => c.id === 'paidRecords').cell(row).props.onClick({ stopPropagation: vi.fn() })
  expect(nodes(render()).find(n => n.type === 'settlement-history').props).toMatchObject({ orderId: 'a1', payeeId: 'a', kind: '写手工资' })
})

it('复用表格搜索筛选列设置，多选仅同一收款人，底部合计并保留单笔发放', () => {
  const { render } = initGrid(); let grid = table(render())
  expect(grid.props.id).toBe('payroll'); expect(grid.props.toolbar).toBeUndefined()
  expect(grid.props.cols.slice(0, 6).map((c: any) => c.header)).toEqual(['订单名称', '应发', '已发', '剩余', '收款人', '下单日期'])
  const a1 = grid.props.rows.find((r: any) => r.id === 'a1'), a2 = grid.props.rows.find((r: any) => r.id === 'a2'), b1 = grid.props.rows.find((r: any) => r.id === 'b1')
  expect(grid.props.cols.find((c: any) => c.id === 'paid').cell(a1).props.value).toBe(0)
  checkbox(grid, a1).props.onCheckedChange(true); grid = table(render())
  expect(checkbox(grid, b1).props.disabled).toBe(true)
  checkbox(grid, a2).props.onCheckedChange(true); grid = table(render())
  const bottom = footer(grid), action = nodes(bottom).find(n => n.type === 'button' && text(n).includes('合并结算'))
  expect(text(bottom)).toContain('阿城 · 已选 2 单'); expect(text(action)).toContain('¥200'); expect(action.props.disabled).toBe(false)
  action.props.onClick()
  const batch = nodes(render()).find(n => n.type?.name === 'BatchPay')
  expect(batch.props.person.id).toBe('a'); expect(batch.props.lines.map((r: any) => r.id).sort()).toEqual(['a1', 'a2'])
  const single = grid.props.cols.find((c: any) => c.id === 'actions').cell(a1)
  expect(single.type).toBe('pay-button'); expect(single.props.payeeId).toBe('a')
})
it('表格内部筛选只发当前可见选中项，清除筛选不会复活隐藏的选择', () => {
  const { render } = initGrid(); let grid = table(render()); const chosen = grid.props.rows.filter((r: any) => r.payee.id === 'a')
  chosen.forEach((r: any) => checkbox(grid, r).props.onCheckedChange(true)); grid = table(render())
  const filtered = footer(grid, grid.props.rows.filter((r: any) => r.id === 'a2'))
  expect(text(filtered)).toContain('已选 1 单'); expect(text(filtered)).toContain('¥120')
  flushEffects(); grid = table(render())
  expect(checkbox(grid, chosen.find((r: any) => r.id === 'a1')).props.checked).toBe(false)
  const bottom = footer(grid); expect(text(bottom)).toContain('已选 1 单')
  nodes(bottom).find(n => n.type === 'button' && text(n).includes('合并结算')).props.onClick()
  expect(nodes(render()).find(n => n.type?.name === 'BatchPay').props.lines.map((r: any) => r.id)).toEqual(['a2'])
})
it('未定和已发清不能批选，刷新发清的旧勾选移除', () => {
  h.session.s.income.a = [income('known', 100), income('unset', 0, { due: null }), income('paid', 90, { left: 0, paid: 90 })]; h.prefs['payroll-view'] = 'all'
  const { render, props } = initGrid(); let grid = table(render())
  for (const id of ['unset', 'paid']) expect(checkbox(grid, grid.props.rows.find((r: any) => r.id === id)).props.disabled).toBe(true)
  checkbox(grid, grid.props.rows.find((r: any) => r.id === 'known')).props.onCheckedChange(true)
  props.rows = props.rows.map((r: any) => r.id === 'known' ? { ...r, left: 0, paid: 100 } : r); grid = table(render())
  expect(text(footer(grid))).toContain('已选 0 单'); flushEffects()
  expect(checkbox(table(render()), props.rows.find((r: any) => r.id === 'known')).props.checked).toBe(false)
})
it('切换账号人员类型重新开始选择，状态筛选保留表格，发放记录沿用人员', () => {
  const original = gridNode(page()).key; h.prefs['payroll-person'] = 'a'; expect(gridNode(page()).key).not.toBe(original)
  const personKey = gridNode(page()).key; h.prefs['payroll-view'] = 'all'; expect(gridNode(page()).key).toBe(personKey)
  const viewKey = gridNode(page()).key; h.session.me.id = 'other-boss'; expect(gridNode(page()).key).not.toBe(viewKey)
  h.session.s.income.a.push(income('comm', 80, { kind: '提成' })); const writerKey = gridNode(page()).key
  nodes(page()).find(n => n.type === 'segmented' && n.props.label === '收入类型').props.onChange('销售提成'); expect(gridNode(page()).key).not.toBe(writerKey)
  nodes(page()).find(n => n.type === 'segmented' && n.props.label === '发工资视图').props.onChange('records'); expect(nodes(page()).some(n => n.type === 'settlement-records')).toBe(true)
})
it('批次逐单显示全名金额，响应不明后重开沿用原请求号和截图备注', async () => {
  h.prefs['payroll-person'] = 'a'; const { render } = initGrid(); let grid = table(render())
  grid.props.rows.forEach((r: any) => checkbox(grid, r).props.onCheckedChange(true)); grid = table(render())
  nodes(footer(grid)).find(n => n.type === 'button' && text(n).includes('合并结算')).props.onClick()
  const batch = nodes(render()).find(n => n.type?.name === 'BatchPay'), done = vi.fn(), props = { ...batch.props, onDone: done }; h.slots = []
  const form = () => { h.cursor = 0; return batch.type(props) }
  expect(text(form())).toContain('完整订单名称-a1'); expect(text(form())).toContain('完整订单名称-a2')
  expect(nodes(form()).filter(n => n.type === 'input' && n.props['aria-label']?.endsWith(' 金额')).map(n => Number(n.props.value)).sort((a, b) => a - b)).toEqual([80, 120])
  const note = nodes(form()).find(n => n.type === 'settlement-note'); note.props.onNote('一起转账'); note.props.onShots(['test-transfer.png'])
  h.payBatch.mockResolvedValueOnce({ status: 'unknown' }).mockResolvedValueOnce({ status: 'success', result: { id: 'test-batch', amount: 200, count: 2 } })
  nodes(form()).find(n => n.type === 'button' && text(n).includes('确认结算')).props.onClick()
  await vi.waitFor(() => expect(h.payBatch).toHaveBeenCalledTimes(1)); expect(done).not.toHaveBeenCalled()
  h.slots = []; const retry = form()
  expect(nodes(retry).filter(n => n.type === 'input' && n.props['aria-label']?.endsWith(' 金额')).every(n => n.props.disabled)).toBe(true)
  nodes(retry).find(n => n.type === 'button' && text(n) === '重试这笔').props.onClick()
  await vi.waitFor(() => expect(done).toHaveBeenCalledOnce())
  const [first, second] = h.payBatch.mock.calls.map(call => call[0]); expect(second).toBe(first)
  expect(first).toMatchObject({ payeeId: 'a', kind: '写手工资', note: '一起转账', shots: ['test-transfer.png'] })
  expect(first.lines.sort((a: any, b: any) => a.orderId.localeCompare(b.orderId))).toEqual([{ orderId: 'a1', amount: 80 }, { orderId: 'a2', amount: 120 }])
})


it('保留销售人员偏好时自动显示其提成，换人只列该人的类型，所有人仍能切换两种', () => {
  h.session.s.income.a = [income('sales-order', 180, { kind: '提成' })]
  h.session.s.income.b = [income('writer-order', 90)]
  h.prefs['payroll-person'] = 'a'
  let tree = page()
  expect(gridNode(tree).props.rows.map((r: any) => [r.id, r.kind])).toEqual([['sales-order', '销售提成']])
  expect(nodes(tree).some(n => n.type === 'segmented' && n.props.label === '收入类型')).toBe(false)
  nodes(tree).find(n => n.type === 'person-filter').props.onChange('all')
  tree = page()
  const kinds = nodes(tree).find(n => n.type === 'segmented' && n.props.label === '收入类型')
  expect(new Set(kinds.props.items.map((item: any) => item[0]))).toEqual(new Set(['写手工资', '销售提成']))
  kinds.props.onChange('写手工资')
  nodes(page()).find(n => n.type === 'person-filter').props.onChange('a')
  expect(gridNode(page()).props.rows.map((r: any) => r.id)).toEqual(['sales-order'])
  nodes(page()).find(n => n.type === 'person-filter').props.onChange('b')
  expect(gridNode(page()).props.rows.map((r: any) => [r.id, r.kind])).toEqual([['writer-order', '写手工资']])
})


it('日期按下单日而非追加工资日筛选，清除范围恢复全部；日期列可选且仍能排序', () => {
  h.session.s.orders = [{ id: 'extra', orderDate: '2026-09-10' }]
  h.session.s.income.a = [income('extra', 50, { kind: '追加工资', date: '2026-10-20' }), income('a2', 120)]
  let tree = page()
  expect(gridNode(tree).props.rows.find((row: any) => row.id === 'extra').date).toBe('2026-09-10')
  expect(nodes(gridNode(tree).props.dateFilter).find(node => node.type === IncomeDateFilter).props).toMatchObject({ compact: true, label: '下单日期' })
  nodes(gridNode(tree).props.dateFilter).find(node => node.type === IncomeDateFilter).props.onChange({ mode: 'range', from: '2026-09-01', to: '2026-09-30', dates: [] })
  tree = page()
  expect(gridNode(tree).props.rows.map((row: any) => row.id)).toEqual(['extra'])
  expect(text(nodes(tree).find(node => node.type === 'table-page-header').props.summary)).toContain('剩余 ¥50')
  nodes(gridNode(tree).props.dateFilter).find(node => node.type === IncomeDateFilter).props.onAll()
  expect(gridNode(page()).props.rows).toHaveLength(3)
  const { render } = initGrid(), grid = table(render())
  expect(grid.props.toolbarSort).toBe(true)
  expect(grid.props.defaultSorting).toEqual([{ id: 'orderDate', desc: true }])
  expect(grid.props.defaultVisibility?.orderDate).toBe(false)
  expect(grid.props.cols.find((col: any) => col.id === 'orderDate').header).toBe('下单日期')
})

it('已发过同时包含部分和全部发清，查看记录沿用收款人和工资类型', () => {
  h.session.s.income.a = [income('partial', 100, { paid: 30, left: 70 }), income('full', 100, { paid: 100, left: 0 }), income('none', 80)]
  h.prefs['payroll-person'] = 'a'
  nodes(page()).find(n => n.type === 'segmented' && n.props.label === '发放状态').props.onChange('paid')
  expect(gridNode(page()).props.rows.map((row: any) => row.id).sort()).toEqual(['full', 'partial'])
  nodes(page()).find(n => n.type === 'segmented' && n.props.label === '发工资视图').props.onChange('records')
  expect(nodes(page()).find(n => n.type === 'settlement-records').props).toMatchObject({ payeeId: 'a', kind: '写手工资', tableId: 'payroll-records', hidePayeeFilter: true, queryControls: true })
})

it('日期范围包含边界，多选只保留指定天，未知日期不会冒充记账日期', () => {
  const range = { mode: 'range', from: '2026-10-01', to: '2026-10-20', dates: [] } as const
  expect(matchesIncomeDate(null, null)).toBe(true)
  expect(matchesIncomeDate(null, { ...range, dates: [] })).toBe(false)
  for (const day of ['2026-10-01', '2026-10-20']) expect(matchesIncomeDate(day, { ...range, dates: [] })).toBe(true)
  expect(matchesIncomeDate('2026-10-21', { ...range, dates: [] })).toBe(false)
  expect(matchesIncomeDate('2026-10-02', { ...range, mode: 'dates', dates: ['2026-10-01', '2026-10-20'] })).toBe(false)
})

it('一键导出传当前筛选排序行和可见列，不上传金额，并走安卓兼容的文件下载入口', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async () => new Response(new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })))
  vi.stubGlobal('fetch', fetcher)
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }, appendChild = vi.fn()
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild } })
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:payroll-test'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  try {
    const { render } = initGrid(), grid = table(render())
    const original = grid.props.rows.find((row: any) => row.id === 'a2')
    const toolbar = grid.props.toolbarExtras({ getRowModel: () => ({ rows: [{ original }] }), getVisibleLeafColumns: () => [{ id: 'paid' }, { id: 'title' }, { id: 'actions' }] })
    const element = nodes(toolbar).find(node => node.type?.name === 'PayrollExportButton')
    const button = element.type(element.props)
    expect(button.props.disabled).toBe(false)
    await button.props.onClick()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse((fetcher.mock.calls[0] as any)[1].body)).toEqual({ rows: [{ payeeId: 'a', orderId: 'a2', kind: '写手工资' }], columns: ['paid', 'title', 'actions'] })
    expect(anchor.download).toMatch(/^工资明细-\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(anchor.click).toHaveBeenCalledOnce(); expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(create).toHaveBeenCalledOnce()
    vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:payroll-test')
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); create.mockRestore(); revoke.mockRestore() }
})
