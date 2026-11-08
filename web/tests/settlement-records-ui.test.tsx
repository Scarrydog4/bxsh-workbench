import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SettleBatch } from '@/shared/types'
import type { IncomeRow } from '@/shared/income'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, session: {} as any, batchInput: {} as any, batchDialog: null as any, openOrder: vi.fn() }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'), useMemo: (fn: () => unknown) => fn(), useEffect: () => {},
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, loadIncome: vi.fn() }))
vi.mock('@/client/prefs', () => ({ usePref: (_key: string, fallback: unknown) => [fallback, vi.fn()] }))
vi.mock('@/client/store-p2', () => ({ confirmBatch: vi.fn(), fetchCandidates: vi.fn(), saveBatch: vi.fn(), updateBatchNote: vi.fn(), voidBatch: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: h.openOrder }) }))
vi.mock('@/client/SettlementNote', () => ({ SettlementNote: 'settlement-note', SettlementNoteView: 'note-view' }))
vi.mock('@/client/ui', () => ({ Money: 'money', Person: 'person', Avatar: 'avatar', Combobox: 'combobox', Empty: 'empty', PageHeader: 'page-header', Pill: 'pill', StatusPill: 'status-pill', inputCls: '' }))
vi.mock('@/client/table-kit', () => ({ DataTable: 'table', TableFooter: 'footer', TablePageHeader: 'table-page-header' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: 'checkbox' }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('@/client/RevenueOverview', () => ({ RevenueOverview: 'revenue-overview' }))
import { IncomePage } from '@/client/IncomePage'
import { PersonalRevenueOverview } from '@/client/PersonalRevenueOverview'
import { Segmented } from '@/client/controls'
import { BatchDialog, SettlementRecords, SettlePage, batchState, paymentRecordColumnOrder } from '@/client/SettlePage'
import { SettlementHistory } from '@/client/SettlementHistory'
import { IncomeDateFilter } from '@/client/IncomeDateFilter'
import { filterTableRows, tableFilterFields } from '@/client/table-filters'

const batch = (id: string, patch: Partial<SettleBatch> = {}): SettleBatch => ({ id, no: `JS-${id}`, kind: '写手工资', payeeId: 'writer', period: null, status: '已确认', note: '本次转账备注', shots: ['/api/settle/a/images/proof'], createdBy: 'boss', createdAt: '2026-10-11T03:40:00.000Z', confirmedAt: '2026-10-09T04:00:00.000Z', confirmedBy: 'boss', receivedAt: null, voidedAt: null, total: 125, lines: [{ id: id+'-line', orderId: 'order-a', no: 'DD001', title: '第一单', amount: 125, note: '单笔先发125' }], ...patch })
const footer = (node: any) => node?.props?.footer?.({ getRowModel: () => ({ rows: node.props.rows.map((original: any) => ({ original })) }) })
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children), ...nodes(node.props.toolbarExtras), ...nodes(footer(node))] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) + text(footer(node)) : ''
const table = (tree: any) => nodes(tree).find(n => n.type === 'table')
function records(payeeId?: string, queryControls = false) { h.cursor = 0; return SettlementRecords({ payeeId, queryControls }) }
function detail(b = batch('a'), canManage = false) { h.cursor = 0; return BatchDialog({ batch: b, onClose: vi.fn(), canManage }) }

beforeEach(() => {
  h.batchDialog = null; h.batchInput = {}
  h.session = { s: { batches: [], users: [{ id: 'writer', name: '肖森凯' }, { id: 'boss', name: '老板' }] }, me: { id: 'boss' }, role: { locked: true, fields: {} }, can: () => true, user: (id: string) => h.session.s.users.find((u: any) => u.id === id), views: [{ id: 'order-a' }] }
})
afterEach(() => { h.slots = []; h.cursor = 0; vi.clearAllMocks() })

