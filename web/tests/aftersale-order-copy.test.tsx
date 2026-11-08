import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tasks: [] as any[],
  selection: null as null | { isCollapsed: boolean; containsNode: ReturnType<typeof vi.fn> },
  copy: vi.fn(),
}))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useMemo: (fn: () => unknown) => fn(), useEffect: vi.fn(), useRef: (current: any) => ({ current }),
}))
vi.mock('@/client/TaskCard', () => ({ TaskCard: 'task-card', TaskCountdown: 'task-countdown', TaskAction: 'task-action' }))
vi.mock('@/client/preview/PreviewButton', () => ({ PreviewButton: 'preview-button' }))
vi.mock('@/client/table-kit', () => ({ DataTable: 'data-table', TableFooter: 'table-footer', TablePageHeader: 'table-page-header' }))
vi.mock('@/client/ui', () => ({ ChannelName: 'channel-name', Person: 'person', Empty: 'empty', inputCls: 'input' }))
vi.mock('@/client/TaskReply', () => ({ ConfirmationPanel: 'confirmation-panel', taskTime: (value: string) => value }))
vi.mock('@/client/store', () => ({ useSession: () => ({ user: () => undefined, order: () => undefined, channel: () => undefined, s: { users: [], channels: [] }, can: () => false }) }))
vi.mock('@/client/after-sale-data', () => ({ useAfterSaleTasks: () => ({ tasks: h.tasks, error: null, loading: false }), useTaskClock: () => Date.parse('2026-10-26T10:00:00Z') }))
vi.mock('@/client/ImageViewer', () => ({ Thumbs: 'thumbs', fileUrl: (id: string) => `/api/files/${id}` }))
vi.mock('@/client/AfterSale', () => ({ PriceEditor: 'price-editor' }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ afterSale: vi.fn() }) }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/sheet', () => ({ Sheet: 'sheet', SheetContent: 'sheet-content', SheetTitle: 'sheet-title', SheetDescription: 'sheet-description' }))
vi.mock('@/components/ui/select', () => ({ Select: 'select', SelectTrigger: 'select-trigger', SelectValue: 'select-value', SelectContent: 'select-content', SelectItem: 'select-item' }))
vi.mock('@/components/ui/popover', () => ({ Popover: 'popover', PopoverAnchor: 'popover-anchor', PopoverContent: 'popover-content' }))

import { AfterSalesPage } from '@/client/AfterSalesPage'
import { CopyOrderName } from '@/client/CopyOrderName'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
function orderCell() {
  const onSelect = vi.fn()
  const tree = AfterSalesPage({ selectedId: null, onSelect })
  const table = nodes(tree).find(node => node.type === 'data-table')
  const column = table.props.cols.find((col: { id: string }) => col.id === 'order')
  return { cell: column.cell(h.tasks[0]), table, onSelect }
}
beforeEach(() => {
  h.tasks = [{ id: 'as-copy', no: 'DD2610260001', title: 'y261010A 汽车设计完整订单名', orderId: 'order-copy', channelId: 'channel', writerId: 'writer', ownerId: 'sales', by: 'sales', req: ['需要售后'], round: 1, start: '2026-10-26T09:00:00Z', due: '2026-10-26T12:00:00Z', doneAt: null, cancelledAt: null }]
  h.selection = null; h.copy.mockResolvedValue(undefined)
  vi.stubGlobal('window', { getSelection: () => h.selection })
  vi.stubGlobal('navigator', { clipboard: { writeText: h.copy } })
})
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

it('交付跟进大表复用复制入口，复制完整订单名且不打开跟进抽屉', async () => {
  const { cell, onSelect, table } = orderCell()
  const copy = nodes(cell).find(node => node.type === CopyOrderName)
  expect(copy.props.title).toBe(h.tasks[0].title)
  const button = nodes(CopyOrderName(copy.props)).find(node => node.type === 'button')
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
  await button.props.onClick(event)
  if (!event.stopPropagation.mock.calls.length) table.props.onRowClick(h.tasks[0])
  expect(h.copy).toHaveBeenCalledExactlyOnceWith('y261010A 汽车设计完整订单名')
  expect(event.stopPropagation).toHaveBeenCalledOnce()
  expect(onSelect).not.toHaveBeenCalled()
})

it('拖选订单名松手不打开抽屉，保留文字供原生复制', () => {
  const { cell, table, onSelect } = orderCell(), element = {}
  h.selection = { isCollapsed: false, containsNode: vi.fn(() => true) }
  const event = { currentTarget: element, stopPropagation: vi.fn() }
  cell.props.onClick(event)
  if (!event.stopPropagation.mock.calls.length) table.props.onRowClick(h.tasks[0])
  expect(h.selection.containsNode).toHaveBeenCalledWith(element, true)
  expect(onSelect).not.toHaveBeenCalled()
  expect(nodes(cell).find(node => node.type === 'span').props.className).toContain('select-text')
})

it.each(['none', 'collapsed', 'elsewhere'])('正常点击继续打开原跟进，其他位置的选择不干扰：%s', selection => {
  const { cell, table, onSelect } = orderCell()
  h.selection = selection === 'none' ? null : { isCollapsed: selection === 'collapsed', containsNode: vi.fn(() => false) }
  const event = { currentTarget: {}, stopPropagation: vi.fn() }
  cell.props.onClick(event)
  if (!event.stopPropagation.mock.calls.length) table.props.onRowClick(h.tasks[0])
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('as-copy')
})
