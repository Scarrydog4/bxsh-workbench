import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => unknown)[], cleanups: [] as (() => void)[], reduce: false, keepGoing: false }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (effect: () => unknown) => { h.effects.push(effect) }, useMemo: (fn: () => unknown) => fn(),
}))
vi.mock('motion/react', () => ({ AnimatePresence: 'presence', motion: { span: 'motion-span', div: 'motion-div' }, useReducedMotion: () => h.reduce }))
vi.mock('@/client/store', () => ({
  useSession: () => ({ s: { users: [{ id: 'boss', name: '老板' }], channels: [{ id: 'channel', name: '渠道' }], types: [] }, me: { id: 'boss' }, role: { locked: true }, adminIds: new Set(['boss']), views: [], can: () => true }),
  createOrder: vi.fn(), addPayment: vi.fn(), uploadFiles: vi.fn(), salesPeople: () => [], createChannel: vi.fn(), setOrderImportance: vi.fn(),
}))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn(), cards: vi.fn() }) }))
vi.mock('@/client/prefs', () => ({ usePref: () => [h.keepGoing, vi.fn()] }))
vi.mock('@/client/fresh', () => ({ markFresh: vi.fn() }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/ui', () => ({ Avatar: 'avatar', ChannelAvatar: 'channel-avatar', Combobox: 'combo', Field: 'field', inputCls: '' }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { QuickEntry } from '@/client/QuickEntry'
import { IntakePayment } from '@/client/IntakePayment'
import { createOrder, addPayment, uploadFiles, setOrderImportance } from '@/client/store'
import { markFresh } from '@/client/fresh'
import { toast } from 'sonner'

const closed = vi.fn()
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const render = () => { h.cursor = 0; h.effects = []; return QuickEntry({ open: true, onOpenChange: closed }) }
const find = (id: string) => nodes(render()).find(n => n.props.id === id)
const saveButton = () => nodes(render()).find(n => n.props['aria-describedby'] === 'q-save-feedback')
const feedback = () => find('q-save-feedback')
const save = () => saveButton().props.onClick() as Promise<void>
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fill(paid = '') {
  find('q-title').props.onChange({ target: { value: '保留的订单' } })
  find('q-price').props.onChange({ target: { value: '800' } })
  find('q-channel-search').props.onChange('channel')
  nodes(render()).find(n => n.type === IntakePayment).props.onChange(paid, '定金')
}
async function attach(count: number) {
  const files = Array.from({ length: count }, (_, i) => new File(['image'], `shot-${i}.png`, { type: 'image/png' }))
  nodes(render()).find(n => n.props.onPaste).props.onPaste({ clipboardData: { files, items: [], getData: () => '' }, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => setTimeout(() => fn(0), 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['image'], { type: 'image/png' }) })))
  vi.stubGlobal('FileReader', class {
    result = ''; onload?: () => void
    readAsDataURL(file: File) { this.result = `data:image/png;base64,${file.name}`; this.onload?.() }
  })
  vi.mocked(createOrder).mockResolvedValue({ id: 'order-1', no: 'DD1' })
  vi.mocked(addPayment).mockResolvedValue(true)
  vi.mocked(uploadFiles).mockResolvedValue(true)
  render()
  h.cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === 'function')
})
afterEach(() => {
  h.cleanups.forEach(cleanup => cleanup())
  h.slots = []; h.effects = []; h.cleanups = []; h.reduce = false; h.keepGoing = false
  closed.mockReset(); vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllGlobals()
})

it('延迟请求按真实建单、收款、截图 N/M 显示阶段，全部确认后才成功并关闭', async () => {
  const order = deferred<{ id: string; no: string }>(), payment = deferred<boolean>(), first = deferred<boolean>(), second = deferred<boolean>()
  vi.mocked(createOrder).mockReturnValueOnce(order.promise)
  vi.mocked(addPayment).mockReturnValueOnce(payment.promise)
  vi.mocked(uploadFiles).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  fill('200'); await attach(2)
  const saving = save()
  expect(text(feedback())).toBe('正在创建订单')
  expect(saveButton().props).toMatchObject({ disabled: true, 'aria-busy': true })
  await save(); expect(createOrder).toHaveBeenCalledOnce()
  order.resolve({ id: 'order-1', no: 'DD1' }); await flush()
  expect(text(feedback())).toBe('正在保存收款')
  expect(markFresh).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  payment.resolve(true); await flush()
  expect(text(feedback())).toBe('正在上传第 1/2 张截图')
  first.resolve(true); await flush()
  expect(text(feedback())).toBe('正在上传第 2/2 张截图')
  expect(closed).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  second.resolve(true); await saving
  expect(text(feedback())).toContain('已完成')
  expect(saveButton().props['aria-busy']).toBe(false)
  expect(markFresh).toHaveBeenCalledExactlyOnceWith(['order-1'])
  expect(closed).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(800)
  expect(closed).toHaveBeenCalledExactlyOnceWith(false)
})

