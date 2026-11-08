import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TableFilter, TableFilterField } from '@/client/table-filters'

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0 }))
vi.mock('react', async () => ({ ...await vi.importActual('react'), useState: (initial: any) => {
  const index = hooks.cursor++
  if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial
  return [hooks.slots[index], (next: any) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next }]
} }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/popover', () => ({ Popover: 'popover', PopoverContent: 'popover-content', PopoverTrigger: 'popover-trigger' }))
vi.mock('@/client/ColumnSettings', () => ({ ColumnSettings: 'column-settings' }))
vi.mock('@/client/SelectField', () => ({ SelectField: 'select' }))
import { TableToolbar, tableDatePreset } from '@/client/TableToolbar'
import { TableFilterPopover } from '@/client/TableFilterPopover'

const nodes = (node: any): any[] => {
  if (node?.type === TableFilterPopover) { hooks.cursor = 0; return [node, ...nodes(TableFilterPopover(node.props))] }
  return Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
}
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const fields: TableFilterField<any>[] = [
  { id: 'title', label: '订单名称', numeric: false, date: false, value: r => r.title },
  { id: 'status', label: '订单状态', numeric: false, date: false, options: ['未交付', '已交付'], value: r => r.status },
  { id: 'dueDate', label: '截止日期', numeric: false, date: true, value: r => r.dueDate },
  { id: 'amount', label: '金额', numeric: true, date: false, value: r => r.amount },
]
function harness(initialFilters: TableFilter[] = [], initialQuery = '', options: { preferredFilterFields?: string[]; searchPlaceholder?: string } = {}) {
  let filters = initialFilters, query = initialQuery
  const table: any = { getColumn: () => ({ getIsVisible: () => true }), getRowModel: () => ({ rows: [{}, {}] }) }
  const render = () => { hooks.cursor = 0; return TableToolbar({ table, fields, query, onQueryChange: v => { query = v }, filters, onFiltersChange: v => { filters = v }, defaultVisibility: {}, totalRows: 9, ...options }) }
  const labelled = (label: string) => nodes(render()).find(node => node.props['aria-label'] === label)
  const button = (label: string) => nodes(render()).find(node => node.type === 'button' && text(node) === label)
  return { render, labelled, button, filters: () => filters, query: () => query }
}
beforeEach(() => { hooks.slots = []; hooks.cursor = 0 })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('空筛选直接选择字段，搜索字段不改变数据筛选；状态可以直接点选值', () => {
  const h = harness()
  expect(h.labelled('添加订单状态筛选')).toBeDefined()
  expect(h.filters()).toEqual([])
  h.labelled('查找筛选字段').props.onChange({ target: { value: '状态' } })
  expect(h.labelled('添加订单名称筛选')).toBeUndefined()
  expect(h.filters()).toEqual([])
  h.labelled('添加订单状态筛选').props.onClick()
  expect(h.filters()).toEqual([{ field: 'status', operator: 'equals', value: '' }])
  h.button('已交付').props.onClick()
  expect(h.filters()[0].value).toBe('已交付')
  expect(h.button('已交付').props['aria-pressed']).toBe(true)
  expect(h.labelled('移除订单状态筛选')).toBeDefined()
  h.button('已交付').props.onClick()
  expect(h.filters()[0].value).toBe('')
})

it('逐条删除保留其他条件与搜索；清空全部同时清理关键词和条件', () => {
  const h = harness([{ field: 'status', operator: 'equals', value: '已交付' }, { field: 'amount', operator: 'gte', value: '100' }], 'AJ')
  h.labelled('移除订单状态筛选').props.onClick()
  expect(h.filters()).toEqual([{ field: 'amount', operator: 'gte', value: '100' }])
  expect(h.query()).toBe('AJ')
  expect(text(h.render())).toContain('2 / 9 条')
  h.labelled('清除表格筛选').props.onClick()
  expect(h.filters()).toEqual([])
  expect(h.query()).toBe('')
})

it('添加条件先选字段，不自动塞入首列；金额与文本仍支持高级条件', () => {
  const h = harness([{ field: 'status', operator: 'equals', value: '未交付' }])
  h.button('添加条件').props.onClick()
  expect(h.filters()).toHaveLength(1)
  expect(h.labelled('添加订单状态筛选')).toBeUndefined()
  h.labelled('添加金额筛选').props.onClick()
  expect(h.filters()[1]).toEqual({ field: 'amount', operator: 'between', value: '' })
  h.labelled('筛选值 2').props.onChange({ target: { value: '20' } })
  h.labelled('筛选上限 2').props.onChange({ target: { value: '50' } })
  expect(h.filters()[1]).toEqual({ field: 'amount', operator: 'between', value: '20', upper: '50' })
  h.labelled('筛选条件 2').props.onChange({ target: { value: 'empty' } })
  expect(h.labelled('筛选值 2')).toBeUndefined()
  h.labelled('筛选字段 2').props.onChange({ target: { value: 'title' } })
  expect(h.filters()[1]).toEqual({ field: 'title', operator: 'contains', value: '', upper: '' })
})

it('日期快捷用北京时间且包含完整自然周/月，点击替换范围而不新增重复条件', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T16:30:00Z'))
  expect(tableDatePreset('today')).toEqual({ value: '2026-11-01', upper: '2026-11-01' })
  expect(tableDatePreset('week')).toEqual({ value: '2026-10-26', upper: '2026-11-01' })
  expect(tableDatePreset('month')).toEqual({ value: '2026-11-01', upper: '2026-11-30' })
  expect(tableDatePreset('month', '2028-02-10')).toEqual({ value: '2028-02-01', upper: '2028-02-29' })
  const h = harness([{ field: 'dueDate', operator: 'before', value: '2026-10-20' }])
  h.button('本月').props.onClick()
  expect(h.filters()).toEqual([{ field: 'dueDate', operator: 'date-between', value: '2026-11-01', upper: '2026-11-30' }])
})

