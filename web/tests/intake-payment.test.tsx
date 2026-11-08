import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ values: [] as any[], writes: [] as any[], canReceive: true, admin: true }))
vi.mock('react', async () => ({ ...await vi.importActual('react'), useEffect: () => {}, useMemo: (fn: any) => fn(), useState: (initial: any) => { const i = h.writes.length; h.writes.push([]); return [h.values.length ? h.values.shift() : typeof initial === 'function' ? initial() : initial, (v: any) => h.writes[i].push(v)] }, useRef: (current: any) => ({ current }) }))
vi.mock('motion/react', async () => ({ ...await vi.importActual('motion/react'), useReducedMotion: () => false }))
vi.mock('@/client/store', () => ({ useSession: () => ({ s: { channels: [], users: [], types: [] }, me: { id: 'boss' }, role: { locked: h.admin }, adminIds: new Set(), views: [], can: (p: string) => p !== 'payment.create' || h.canReceive }), salesPeople: () => [], createChannel: vi.fn(), createOrder: vi.fn(), uploadFiles: vi.fn(), addPayment: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/prefs', () => ({ usePref: () => [false, vi.fn()] }))
vi.mock('@/client/fresh', () => ({ markFresh: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { QuickEntry } from '@/client/QuickEntry'
import { IntakePayment, validPaidAmount } from '@/client/IntakePayment'
import { createOrder, addPayment, uploadFiles } from '@/client/store'
import { Dialog } from '@/components/ui/dialog'
function nodes(n: any): any[] { return Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [] }
function form(amount = '200', tag = '定金') {
  h.values = [{ title: '测试', channelId: 'c', ownerId: 'boss', type: '', basePrice: '800', orderDate: '2026-10-09', dueDate: '2026-10-19', channelNo: '', note: '', rows: [], paidAmount: amount, paidNote: '', paidProof: undefined, paymentTag: tag }]
  const closed = vi.fn(), tree = QuickEntry({ open: true, onOpenChange: closed })
  const save = () => nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault: vi.fn() })
  return { tree, closed, save }
}
afterEach(() => { h.values = []; h.writes = []; h.canReceive = true; h.admin = true; vi.resetAllMocks() })
it('全款带入销售额；已付金额仍可编辑，切定金保留金额', () => {
  const changed = vi.fn(), all = nodes(IntakePayment({ id: 'p', amount: '200', tag: '定金', total: 800, onChange: changed }))
  all.find(n => n.type === 'button' && n.props.children === '全款').props.onClick()
  expect(changed).toHaveBeenLastCalledWith('800', '全款')
  all.find(n => n.type === 'input').props.onChange({ target: { value: '123.45' } })
  expect(changed).toHaveBeenLastCalledWith('123.45', '定金')
  all.find(n => n.type === 'button' && n.props.children === '定金').props.onClick()
  expect(changed).toHaveBeenLastCalledWith('200', '定金')
})
it('空白和零不记款；拒绝负数、非金额和多余小数', () => {
  for (const amount of ['', '0', '200', '10.25']) expect(validPaidAmount(amount)).toBe(true)
  for (const amount of ['-20', '1.2.3', 'abc', '0.001', '10000001', 'Infinity']) expect(validPaidAmount(amount)).toBe(false)
})
it.each(['定金', '全款'])('手动录单按选择的 %s 记收款', async tag => {
  vi.mocked(createOrder).mockResolvedValue({ id: 'o', no: 'N' }); vi.mocked(addPayment).mockResolvedValue(true)
  const f = form('200', tag); f.save()
  await vi.waitFor(() => expect(f.closed).toHaveBeenCalledWith(false))
  expect(addPayment).toHaveBeenCalledWith('o', expect.objectContaining({ amount: 200, tag }), expect.objectContaining({ silent: true, onResult: expect.any(Function) }))
})
it.each(['', '0'])('已付填 %j 只建单', async amount => {
  vi.mocked(createOrder).mockResolvedValue({ id: 'o', no: 'N' })
  const f = form(amount); f.save(); await vi.waitFor(() => expect(f.closed).toHaveBeenCalledWith(false))
  expect(addPayment).not.toHaveBeenCalled()
})
it('收款失败保留弹窗，重试复用订单及同一收款；未成功前不传附件', async () => {
  vi.mocked(createOrder).mockResolvedValue({ id: 'o', no: 'N' })
  vi.mocked(addPayment).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const f = form(); f.save(); await vi.waitFor(() => expect(addPayment).toHaveBeenCalledOnce())
  nodes(f.tree).find(n => n.type === Dialog).props.onOpenChange(false)
  expect(f.closed).not.toHaveBeenCalled(); expect(uploadFiles).not.toHaveBeenCalled()
  const payload = vi.mocked(addPayment).mock.calls[0][1]
  f.save(); await vi.waitFor(() => expect(f.closed).toHaveBeenCalledWith(false))
  expect(createOrder).toHaveBeenCalledOnce(); expect(vi.mocked(addPayment).mock.calls[1][1]).toBe(payload)
})
it('金额无效时不先创建订单', () => {
  const f = form('-20'); f.save(); expect(createOrder).not.toHaveBeenCalled(); expect(addPayment).not.toHaveBeenCalled()
})
it('无收款权限不显示金额也不提交收款', async () => {
  h.canReceive = false; vi.mocked(createOrder).mockResolvedValue({ id: 'o', no: 'N' })
  const f = form(); expect(nodes(f.tree).some(n => n.type === IntakePayment)).toBe(false)
  f.save(); await vi.waitFor(() => expect(f.closed).toHaveBeenCalledWith(false)); expect(addPayment).not.toHaveBeenCalled()
})

it('销售录单有已付金额时，缺少备注不得先创建订单', () => {
  h.admin = false
  const f = form(); f.save(); expect(createOrder).not.toHaveBeenCalled(); expect(addPayment).not.toHaveBeenCalled()
})

it.each([[800, '240', '400'], [333.35, '100.01', '166.68'], [199.99, '60', '100']])('报价 %s 的30%%和50%%按整分四舍五入，快捷填后仍可手改', (total, thirty, half) => {
  const changed = vi.fn(), all = nodes(IntakePayment({ id: 'p', amount: '', tag: '全款', total, quickPercentages: true, onChange: changed }))
  const shortcut = (percent: number) => all.find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children[0] === percent)
  shortcut(30).props.onClick(); expect(changed).toHaveBeenLastCalledWith(thirty, '定金')
  shortcut(50).props.onClick(); expect(changed).toHaveBeenLastCalledWith(half, '定金')
  all.find(n => n.type === 'button' && n.props.children === '全款').props.onClick(); expect(changed).toHaveBeenLastCalledWith(String(total), '全款')
  all.find(n => n.type === 'input').props.onChange({ target: { value: '120.50' } }); expect(changed).toHaveBeenLastCalledWith('120.50', '全款')
})
it.each([null, 0, -10, NaN, Infinity])('无有效报价 %s 时比例快捷金额禁用且不会写入', total => {
  const changed = vi.fn(), all = nodes(IntakePayment({ id: 'p', amount: '20', tag: '定金', total, quickPercentages: true, onChange: changed }))
  for (const shortcut of all.filter(n => n.type === 'button' && Array.isArray(n.props.children) && [30, 50].includes(n.props.children[0]))) {
    expect(shortcut.props.disabled).toBe(true); shortcut.props.onClick()
  }
  expect(changed).not.toHaveBeenCalled()
})