it('同一天多次发放保持独立批次，同时显示单笔、批量及单笔备注截图', () => {
  const two = batch('two', { total: 275, createdAt: '2026-10-11T05:00:00Z', lines: [...batch('two').lines, { id: 'two-b', orderId: 'order-b', no: 'DD002', title: '第二单', amount: 150, note: '第二单备注' }] })
  h.session.s.batches = [batch('single'), two, batch('draft', { status: '草稿' }), batch('other', { payeeId: 'sales' })]
  const tree = records('writer'), grid = table(tree)
  expect(grid.props.rows.map((b: SettleBatch) => b.id)).toEqual(['two', 'single'])
  expect(grid.props.rows.map((b: SettleBatch) => b.total)).toEqual([275, 125])
  expect(text(tree)).toContain('2 次结算记录')
  grid.props.onRowClick(two)
  const selected = nodes(records('writer')).find(n => n.type === BatchDialog)
  expect(selected.props.batch).toBe(two)
  h.slots = []; const opened = detail(two)
  expect(text(opened)).toContain('肖森凯'); expect(text(opened)).toContain('经办人 老板')
  expect(text(opened)).toContain('发放日期 2026-10-09'); expect(text(opened)).toContain('2026/10/11 13:00')
  expect(text(opened)).toContain('单笔先发125'); expect(text(opened)).toContain('第二单备注')
  expect(nodes(opened).find(n => n.type === 'note-view').props).toMatchObject({ note: '本次转账备注', shots: ['/api/settle/a/images/proof'] })
  expect(nodes(opened).filter(n => n.type === 'money').map(n => n.props.value)).toEqual([125, 150, 275])
})

it.each(['写手工资', '销售提成'] as const)('%s领取记录直接显示订单名，批量明细保持各单金额和共用凭证', (kind) => {
  const one = batch('one', { kind }), two = batch('two', { kind, total: 275, lines: [...batch('two').lines, { id: 'two-b', orderId: 'order-b', no: 'DD002', title: '第二单的完整订单名称', amount: 150, note: '' }] })
  h.session.s.batches = [one, two]
  const grid = table(records('writer')), col = grid.props.cols[0]
  expect(col.header).toBe('订单名称')
  expect(text(col.cell(one))).toBe('第一单')
  expect(text(col.cell(two))).toContain('第一单等 2 单')
  expect(text(col.cell(two))).not.toContain('DD')
  const stopPropagation = vi.fn()
  col.cell(two).props.onClick({ stopPropagation })
  expect(stopPropagation).toHaveBeenCalledOnce()
  expect(nodes(records('writer')).find(n => n.type === BatchDialog).props.batch).toBe(two)
  h.slots = []
  const opened = detail(two)
  expect(text(opened)).toContain('订单名称本次发放')
  expect(text(opened)).toContain('第二单的完整订单名称')
  expect(text(opened)).not.toContain('DD002')
  expect(nodes(opened).filter(n => n.type === 'money').map(n => n.props.value)).toEqual([125, 150, 275])
  expect(nodes(opened).filter(n => n.type === 'note-view')).toHaveLength(1)
})

it('新增订单名列只补一次，保留原有列顺序和用户后续拖动', () => {
  expect(paymentRecordColumnOrder(['at', 'total', 'payee'])).toEqual(['orders', 'at', 'total', 'payee'])
  const moved = ['at', 'total', 'orders', 'payee']
  expect(paymentRecordColumnOrder(moved)).toBe(moved)
  const defaults: string[] = []
  expect(paymentRecordColumnOrder(defaults)).toBe(defaults)
})

it('切换人员后不保留上一人的已打开批次', () => {
  h.session.s.batches = [batch('writer-batch'), batch('sales-batch', { payeeId: 'sales', kind: '销售提成' })]
  table(records('writer')).props.onRowClick(h.session.s.batches[0])
  expect(nodes(records('writer')).find(n => n.type === BatchDialog).props.batch.id).toBe('writer-batch')
  const tree = records('sales')
  expect(table(tree).props.rows.map((b: SettleBatch) => b.id)).toEqual(['sales-batch'])
  expect(nodes(tree).find(n => n.type === BatchDialog).props.batch).toBeUndefined()
})

