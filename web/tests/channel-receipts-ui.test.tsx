import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Channel, OrderView } from '@/shared/types'
import type { ChannelReceipt } from '@/shared/channel-receipts'
import { distributeReceipt, moneyCents } from '@/shared/receipt-allocation'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, session: {} as any, act: vi.fn(), refresh: vi.fn() }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'), useEffect: vi.fn(),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, act: h.act, refresh: h.refresh }))
vi.mock('@/client/store-channel-receipts', () => ({ saveChannelReceipt: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/FinancialNote', () => ({ FinancialNote: 'financial-note', FinancialNoteView: 'financial-view' }))
vi.mock('@/client/ui', () => ({ Money: 'money', ChannelAvatar: 'avatar', inputCls: '' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: 'checkbox' }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { ChannelReceiptDialog } from '@/client/ChannelReceipts'
import { saveChannelReceipt } from '@/client/store-channel-receipts'
const channel = { id: 'channel', name: '测试渠道' } as Channel
const orders = [{ id: 'a', no: 'DDa', title: '第一单', channelId: 'channel', unpaid: 100, status: '未交付', salesMode: 'commission' }, { id: 'b', no: 'DDb', title: '第二单', channelId: 'channel', unpaid: 80, status: '未交付', salesMode: 'commission' }] as OrderView[]
const receipt = { id: 'receipt', no: 'SKtest', amount: 180, date: '2026-01-01', unallocated: 180, revision: 2 } as ChannelReceipt
const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' || typeof n === 'number' ? String(n) : n?.props ? text(n.props.children) : ''
const button = (t: any, label: string) => nodes(t).find(n => n.type === 'button' && text(n).startsWith(label))
const field = (t: any, label: string) => nodes(t).find(n => n.props['aria-label'] === label)
const note = (t: any) => nodes(t).find(n => n.type === 'financial-note')
const onClose = vi.fn(), onDone = vi.fn()
function dialog(props: { receipt?: ChannelReceipt; orders?: OrderView[] } = {}) { h.cursor = 0; return ChannelReceiptDialog({ channel, orders, initialIds: ['a', 'b'], onClose, onDone, ...props }) }
function filled() {
  let t = dialog(); field(t, '收款总额').props.onChange({ target: { value: '150' } })
  t = dialog(); button(t, '按价格比例分').props.onClick(); return dialog()
}
beforeEach(() => { h.session = { role: { locked: true } }; h.refresh.mockResolvedValue(undefined) })
afterEach(() => { h.slots = []; vi.resetAllMocks() })

it('均分以分为单位且不超各单待收，低于每单一分拒绝', () => {
  expect(distributeReceipt(101, [{ id: 'a', unpaid: 0.2 }, { id: 'b', unpaid: 5 }])).toEqual({ a: '0.20', b: '0.81' })
  expect(distributeReceipt(1, orders)).toBeNull()
  expect(distributeReceipt(18001, orders)).toBeNull()
  expect(moneyCents('0.001')).toBeNull(); expect(moneyCents('0')).toBeNull(); expect(moneyCents('1.20')).toBe(120)
})
it('图片读取同步阻止关闭和提交，连续点击只发一次并携带完整凭证', async () => {
  let finish!: (v: any) => void
  vi.mocked(saveChannelReceipt).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  let t = filled(); note(t).props.onReading(true)
  button(t, '确认收款').props.onClick(); nodes(t).find(n => n.type === 'dialog').props.onOpenChange(false)
  expect(saveChannelReceipt).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
  expect(button(dialog(), '确认收款').props.disabled).toBe(true)
  note(t).props.onProof('complete-proof'); note(t).props.onReading(false)
  t = dialog(); button(t, '确认收款').props.onClick(); button(t, '确认收款').props.onClick()
  expect(saveChannelReceipt).toHaveBeenCalledOnce()
  expect(saveChannelReceipt).toHaveBeenCalledWith('channelReceipt.create', expect.objectContaining({ amount: 150, proof: 'complete-proof', lines: [{ orderId: 'a', amount: 83.33 }, { orderId: 'b', amount: 66.67 }] }))
  finish({ status: 'success', result: { id: 'saved', amount: 150, count: 2 } })
  await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('saved'))
})
it('未知结果冻结输入和关闭，重试复用同一请求及备注日期', async () => {
  vi.mocked(saveChannelReceipt).mockResolvedValueOnce({ status: 'unknown' }).mockResolvedValueOnce({ status: 'success', result: { id: 'saved', amount: 150, count: 2 } })
  let t = filled(); note(t).props.onNote('批量转款'); field(t, '渠道收款日期').props.onChange({ target: { value: '2026-01-01' } })
  t = dialog(); button(t, '确认收款').props.onClick()
  await vi.waitFor(() => expect(text(dialog())).toContain('尚未收到确认'))
  const original = vi.mocked(saveChannelReceipt).mock.calls[0][1]
  t = dialog(); expect(note(t).props.disabled).toBe(true); expect(button(t, '取消').props.disabled).toBe(true)
  expect(field(t, '渠道收款日期').props.disabled).toBe(true)
  nodes(t).find(n => n.type === 'dialog').props.onOpenChange(false); expect(onClose).not.toHaveBeenCalled()
  button(t, '核对并重试').props.onClick()
  await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('saved'))
  expect(vi.mocked(saveChannelReceipt).mock.calls[1][1]).toBe(original)
})
it('明确拒绝后允许修改重发并使用新请求号；预收不带已选订单分配', async () => {
  vi.mocked(saveChannelReceipt).mockResolvedValueOnce({ status: 'rejected' }).mockResolvedValueOnce({ status: 'success', result: { id: 'saved', amount: 150, count: 0 } })
  button(filled(), '确认收款').props.onClick()
  await vi.waitFor(() => expect(button(dialog(), '确认收款').props.disabled).toBe(false))
  const previous = vi.mocked(saveChannelReceipt).mock.calls[0][1]
  let t = dialog(); button(t, '暂存预收款').props.onClick(); note(t).props.onNote('暂存')
  t = dialog(); button(t, '确认收款').props.onClick()
  await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('saved'))
  const next = vi.mocked(saveChannelReceipt).mock.calls[1][1]
  expect(next.requestId).not.toBe(previous.requestId); expect(next).toMatchObject({ mode: 'advance', lines: [], note: '暂存' })
})
it('预收分配未知时即使实时刷新已收齐仍展示原选单和金额，重试不丢分配', async () => {
  vi.mocked(saveChannelReceipt).mockResolvedValueOnce({ status: 'unknown' }).mockResolvedValueOnce({ status: 'success', result: { id: 'receipt', amount: 180, count: 2 } })
  let t = dialog({ receipt }); button(t, '按价格比例分').props.onClick()
  t = dialog({ receipt }); button(t, '确认分配').props.onClick()
  await vi.waitFor(() => expect(text(dialog({ receipt }))).toContain('尚未收到确认'))
  const original = vi.mocked(saveChannelReceipt).mock.calls[0][1]
  t = dialog({ receipt, orders: orders.map(o => ({ ...o, unpaid: 0 })) })
  expect(text(t)).toContain('第一单'); expect(text(t)).toContain('第二单')
  expect(text(nodes(t).find(n => n.type === 'footer'))).toContain('¥180')
  button(t, '核对并重试').props.onClick()
  await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('receipt'))
  expect(vi.mocked(saveChannelReceipt).mock.calls[1][1]).toBe(original)
})
it('收款存储层把明确拒绝和未知区分，成功后刷新且返回服务端原金额', async () => {
  const { saveChannelReceipt: save } = await vi.importActual<typeof import('@/client/store-channel-receipts')>('@/client/store-channel-receipts')
  const input = { id: 'receipt', requestId: crypto.randomUUID(), revision: 1, lines: [{ orderId: 'a', amount: 10 }] }
  h.act.mockImplementationOnce(async (_a, _i, opts) => { opts.onRejected(); return null })
  expect(await save('channelReceipt.allocate', input)).toEqual({ status: 'rejected' })
  h.act.mockResolvedValueOnce(null)
  expect(await save('channelReceipt.allocate', input)).toEqual({ status: 'unknown' })
  h.act.mockResolvedValueOnce({ id: 'receipt', amount: 10, count: 1 })
  expect(await save('channelReceipt.allocate', input)).toEqual({ status: 'success', result: { id: 'receipt', amount: 10, count: 1 } })
  expect(h.refresh).toHaveBeenCalledOnce()
})
it('直接暂存预收无需填写已选订单金额，提交空分配清单', async () => {
  vi.mocked(saveChannelReceipt).mockResolvedValueOnce({ status: 'success', result: { id: 'advance', amount: 120, count: 0 } })
  let t = dialog()
  field(t, '收款总额').props.onChange({ target: { value: '120' } }); button(t, '暂存预收款').props.onClick()
  t = dialog(); expect(button(t, '确认收款').props.disabled).toBe(false)
  button(t, '确认收款').props.onClick()
  await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('advance'))
  expect(saveChannelReceipt).toHaveBeenCalledWith('channelReceipt.create', expect.objectContaining({ amount: 120, mode: 'advance', lines: [] }))
})
