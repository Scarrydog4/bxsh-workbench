import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ values: [] as any[], writes: [] as any[], refs: [] as any[] }))
vi.mock('react', async () => ({ ...await vi.importActual('react'), useState: () => { const i = h.writes.length; h.writes.push([]); return [h.values.shift(), (value: any) => h.writes[i].push(value)] }, useRef: (value: any) => { const ref = { current: value }; h.refs.push(ref); return ref }, useEffect: () => {} }))
vi.mock('react-dom', () => ({ flushSync: (fn: () => void) => fn() }))
vi.mock('@/client/store', () => ({ useSession: () => ({ s: { channels: [], users: [], types: [] }, me: { id: 'boss' }, role: { locked: true }, can: () => true }), refresh: vi.fn().mockResolvedValue(undefined), addPayment: vi.fn().mockResolvedValue(true), uploadFiles: vi.fn().mockResolvedValue(true), salesPeople: () => [], deleteOrders: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn(), go: vi.fn() }) }))
vi.mock('@/client/fresh', () => ({ markFresh: vi.fn() }))
vi.mock('@/client/ui', () => ({ ChannelAvatar: 'span', Combobox: 'span', inputCls: '' }))
vi.mock('@/client/PersonChoice', () => ({ PersonChoice: 'span' }))
vi.mock('@/client/DatePicker', () => ({ DatePicker: 'span' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { IntakeFlow } from '@/client/AiIntake'

const row = { key: 'one', title: '测试订单', salesMode: 'commission', channelId: 'channel', channelName: '渠道', newChannel: false, ownerId: 'boss', type: '', basePrice: 800, orderDate: '2026-10-08', dueDate: '2026-10-18', channelNo: '', note: '', writerId: 'writer', writerName: '写手', writerPay: 80, warnings: ['新订单类型'], imageIndexes: [], deposit: 300, paidAmount: '300', paymentNote: '客户定金', paymentProof: 'data:image/png;base64,aGVsbG8=', paymentTag: '定金', open: false }
function elements(node: any): any[] { if (Array.isArray(node)) return node.flatMap(elements); return node?.props ? [node, ...elements(node.props.children)] : [] }
function render(rows: any[], onClose = vi.fn()) {
  h.values = ['', [], rows, '', '', '', [], false, false, false, false]
  return { nodes: elements(IntakeFlow({ onClose })), onClose }
}
const confirm = (nodes: any[]) => nodes.find(node => node.type === 'button' && String(node.props.children).includes('确认入库'))
afterEach(() => { h.writes = []; h.refs = []; vi.clearAllMocks(); vi.unstubAllGlobals() })

it('切换为底价时清空客户金额和已付凭据，不改别的订单', () => {
  const second = { ...row, key: 'two', title: '另一单' }
  const { nodes } = render([row, second])
  nodes.find(node => node.props['aria-label'] === '第1单结算方式').props.onChange({ target: { value: 'cost' } })
  const next = h.writes[2].at(-1)([row, second])
  expect(next[0]).toMatchObject({ salesMode: 'cost', basePrice: null, paidAmount: '', paymentNote: '', deposit: null })
  expect(next[0].paymentProof).toBeUndefined()
  expect(next[0].warnings).toContain('新订单类型')
  expect(next[1]).toBe(second)
})

it('无渠道底价草稿显示交老板金额并带明确口径提交', async () => {
  vi.stubGlobal('document', { querySelector: () => null })
  const fetcher = vi.fn().mockResolvedValue(Response.json({ orders: [{ id: 'cost-order', no: 'D1' }] }))
  vi.stubGlobal('fetch', fetcher)
  const { nodes, onClose } = render([{ ...row, salesMode: 'cost', channelId: '', channelName: '', basePrice: 500, paidAmount: '' }])
  expect(nodes.some(node => node.props['aria-label'] === '第1单交老板底价')).toBe(true)
  expect(nodes.some(node => node.type === 'button' && String(node.props.children).includes('填入识别金额'))).toBe(false)
  confirm(nodes).props.onClick()
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(JSON.parse(fetcher.mock.calls[0][1].body).orders[0]).toMatchObject({ salesMode: 'cost', channelId: '', basePrice: 500 })
})

it('底价缺失时定位金额而非渠道，不发送订单', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const { nodes } = render([{ ...row, salesMode: 'cost', channelId: '', channelName: '', basePrice: null, paidAmount: '' }])
  const query = vi.fn().mockReturnValue(null); h.refs[2].current = { querySelector: query }
  confirm(nodes).props.onClick()
  expect(query).toHaveBeenCalledWith('[data-cell="0-price"]')
  expect(fetcher).not.toHaveBeenCalled()
})