it('收款失败和截图部分失败后继续保存，不重复建单、记款或上传已成功文件', async () => {
  vi.mocked(addPayment).mockImplementationOnce(async (_id, _payment, options) => { options?.onResult?.({ status: 'error', message: '收款被拒绝' }); return false })
  fill('200'); await attach(2)
  await save()
  expect(feedback().props.role).toBe('alert')
  expect(text(feedback())).toContain('收款保存失败')
  expect(find('q-title').props.value).toBe('保留的订单')
  expect(uploadFiles).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  const payment = vi.mocked(addPayment).mock.calls[0][1]
  vi.mocked(uploadFiles).mockResolvedValueOnce(true).mockImplementationOnce(async (_files, _target, options) => { options?.onResult?.({ status: 'error' }); return false })
  await save()
  expect(text(feedback())).toContain('第 2/2 张截图上传失败')
  expect(vi.mocked(addPayment).mock.calls[1][1]).toBe(payment)
  const secondFile = vi.mocked(uploadFiles).mock.calls[1][0][0]
  expect(toast.success).not.toHaveBeenCalled()
  await save()
  expect(createOrder).toHaveBeenCalledOnce()
  expect(addPayment).toHaveBeenCalledTimes(2)
  expect(uploadFiles).toHaveBeenCalledTimes(3)
  expect(vi.mocked(uploadFiles).mock.calls[2][0][0]).toBe(secondFile)
  expect(text(feedback())).toContain('已完成')
})

it('创建结果不确定时保留填写内容并明确先核对，等待不会自动重建', async () => {
  vi.mocked(createOrder).mockImplementationOnce(async (_input, _via, options) => { options?.onResult?.({ status: 'uncertain' }); return null })
  fill(); await save()
  expect(text(feedback())).toContain('创建结果待确认')
  expect(text(feedback())).toContain('先在订单列表核对')
  expect(text(saveButton())).toContain('核对后重试')
  expect(find('q-title').props.value).toBe('保留的订单')
  expect(toast.success).not.toHaveBeenCalled(); expect(markFresh).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5000)
  expect(createOrder).toHaveBeenCalledOnce(); expect(closed).not.toHaveBeenCalled()
})

it('收款响应丢失时不谎报未保存，继续保存复用同一笔且保留截图', async () => {
  vi.mocked(addPayment).mockImplementationOnce(async (_id, _payment, options) => { options?.onResult?.({ status: 'uncertain' }); return false })
  fill('200'); await attach(1); await save()
  expect(text(feedback())).toContain('收款结果待确认')
  expect(text(feedback())).not.toContain('尚未保存')
  expect(feedback().props.role).toBe('status')
  expect(nodes(render()).filter(n => n.props.pics)).toHaveLength(1)
  const payment = vi.mocked(addPayment).mock.calls[0][1]
  await save()
  expect(createOrder).toHaveBeenCalledOnce()
  expect(vi.mocked(addPayment).mock.calls[1][1]).toBe(payment)
  expect(uploadFiles).toHaveBeenCalledOnce()
})

it('明确创建失败显示原因且不触发成功，修改后可以重新提交', async () => {
  vi.mocked(createOrder).mockImplementationOnce(async (_input, _via, options) => { options?.onResult?.({ status: 'error', message: '订单名称重复' }); return null })
  fill(); await save()
  expect(text(feedback())).toContain('订单名称重复')
  expect(feedback().props.role).toBe('alert')
  expect(find('q-title').props.value).toBe('保留的订单')
  expect(toast.success).not.toHaveBeenCalled()
  find('q-title').props.onChange({ target: { value: '修正名称' } })
  await save()
  expect(createOrder).toHaveBeenCalledTimes(2)
  expect(text(feedback())).toContain('已完成')
})