it('排序入口仅保留排序二字，已选字段和方向放提示与弹层', () => {
  const table: any = { getColumn: () => ({ getIsVisible: () => true }), getRowModel: () => ({ rows: [] }), getState: () => ({ sorting: [{ id: 'dueDate', desc: true }] }), getAllLeafColumns: () => [{ id: 'dueDate', columnDef: { header: '截止日期' }, getCanSort: () => true }] }
  const tree = TableToolbar({ table, fields, query: '', onQueryChange: vi.fn(), filters: [], onFiltersChange: vi.fn(), defaultVisibility: {}, totalRows: 0, sortable: true })
  const element = nodes(tree).find(n => n.type?.name === 'TableSort')
  const trigger = nodes(element.type(element.props)).find(n => n.props['aria-label'] === '排序表格')
  expect(text(trigger)).toBe('排序')
  expect(trigger.props.title).toBe('截止日期 · 降序')
})


it('工资常用分类首屏点值，金额固定字段直接填区间，其他字段折叠保留', () => {
  const h = harness([], '', { preferredFilterFields: ['status', 'dueDate', 'amount'], searchPlaceholder: '订单名、收款人、渠道' })
  expect(h.labelled('搜索表格').props.placeholder).toBe('订单名、收款人、渠道')
  expect(h.labelled('添加订单名称筛选')).toBeUndefined()
  expect(h.labelled('编辑金额筛选')).toBeDefined()
  h.labelled('订单状态：已交付').props.onClick()
  expect(h.filters()).toEqual([{ field: 'status', operator: 'equals', value: '已交付' }])
  expect(h.labelled('订单状态：已交付').props['aria-pressed']).toBe(true)
  expect(h.labelled('编辑金额筛选')).toBeDefined()
  h.labelled('编辑金额筛选').props.onClick()
  expect(h.labelled('筛选字段 2')).toBeUndefined()
  expect(h.labelled('筛选条件 2')).toBeUndefined()
  h.labelled('筛选值 2').props.onChange({ target: { value: '20' } })
  h.labelled('筛选上限 2').props.onChange({ target: { value: '80' } })
  expect(h.filters()[1]).toEqual({ field: 'amount', operator: 'between', value: '20', upper: '80' })
  h.labelled('订单状态：已交付').props.onClick()
  expect(h.filters()).toEqual([{ field: 'amount', operator: 'between', value: '20', upper: '80' }])
  nodes(h.render()).find(n => n.type === 'button' && text(n).startsWith('更多筛选')).props.onClick()
  expect(h.labelled('添加订单名称筛选')).toBeDefined()
})