it('员工只有本人工资记录，金额字段禁看时不返回记录', () => {
  h.session.me = { id: 'writer' }; h.session.role = { locked: false, perms: ['income.view'], fields: { writerPay: 'own', commission: 'none' } }; h.session.can = () => false
  h.session.s.batches = [batch('own'), batch('others', { payeeId: 'sales' }), batch('commission', { kind: '销售提成' })]
  expect(table(records()).props.rows.map((b: SettleBatch) => b.id)).toEqual(['own'])
  expect(nodes(records()).some(n => n.type === 'combobox')).toBe(false)
  expect(table(records('sales')).props.rows).toEqual([])
  h.session.role.fields.writerPay = 'none'
  expect(table(records('writer')).props.rows).toEqual([])
})

it('作废批次可查看但累计金额只算已确认，未知历史日期不冒充创建日', () => {
  h.session.s.batches = [batch('paid'), batch('void', { status: '已作废', total: 80 }), batch('legacy', { confirmedAt: null, total: 20 })]
  const tree = records('writer')
  expect(nodes(tree).find(n => n.type === 'money').props.value).toBe(145)
  const col = table(tree).props.cols.find((c: any) => c.id === 'at')
  expect(text(col.cell(h.session.s.batches[2]))).toBe('原日期未记录')
  expect(text(detail(h.session.s.batches[2]))).toContain('发放日期 原日期未记录')
})

it('发放日期按北京时间筛选，金额和条数同步，全部日期保留未知历史日期', () => {
  h.session.s.batches = [
    batch('older', { confirmedAt: '2026-10-08T15:59:00Z', total: 10 }),
    batch('selected', { confirmedAt: '2026-10-08T16:00:00Z', total: 25 }),
    batch('later', { confirmedAt: '2026-10-10T04:00:00Z', total: 30 }),
    batch('legacy', { confirmedAt: null, createdAt: '2026-10-12T04:00:00Z', total: 15 }),
  ]
  const plain = records('writer')
  expect(nodes(plain).some(n => n.type === IncomeDateFilter)).toBe(false)
  expect(table(plain).props.toolbarSort).toBe(false)
  expect(table(plain).props.defaultSorting).toBeUndefined()
  let tree = records('writer', true)
  const dateFilter = () => nodes(tree).find(n => n.type === IncomeDateFilter)
  expect(dateFilter().props.all).toBe(true)
  expect(dateFilter().props).toMatchObject({ compact: true, label: '结算日期' })
  expect(table(tree).props).toMatchObject({ toolbarSort: true, defaultSorting: [{ id: 'at', desc: true }] })
  expect(table(tree).props.rows.map((b: SettleBatch) => b.id)).toEqual(['later', 'selected', 'older', 'legacy'])
  dateFilter().props.onChange({ mode: 'range', from: '2026-10-09', to: '2026-10-09', dates: [] })
  tree = records('writer', true)
  expect(table(tree).props.rows.map((b: SettleBatch) => b.id)).toEqual(['selected'])
  expect(text(footer(table(tree)))).toContain('已发合计')
  expect(text(tree)).toContain('1 次结算记录')
  expect(nodes(tree).find(n => n.type === 'money').props.value).toBe(25)
  dateFilter().props.onAll()
  tree = records('writer', true)
  expect(table(tree).props.rows).toHaveLength(4)
  expect(nodes(tree).find(n => n.type === 'money').props.value).toBe(80)
})

