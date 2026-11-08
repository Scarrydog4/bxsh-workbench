import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => unknown)[], prefs: {} as Record<string, unknown>, session: {} as any }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => unknown) => { h.effects.push(fn) }, useMemo: (fn: () => unknown) => fn(),
}))
vi.mock('motion/react', async () => ({ ...await vi.importActual('motion/react'), useReducedMotion: () => false }))
vi.mock('@/client/prefs', () => {
  const pref = (key: string, fallback: unknown) => [h.prefs[key] ?? fallback, (value: unknown) => { h.prefs[key] = value }]
  return { usePref: pref, useDevicePref: pref }
})
vi.mock('@tanstack/react-table', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-table')>('@tanstack/react-table')
  return { ...actual, useReactTable: (options: any) => {
    const table = actual.createTable({ ...options, state: {} })
    table.setOptions({ ...options, state: { ...table.initialState, ...options.state } })
    return table
  } }
})
vi.mock('@/client/store', () => ({ useSession: () => h.session, useOrderTableSession: () => h.session }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn(), cards: {} }) }))
vi.mock('@/client/order-update-feedback', () => ({ useOrderUpdateFeedback: () => {}, highlightOrders: vi.fn() }))
import { OrdersPage } from '@/client/OrdersPage'
import { VirtualTableBody } from '@/client/VirtualTableBody'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.type === VirtualTableBody ? node.props.rows.map((row: any, index: number) => node.props.children(row, index, undefined)) : node.props.children)] : []
function render() { h.cursor = 0; h.effects = []; return OrdersPage() }
function resize(width: number) {
  const tree = render()
  tree.props.ref.current = { clientWidth: width }
  h.effects[0]()
  return render()
}
const grid = (tree: any) => nodes(tree).find(n => n.props['aria-label'] === '订单表格，可横向滚动')
const chooseDisplay = (value: string) => nodes(render()).find(n => n.props['aria-label'] === '订单展示方式').props.onChange({ target: { value } })
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const row = { id: 'o', no: 'DD1', title: '窄屏订单', type: '', channelId: 'c', ownerId: 'boss', creatorId: 'boss', orderDate: '2026-10-11', dueDate: null, status: '未交付', assignees: [], afterSales: [], sales: 200, received: 0, unpaid: 200, payments: [], wechatGroup: '' }
  h.session = { views: [row], me: { id: 'boss', roleId: 'admin' }, s: { role: { locked: true, fields: { sales: true } }, statuses: ['未交付'], channels: [], users: [] }, can: () => true, user: () => undefined, channel: () => undefined }
})
afterEach(() => { h.slots = []; h.prefs = {}; vi.unstubAllGlobals() })

it('625px 订单区域从自动卡片切完整表格立即生效，宽窄切换仍保留明确选择', () => {
  expect(grid(resize(625)).props.hidden).toBe(true)
  chooseDisplay('table')
  const narrow = render()
  expect(grid(narrow).props.hidden).toBe(false)
  expect(nodes(narrow).filter(n => n.type === 'article')).toHaveLength(0)
  expect(grid(resize(500)).props.hidden).toBe(false)
  chooseDisplay('overview')
  expect(grid(resize(1200)).props.hidden).toBe(true)
  chooseDisplay('auto')
  expect(grid(resize(640)).props.hidden).toBe(false)
  expect(grid(resize(639)).props.hidden).toBe(true)
})

it('窄屏完整表格保留单个横向滚动区，冻结列最多占半屏且其他列仍可滚动', () => {
  chooseDisplay('table')
  const tree = resize(625), scroll = grid(tree), all = nodes(scroll)
  expect(nodes(tree).filter(n => n.props['aria-label'] === '订单表格，可横向滚动')).toHaveLength(1)
  expect(scroll.props.className).toContain('overflow-auto')
  expect(all.find(n => n.type === 'table').props.style.width).toBeGreaterThan(625)
  const cells = all.filter(n => n.type === 'td'), pinned = cells.filter(n => n.props.style.position === 'sticky')
  expect(pinned.length).toBeGreaterThan(0)
  expect(Math.max(...pinned.map(n => n.props.style.left + n.props.style.width))).toBeLessThanOrEqual(625 / 2)
  expect(cells.some(n => n.props.style.position !== 'sticky')).toBe(true)
})