it('工资筛选搜索覆盖更多字段，完成关闭保留条件，手机不自动唤起键盘', () => {
  const h = harness([], '', { preferredFilterFields: ['status', 'dueDate'] })
  expect(h.labelled('查找筛选字段')).toBeUndefined()
  h.button('更多筛选').props.onClick()
  h.labelled('查找筛选字段').props.onChange({ target: { value: '名称' } })
  expect(h.labelled('添加订单名称筛选')).toBeDefined()
  h.labelled('添加订单名称筛选').props.onClick()
  h.labelled('筛选值 1').props.onChange({ target: { value: '机械' } })
  nodes(h.render()).find(n => n.type === 'popover').props.onOpenChange(true)
  h.button('完成').props.onClick()
  expect(nodes(h.render()).find(n => n.type === 'popover').props.open).toBe(false)
  expect(h.filters()).toEqual([{ field: 'title', operator: 'contains', value: '机械' }])
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
  const preventDefault = vi.fn()
  nodes(h.render()).find(n => n.type === 'popover-content').props.onOpenAutoFocus({ preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  preventDefault.mockClear()
  nodes(h.render()).find(n => n.type === 'popover-content').props.onOpenAutoFocus({ preventDefault })
  expect(preventDefault).not.toHaveBeenCalled()
})


it('常用选项变化后仍显示已选值，可直接取消，不留下隐形条件', () => {
  let filters: TableFilter[] = [{ field: 'status', operator: 'equals', value: '已交付' }]
  const table: any = { getColumn: () => ({ getIsVisible: () => true }), getRowModel: () => ({ rows: [] }) }
  const tree = TableToolbar({ table, fields: fields.map(field => field.id === 'status' ? { ...field, options: ['未交付'] } : field),
    query: '', onQueryChange: vi.fn(), filters, onFiltersChange: next => { filters = next }, defaultVisibility: {}, totalRows: 3, preferredFilterFields: ['status'] })
  const choice = nodes(tree).find(node => node.props['aria-label'] === '订单状态：已交付')
  expect(choice.props['aria-pressed']).toBe(true)
  choice.props.onClick()
  expect(filters).toEqual([])
})

it('共用分类支持多选、保留已选值及清空组，只允许业务声明的条件', () => {
  let filters: TableFilter[] = []
  const field: TableFilterField<any> = { id: 'status', label: '状态', date: false, numeric: false, options: ['a', 'b'], optionLabel: value => value === 'a' ? '未交付' : '已交付', multiple: true, operators: ['one-of'], value: row => row.status }
  const render = () => { hooks.cursor = 0; return TableFilterPopover({ fields: [field], filters, onFiltersChange: next => { filters = next }, preferredFilterFields: ['status'], matching: 3, totalRows: 4 }) }
  const labelled = (label: string) => nodes(render()).find(node => node.props['aria-label'] === label)
  labelled('状态：未交付').props.onClick()
  labelled('状态：已交付').props.onClick()
  expect(filters).toEqual([{ field: 'status', operator: 'one-of', value: '', values: ['a', 'b'], upper: undefined }])
  expect(labelled('状态：未交付').props['aria-pressed']).toBe(true)
  expect(labelled('状态：已交付').props['aria-pressed']).toBe(true)
  labelled('状态：未交付').props.onClick()
  expect(filters[0].values).toEqual(['b'])
  labelled('清除状态筛选').props.onClick()
  expect(filters).toEqual([])
  nodes(render()).find(node => node.type === 'button' && text(node) === '更多筛选').props.onClick()
  labelled('查找筛选字段').props.onChange({ target: { value: '状态' } })
  labelled('添加状态筛选').props.onClick()
  expect(filters[0].operator).toBe('one-of')
  expect(labelled('筛选条件 1')).toBeUndefined()
})

it('长渠道列表按名称搜索、头像渲染、已选值保留，全部可展开且只滚动主体', () => {
  let filters: TableFilter[] = [{ field: 'channel', operator: 'one-of', value: '', values: ['id0'] }]
  const field: TableFilterField<any> = { id: 'channel', label: '渠道', date: false, numeric: false, options: Array.from({ length: 20 }, (_, i) => `id${i}`), optionLabel: value => `渠道 ${value.slice(2)}`, multiple: true, operators: ['one-of'], value: row => row.channel }
  const renderOption = vi.fn((_field: string, value: string) => <span data-avatar={value}>头像 {value}</span>)
  const render = () => { hooks.cursor = 0; return TableFilterPopover({ fields: [field], filters, onFiltersChange: next => { filters = next }, preferredFilterFields: ['channel'], matching: 3, totalRows: 4, renderOption }) }
  const labelled = (label: string) => nodes(render()).find(node => node.props['aria-label'] === label)
  expect(labelled('渠道：渠道 19')).toBeUndefined()
  nodes(render()).find(node => node.type === 'button' && text(node) === '显示全部 20 项').props.onClick()
  expect(labelled('渠道：渠道 19')).toBeDefined()
  labelled('搜索渠道选项').props.onChange({ target: { value: '渠道 19' } })
  expect(labelled('渠道：渠道 1')).toBeUndefined()
  expect(labelled('移除渠道：渠道 0')).toBeDefined()
  labelled('渠道：渠道 19').props.onClick()
  expect(filters[0].values).toEqual(['id0', 'id19'])
  expect(renderOption).toHaveBeenCalledWith('channel', 'id19')
  expect(nodes(render()).filter(node => node.props.className?.includes('overflow-y-auto'))).toHaveLength(1)
  labelled('移除渠道：渠道 0').props.onClick()
  expect(filters[0].values).toEqual(['id19'])
  labelled('清除渠道筛选').props.onClick()
  expect(filters).toEqual([])
})

it('清空尊重页面处理器且不触发二次变更，底部扩展保留完成入口', () => {
  const onClear = vi.fn(), onFiltersChange = vi.fn()
  const tree = TableFilterPopover({ fields, filters: [{ field: 'status', operator: 'equals', value: '已交付' }], onFiltersChange, matching: 1, totalRows: 2, footer: <span>保存视图</span>, onClear, ariaLabel: '订单筛选' })
  expect(nodes(tree).find(node => node.props['aria-label'] === '订单筛选')).toBeDefined()
  expect(text(tree)).toContain('保存视图')
  expect(nodes(tree).find(node => node.type === 'button' && text(node) === '完成')).toBeDefined()
  nodes(tree).find(node => node.type === 'button' && text(node) === '清空条件').props.onClick()
  expect(onClear).toHaveBeenCalledOnce()
  expect(onFiltersChange).not.toHaveBeenCalled()
})


it('常用日期固定字段直接选日期，选择前不新增空条件', () => {
  const h = harness([], '', { preferredFilterFields: ['dueDate'] })
  expect(h.labelled('查找筛选字段')).toBeUndefined()
  expect(h.labelled('筛选字段 1')).toBeUndefined()
  h.labelled('编辑截止日期筛选').props.onClick()
  expect(h.filters()).toEqual([])
  expect(h.labelled('筛选条件 1')).toBeUndefined()
  expect(h.labelled('筛选值 1').props.type).toBe('date')
  h.labelled('筛选值 1').props.onChange({ target: { value: '2026-11-01' } })
  h.labelled('筛选上限 1').props.onChange({ target: { value: '2026-11-30' } })
  expect(h.filters()).toEqual([{ field: 'dueDate', operator: 'date-between', value: '2026-11-01', upper: '2026-11-30' }])
})

it('单一枚举无条件时不占常用区，但更多可找到；已有单边或空值条件继续按高级语义编辑', () => {
  let filters: TableFilter[] = [{ field: 'amount', operator: 'gte', value: '100' }, { field: 'dueDate', operator: 'empty', value: '' }]
  const single: TableFilterField<any> = { id: 'kind', label: '收入类型', numeric: false, date: false, options: ['写手工资'], value: () => '写手工资' }
  const render = () => { hooks.cursor = 0; return TableFilterPopover({ fields: [...fields, single], filters, onFiltersChange: next => { filters = next }, preferredFilterFields: ['kind', 'amount', 'dueDate'], matching: 1, totalRows: 3 }) }
  const labelled = (label: string) => nodes(render()).find(node => node.props['aria-label'] === label)
  expect(labelled('收入类型快捷筛选')).toBeUndefined()
  expect(labelled('筛选条件 1').props.value).toBe('gte')
  expect(labelled('筛选条件 2').props.value).toBe('empty')
  expect(labelled('筛选值 2')).toBeUndefined()
  expect(filters.map(filter => filter.operator)).toEqual(['gte', 'empty'])
  nodes(render()).find(node => node.type === 'button' && text(node) === '更多筛选').props.onClick()
  expect(labelled('添加收入类型筛选')).toBeDefined()
})

it('旧空渠道contains不再占用高级卡，有内容的contains不被转换；渠道可从字段元数据渲染头像', () => {
  let filters: TableFilter[] = [{ field: 'channel', operator: 'contains', value: '' }]
  const renderOption = vi.fn(value => <span data-avatar={value}>头像 {value}</span>)
  const field: TableFilterField<any> = { id: 'channel', label: '渠道', numeric: false, date: false, options: ['甲', '乙'], value: row => row.channel, renderOption }
  const render = () => { hooks.cursor = 0; return TableFilterPopover({ fields: [field], filters, onFiltersChange: next => { filters = next }, preferredFilterFields: ['channel'], matching: 2, totalRows: 3 }) }
  const labelled = (label: string) => nodes(render()).find(node => node.props['aria-label'] === label)
  expect(labelled('渠道高级筛选')).toBeUndefined()
  labelled('渠道：甲').props.onClick()
  expect(filters[0]).toMatchObject({ operator: 'equals', value: '甲' })
  expect(renderOption).toHaveBeenCalledWith('甲')
  filters = [{ field: 'channel', operator: 'contains', value: '甲' }]
  expect(labelled('渠道高级筛选')).toBeDefined()
  expect(labelled('筛选条件 1').props.value).toBe('contains')
  expect(filters[0]).toEqual({ field: 'channel', operator: 'contains', value: '甲' })
})