it('老板已发页沿用选中收款人并隔离列偏好，隐藏重复选择不扩大员工权限', () => {
  h.session.s.batches = [batch('writer-paid'), batch('boss-paid', { payeeId: 'boss' })]
  const show = (payeeId?: string) => { h.cursor = 0; return SettlementRecords({ kind: '写手工资', payeeId, tableId: 'payroll-records', hidePayeeFilter: true, queryControls: true }) }
  expect(table(show()).props.rows).toHaveLength(2)
  const tree = show('writer')
  expect(table(tree).props.id).toBe('payroll-records')
  expect(table(tree).props.rows.map((b: SettleBatch) => b.id)).toEqual(['writer-paid'])
  expect(nodes(tree).some(n => n.type === 'combobox')).toBe(false)
  h.session.me = { id: 'writer' }; h.session.role = { locked: false, perms: ['income.view'], fields: { writerPay: 'own', commission: 'none' } }; h.session.can = () => false
  expect(table(show()).props.rows.map((b: SettleBatch) => b.id)).toEqual(['writer-paid'])
  expect(table(show('boss')).props.rows).toEqual([])
})

it('订单发放历史按实际日期倒序显示完整年月日，不把后补录入时间当发放时间', () => {
  h.session.s.batches = [
    batch('earlier', { confirmedAt: '2026-10-08T04:00:00Z', createdAt: '2026-10-15T04:00:00Z' }),
    batch('legacy', { confirmedAt: null, createdAt: '2026-10-20T04:00:00Z' }),
    batch('latest', { confirmedAt: '2026-10-10T04:00:00Z' }),
    batch('other-payee', { payeeId: 'sales' }),
  ]
  h.cursor = 0
  const tree = SettlementHistory({ orderId: 'order-a', kind: '写手工资', title: '第一单', payeeId: 'writer', onClose: vi.fn() })
  const sections = nodes(tree).filter(n => n.type === 'section')
  expect(sections.map(n => nodes(n).find(x => x.type === 'strong').props.children)).toEqual(['JS-latest', 'JS-earlier', 'JS-legacy'])
  expect(text(sections[0])).toContain('发放于 2026-10-10')
  expect(text(sections[1])).toContain('发放于 2026-10-08')
  expect(text(sections[2])).toContain('原发放日期未记录')
  expect(text(tree)).not.toContain('2026-10-20')
  h.session.me = { id: 'writer' }; h.session.role = { locked: false, perms: ['income.view'], fields: { writerPay: 'own', commission: 'none' } }; h.session.can = () => false
  h.cursor = 0
  const hidden = SettlementHistory({ orderId: 'order-a', kind: '写手工资', title: '第一单', payeeId: 'sales', onClose: vi.fn() })
  expect(nodes(hidden).filter(n => n.type === 'section')).toHaveLength(0)
})

it('明细保留无当前订单权限的历史行，禁止跳转，员工没有编辑作废按钮', () => {
  h.session.views = []
  const tree = detail()
  const order = nodes(tree).find(n => n.type === 'button' && text(n).includes('第一单'))
  expect(order.props.disabled).toBe(true)
  expect(text(tree)).not.toContain('编辑备注'); expect(text(tree)).not.toContain('作废')
})

it('历史逐单记录独立计数，老板只能查看，不能把迁入日当发放日', () => {
  const legacy = batch('legacy', { historical: true, confirmedAt: null, createdBy: '', confirmedBy: null, note: '飞书迁移', total: 33 })
  h.session.s.batches = [batch('paid'), legacy]
  const tree = records('writer')
  expect(text(tree)).toContain('1 次结算 · 1 条历史明细')
  expect(nodes(tree).find(n => n.type === 'money').props.value).toBe(158)
  h.slots = []
  const opened = detail(legacy, true)
  expect(text(opened)).toContain('历史发放明细')
  expect(text(opened)).toContain('发放日期 原日期未记录')
  expect(text(opened)).not.toContain('编辑备注')
  expect(text(opened)).not.toContain('作废')
  expect(nodes(opened).find(n => n.type === 'note-view').props.note).toBe('飞书迁移')
})

