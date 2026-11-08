import { expect, it, vi } from 'vitest'
vi.mock('react', async () => ({ ...await vi.importActual('react'), useState: (value: unknown) => [value, vi.fn()] }))
import { availableOrderViews, FilterPopover, matchesOrderView, orderFilterValues, applyOrderFilters } from '@/client/OrdersPage'
import { TableFilterPopover } from '@/client/TableFilterPopover'
import { businessDate } from '@/shared/format'
import type { OrderView, Role } from '@/shared/types'
const admin = { locked: true, fields: { sales: true } } as Role
const writer = { locked: false, fields: { sales: false } } as Role
const base = { id: 'o', no: 'DD1', title: '测试订单', type: '论文', channelId: 'c', orderDate: '2026-10-01', dueDate: null, status: '未交付', assignees: [], afterSales: [], sales: 200, received: 0, unpaid: 200, payments: [], payPending: false } as unknown as OrderView
const presets = availableOrderViews([], admin, () => true)
const preset = (id: string) => presets.find(v => v.id === id)!
const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' || typeof n === 'number' ? String(n) : n?.props ? text(n.props.children) : ''
it('原有效预设保持可用，截止未填只包含进行中订单', () => {
  expect(presets.map(v => v.id)).toEqual(['all', 'undelivered', 'unpaid', 'due', 'missingDue', 'stale', 'aftersale', 'paypending', 'settle'])
  expect(['未交付', '已发演示', '已交付', '退单'].filter(status => matchesOrderView({ ...base, status }, preset('undelivered')))).toEqual(['未交付', '已发演示'])
  expect(['未交付', '已发演示', '已交付', '退单'].filter(status => matchesOrderView({ ...base, status }, preset('missingDue')))).toEqual(['未交付', '已发演示'])
  expect(matchesOrderView({ ...base, dueDate: businessDate(new Date()) }, preset('due'))).toBe(true)
  expect(matchesOrderView({ ...base, orderDate: '2020-01-01' }, preset('stale'))).toBe(true)
  expect(matchesOrderView({ ...base, orderDate: '2020-01-01', status: '已交付' }, preset('stale'))).toBe(false)
  expect(matchesOrderView({ ...base, orderDate: businessDate(new Date()) }, preset('stale'))).toBe(false)
  expect(matchesOrderView({ ...base, dueDate: businessDate(new Date()), status: '已交付' }, preset('due'))).toBe(false)
})
it('交付、收款、渠道、关键词可以同时筛选，清空数组恢复全部', () => {
  const filter = { id: 'saved', name: '组合', status: ['未交付', '已发演示'], receipt: 'noRecord' as const, channelIds: ['c', 'c2'], query: '唐老师' }
  expect(matchesOrderView(base, filter, '唐老师 老板')).toBe(true)
  expect(matchesOrderView({ ...base, status: '已发演示', channelId: 'c2' }, filter, '唐老师 老板')).toBe(true)
  expect(matchesOrderView({ ...base, channelId: 'other' }, filter, '唐老师')).toBe(false)
  expect(matchesOrderView({ ...base, payments: [{ id: 'p' }] as any }, filter, '唐老师')).toBe(false)
  expect(matchesOrderView({ ...base, status: '已交付' }, filter, '唐老师')).toBe(false)
  expect(matchesOrderView(base, { id: 'all', name: '', status: [], channelIds: [], query: '', receipt: 'all' })).toBe(true)
})
it('待收款和待结算保留原规则，不包括退单', () => {
  expect(matchesOrderView(base, preset('unpaid'))).toBe(true)
  expect(matchesOrderView({ ...base, status: '退单' }, preset('unpaid'))).toBe(false)
  expect(matchesOrderView({ ...base, draftAt: '2026-10-01T00:00:00Z', writerTotal: 100, writerSettle: '未结算', writerAvailable: 100 }, preset('settle'))).toBe(true)
  expect(matchesOrderView({ ...base, draftAt: '2026-10-01T00:00:00Z', writerTotal: 100, writerSettle: '已结算', writerAvailable: 0 }, preset('settle'))).toBe(false)
})
it('无财务权限不提供金额、工资未定、待结算及旧保存的财务筛选', () => {
  const saved = [{ id: 'v1', name: '收款', custom: true, receipt: 'partial' as const }, { id: 'v2', name: '工资', custom: true, payPending: true }, { id: 'v3', name: '渠道', custom: true, channelIds: ['c'] }]
  const allowed = availableOrderViews(saved, writer, () => false).map(v => v.id)
  expect(allowed).not.toContain('unpaid'); expect(allowed).not.toContain('paypending'); expect(allowed).not.toContain('settle')
  expect(allowed).not.toContain('v1'); expect(allowed).not.toContain('v2'); expect(allowed).toContain('v3')
})
function props(canSeeSales = true) {
  return { statuses: ['未交付', '已交付', '退单'], channels: [], statusF: [], channelF: [], setStatusF: vi.fn(), setChannelF: vi.fn(), views: canSeeSales ? presets : availableOrderViews([], writer, () => false), viewId: 'all', chooseView: vi.fn(), special: {}, setSpecial: vi.fn(), receipt: 'all' as const, canSeeSales, setReceipt: vi.fn(), count: 0, clear: vi.fn(), rename: vi.fn(), remove: vi.fn(), move: vi.fn() }
}
it('订单使用共享筛选，交付和渠道保留多选，收款和截止直接选值', () => {
  const p = props(), tree = FilterPopover(p)
  expect(tree.type).toBe(TableFilterPopover)
  expect(tree.props.preferredFilterFields).toEqual(['status', 'receipt', 'deadline', 'channel'])
  expect(tree.props.fields.find((f: any) => f.id === 'status').multiple).toBe(true)
  expect(tree.props.fields.find((f: any) => f.id === 'channel').multiple).toBe(true)
  expect(tree.props.fields.find((f: any) => f.id === 'receipt').operators).toEqual(['equals'])
  tree.props.onFiltersChange([{ field: 'receipt', operator: 'equals', value: 'unpaid' }])
  expect(p.setSpecial).toHaveBeenCalledWith(expect.objectContaining({ pay: 'unpaid' }))
  tree.props.onFiltersChange([{ field: 'deadline', operator: 'equals', value: 'missingDue' }])
  expect(p.setSpecial).toHaveBeenLastCalledWith(expect.objectContaining({ due: false, missingDue: true, stale: false }))
})
it('写手不给财务条件，普通跟进和截止条件保留', () => {
  const tree = FilterPopover(props(false)), ids = tree.props.fields.map((f: any) => f.id)
  expect(ids).not.toContain('receipt'); expect(ids).not.toContain('payPending'); expect(ids).not.toContain('settle')
  expect(ids).toContain('aftersale'); expect(ids).toContain('deadline')
})
it('旧预设和保存视图映射来回不丢状态、多选渠道和组合条件', () => {
  const p = { ...props(), statusF: ['未交付', '已发演示'], channelF: ['c1', 'c2'], receipt: 'partial' as const, special: { stale: true, aftersale: true, settle: true } }
  const values = orderFilterValues(p)
  applyOrderFilters(p, values)
  expect(p.setStatusF).not.toHaveBeenCalled(); expect(p.setChannelF).not.toHaveBeenCalled()
  expect(p.setSpecial).not.toHaveBeenCalled(); expect(p.setReceipt).not.toHaveBeenCalled()
  applyOrderFilters(p, values.filter(f => f.field !== 'status'))
  expect(p.setStatusF).toHaveBeenCalledWith([])
  expect(p.setChannelF).not.toHaveBeenCalled(); expect(p.setSpecial).not.toHaveBeenCalled()
})
it('已存视图、存视图和清空继续委托原订单动作', () => {
  const p = { ...props(), views: [...presets, { id: 'custom', name: '我的未交付', custom: true }], viewId: 'custom', save: vi.fn() }
  const tree = FilterPopover(p), footer = nodes(tree.props.footer)
  expect(text(tree.props.footer)).toContain('已存视图')
  footer.find(n => n.type === 'button' && text(n) === '我的未交付').props.onClick()
  expect(p.chooseView).toHaveBeenCalledWith('custom')
  footer.find(n => text(n) === '存为视图').props.onClick()
  expect(p.save).toHaveBeenCalledOnce()
  tree.props.onClear()
  expect(p.clear).toHaveBeenCalledOnce()
})