it('录单有新填内容时也不提示，直接关闭', () => {
  fill()
  const dialog = nodes(render()).find(n => n.type === 'dialog' && nodes(n.props.children).some(child => child.props['data-quick-entry-dialog'] !== undefined))
  dialog.props.onOpenChange(false)
  expect(nodes(render()).some(n => n.props['data-discard-confirmation'] !== undefined)).toBe(false)
  expect(closed).toHaveBeenCalledExactlyOnceWith(false)
})

it('快速成功不残留加载，连续录单保留渠道计数，关闭回执后回到层次选择', async () => {
  h.keepGoing = true
  fill()
  // 连续录单从「层次」开始：按 Z/B/N 选完再跳到订单名称
  const focus = vi.fn(); find('q-level').props.ref.current = { focus }
  await save()
  expect(text(feedback())).toContain('已完成')
  expect(saveButton().props['aria-busy']).toBe(false)
  expect(addPayment).not.toHaveBeenCalled(); expect(uploadFiles).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(801)
  expect(find('q-title').props.value).toBe('')
  expect(find('q-channel-search').props.value).toBe('channel')
  expect(text(render())).toContain('本次已录 1 单')
  expect(text(feedback())).toBe('')
  expect(saveButton().props.disabled).toBe(false)
  expect(focus).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
  const receipt = find('q-share-receipt')
  nodes(receipt).find(n => n.type === 'button' && text(n) === '继续录单').props.onClick()
  receipt.props.onCloseAutoFocus({ preventDefault: vi.fn() })
  expect(focus).toHaveBeenCalledOnce()
})

it('成功等待或请求未完成时卸载，都不会留下计时器或迟到的关闭动作', async () => {
  fill(); await save()
  h.cleanups.forEach(cleanup => cleanup())
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(closed).not.toHaveBeenCalled()
  h.slots = []
  render(); h.cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === 'function')
  const order = deferred<{ id: string; no: string }>()
  vi.mocked(createOrder).mockReturnValueOnce(order.promise)
  fill(); const saving = save()
  h.cleanups.forEach(cleanup => cleanup())
  order.resolve({ id: 'order-2', no: 'DD2' }); await saving
  expect(vi.getTimerCount()).toBe(0)
  expect(closed).not.toHaveBeenCalled()
})

it('减少动态效果下保留阶段文字，取消旋转、计数位移和截图平滑滚动', async () => {
  h.reduce = true; h.keepGoing = true
  const order = deferred<{ id: string; no: string }>()
  vi.mocked(createOrder).mockReturnValueOnce(order.promise)
  fill(); await attach(1)
  const scrollIntoView = vi.fn()
  nodes(render()).find(n => n.type === 'form').props.ref.current = { querySelector: () => ({ scrollIntoView }), scrollTo: vi.fn() }
  find('q-more').props.onAnimationComplete({ height: 'auto' })
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
  const saving = save()
  expect(text(feedback())).toBe('正在创建订单')
  expect(nodes(feedback()).some(n => n.props.className?.includes('animate-spin'))).toBe(false)
  order.resolve({ id: 'order-1', no: 'DD1' }); await saving
  await vi.advanceTimersByTimeAsync(801)
  const count = nodes(render()).find(n => n.type === 'motion-span')
  expect(count.props.initial).toEqual({ opacity: 0 })
  expect(text(count)).toContain('本次已录 1 单')
})

it('录单先选专科、勾「重要」：订单名带「专」，建好后用同一单号标记重要并带上说明', async () => {
  vi.mocked(setOrderImportance).mockResolvedValue(true)
  fill()
  nodes(render()).find(n => n.props.role === 'radio' && text(n).includes('专科')).props.onClick()
  nodes(render()).find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && text(n).includes('重要')).props.onClick()
  nodes(render()).find(n => n.props['aria-label'] === '重要说明').props.onChange({ target: { value: '同学介绍的单' } })
  await save()
  expect(vi.mocked(createOrder).mock.calls[0][0]).toMatchObject({ title: '专 保留的订单' })
  expect(setOrderImportance).toHaveBeenCalledExactlyOnceWith('order-1', true, '同学介绍的单')
})

it('没勾「重要」不额外调用标记', async () => {
  fill()
  await save()
  expect(setOrderImportance).not.toHaveBeenCalled()
})