it('我的收入可切到发放记录，默认绑定当前员工而非全部人员', () => {
  h.session.me = { id: 'writer' }; h.session.role = { locked: false, fields: { writerPay: 'own', commission: 'none' } }; h.session.can = () => false
  h.session.s.income = { writer: [] }; h.session.s.users[0].canWrite = true
  const entry = IncomePage() as any
  h.slots = []
  const panel = () => { h.cursor = 0; return entry.type(entry.props) }
  const tree = panel()
  expect(nodes(tree).some(n => n.type === PersonalRevenueOverview)).toBe(true)
  expect(nodes(tree).find(n => n.type === Segmented && n.props.label === '收入视图').props.items).toEqual([['overview', '收入总览'], ['orders', '订单'], ['records', '领取记录']])
  nodes(tree).find(n => n.type === Segmented && n.props.label === '收入视图').props.onChange('records')
  const recordView = nodes(panel()).find(n => n.type === SettlementRecords)
  expect(recordView.props.payeeId).toBe('writer')
})

it.each(['提成', '工资'] as const)('员工%s显示已发金额，0不隐藏，点击只查看本人本单的记录', (kind) => {
  h.session.me = { id: 'sales' }; h.session.role = { locked: false, fields: kind === '提成' ? { writerPay: 'none', commission: 'own' } : { writerPay: 'own', commission: 'none' } }; h.session.can = () => false
  h.session.s.users = [{ id: 'sales', name: kind === '提成' ? '销售' : '写手', isSales: kind === '提成', canWrite: kind === '工资' }]
  const rows: IncomeRow[] = [
    { key: 'new:comm', id: 'new', no: 'DD2', title: '新订单', date: '2026-10-16', status: '未交付', kind, amount: 200, pay: '—', due: 200, paid: 0, left: 200, over: 0, custStage: 'deposit' },
    { key: 'old:comm', id: 'old', no: 'DD1', title: '旧订单', date: '2026-10-15', status: '已交付', kind, amount: 350, pay: '—', due: 350, paid: 350, left: 0, over: 0, custStage: 'paidUp' },
  ]
  h.session.s.income = { sales: rows }
  const entry = IncomePage() as any
  h.slots = []
  const panel = () => { h.cursor = 0; return entry.type(entry.props) }
  nodes(panel()).find(n => n.type === Segmented && n.props.label === '收入视图').props.onChange('orders')
  const tree = panel(), grid = table(tree)
  expect(grid.props.cols.filter((c: any) => grid.props.defaultVisibility[c.id] !== false).map((c: any) => c.header)).toEqual(['订单', '收入', '已发', '剩余', '收款', '订单状态', '归属销售'])
  expect(grid.props.cols[0].hideable).toBe(false)
  expect(grid.props.cols.find((c: any) => c.id === 'due').filterValue(grid.props.rows[0])).toBe(200)
  expect(grid.props.rows.map((r: any) => [r.due, r.left])).toEqual([[200, 200], [350, 0]])
  expect(text(tree)).not.toMatch(/新制度|原约定|%/)
  const paid = grid.props.cols.find((c: any) => c.id === 'paid')
  const zero = paid.cell(grid.props.rows[0])
  expect(zero.type).toBe('money'); expect(zero.props.value).toBe(0)
  const shown = paid.cell(grid.props.rows[1]), stopPropagation = vi.fn()
  expect(shown.props['aria-label']).toBe('查看旧订单的发放记录')
  expect(nodes(shown).find(n => n.type === 'money').props.value).toBe(350)
  shown.props.onClick({ stopPropagation })
  expect(stopPropagation).toHaveBeenCalledOnce(); expect(h.openOrder).not.toHaveBeenCalled()
  const history = nodes(panel()).find(n => n.type === SettlementHistory)
  expect(history.props).toMatchObject({ orderId: 'old', payeeId: 'sales', kind: kind === '提成' ? '销售提成' : '写手工资', title: '旧订单' })
  history.props.onClose()
  expect(nodes(panel()).find(n => n.type === SettlementHistory)).toBeUndefined()
})

it('旧结算写手选择排除老板，已停用但有历史订单的写手仍可结算', () => {
  h.session.adminIds = new Set(['boss'])
  h.session.s.users = [{ id: 'boss', name: '老板', canWrite: true }, { id: 'writer', name: '写手', canWrite: true }, { id: 'former', name: '历史写手', canWrite: false, active: false }]
  h.session.s.orders = [{ assignees: [{ userId: 'boss' }, { userId: 'former' }] }]
  h.cursor = 0; let tree = SettlePage()
  nodes(tree).find(n => n.type === 'button' && text(n).includes('新建结算单')).props.onClick()
  h.cursor = 0; tree = SettlePage()
  const editor = nodes(tree).find(n => n.type?.name === 'BatchEditor')
  h.slots = []; h.cursor = 0
  const form = editor.type(editor.props)
  expect(nodes(form).find(n => n.type === 'combobox').props.options.map((p: any) => p.value)).toEqual(['writer', 'former'])
})

it('发放记录统一显示已发放且该状态筛选不会混入作废批次', () => {
  h.session.s.batches = [batch('paid'), batch('void', { status: '已作废' })]
  expect(batchState(batch('paid')).label).toBe('已发放')
  const grid = table(records('writer'))
  expect(grid.props.preferredFilterFields).toContain('state')
  expect(nodes(grid.props.toolbarExtras).some(n => n.type === 'select' || n.type === 'combobox' || n.type === 'button')).toBe(false)
  const selected = filterTableRows(grid.props.rows, tableFilterFields(grid.props.cols, grid.props.rows), '', [{ field: 'state', operator: 'equals', value: '已发放' }])
  expect(selected.map((row: any) => row.id)).toEqual(['paid'])
  const summary = grid.props.footer({ getRowModel: () => ({ rows: selected.map(original => ({ original })) }) })
  expect(text(summary)).toContain('1 次结算记录')
  expect(nodes(summary).filter(n => n.type === 'money').map(n => n.props.value)).toEqual([125])
})


it('收入可选列只补当前有权限的订单信息，不恢复历史订单访问或混入客户金额', () => {
  h.session.me = { id: 'writer' }; h.session.role = { locked: false, fields: { writerPay: 'own', commission: 'none' } }
  h.session.channel = (id: string) => ({ id, name: '本人渠道' })
  h.session.views = [{ id: 'current', channelId: 'mine', orderDate: '2026-10-20', dueDate: '2026-11-01', custStage: 'paidUp', sales: 99999 }]
  h.session.s.income = { writer: [
    { key: 'current', id: 'current', no: '2', title: '当前订单', date: '2026-10-20', status: '已交付', kind: '工资', amount: 100, due: 100, paid: 25, left: 75 },
    { key: 'past', id: 'past', no: '1', title: '历史订单', date: '2026-10-01', status: '已交付', kind: '工资', amount: 80, due: 80, paid: 80, left: 0 },
  ] }
  const entry = IncomePage() as any
  const panel = () => { h.cursor = 0; return entry.type(entry.props) }
  nodes(panel()).find(n => n.type === Segmented && n.props.label === '收入视图').props.onChange('orders')
  const grid = table(panel()), [current, past] = grid.props.rows
  expect(current.due).toBe(100); expect(current.paid).toBe(25); expect(current.custStage).toBe('paidUp')
  expect(current.sales).toBeUndefined()
  expect(past.channel).toBeUndefined(); expect(past.orderDate).toBe(''); expect(past.paid).toBe(80)
  expect(grid.props.cols.find((c: any) => c.id === 'channel').sort(past)).toBe('')
  grid.props.onRowClick(past); expect(h.openOrder).not.toHaveBeenCalled()
  grid.props.onRowClick(current); expect(h.openOrder).toHaveBeenCalledWith('current')
})
