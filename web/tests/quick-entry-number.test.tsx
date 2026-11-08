import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as { fn: () => unknown; deps: unknown[] }[], session: {} as any, keepGoing: false }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => unknown, deps: unknown[]) => { h.effects.push({ fn, deps }) }, useMemo: (fn: () => unknown) => fn(),
}))
vi.mock('motion/react', () => ({ AnimatePresence: 'presence', motion: { span: 'motion-span', div: 'motion-div' }, useReducedMotion: () => true }))
vi.mock('@/client/store', () => ({ useSession: () => h.session, createOrder: vi.fn(), addPayment: vi.fn(), uploadFiles: vi.fn(), salesPeople: () => h.session.s.users, createChannel: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn(), cards: vi.fn() }) }))
vi.mock('@/client/prefs', () => ({ usePref: () => [h.keepGoing, vi.fn()] }))
vi.mock('@/client/fresh', () => ({ markFresh: vi.fn() }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/ui', () => ({ Avatar: 'avatar', ChannelAvatar: 'channel-avatar', Combobox: 'combo', Field: 'field', inputCls: '' }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { QuickEntry } from '@/client/QuickEntry'
import { PersonChoice } from '@/client/PersonChoice'
import { IntakePayment } from '@/client/IntakePayment'
import { CopyOrderName } from '@/client/CopyOrderName'
import { createOrder, addPayment, uploadFiles } from '@/client/store'
import { toast } from 'sonner'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const closed = vi.fn()
const render = (open = true) => { h.cursor = 0; h.effects = []; return QuickEntry({ open, onOpenChange: closed }) }
const find = (id: string) => nodes(render()).find(n => n.props.id === id)
const titleCopy = () => nodes(render()).find(n => n.type === CopyOrderName && n.props.textLabel !== '发群文案')
const saveButton = () => nodes(render()).find(n => n.props['aria-describedby'] === 'q-save-feedback')
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const hintEffect = () => { render(); return h.effects.at(-1)!.fn() as () => void }
const answer = (number: string | null, ownerId = 'boss', date = '2026-11-03', sequence = 1) => ({ ok: true, json: async () => ({ number, ownerId, date, sequence: number ? sequence : null, prefix: number?.slice(0, 2) ?? null }) })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function fill(title = '机械设计') {
  find('q-title').props.onChange({ target: { value: title } })
  find('q-price').props.onChange({ target: { value: '800' } })
  find('q-channel-search').props.onChange('channel')
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T04:00:00Z'))
  vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => setTimeout(() => fn(0), 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.stubGlobal('fetch', vi.fn(async () => answer('aj26110301')))
  const boss = { id: 'boss', name: '老板', account: 'boss', salesMode: 'commission' }
  h.session = { me: boss, s: { users: [boss, { id: 'acheng', name: '阿城', account: 'acheng', salesMode: 'commission' }], channels: [{ id: 'channel', name: '渠道' }], types: [] }, role: { locked: true }, adminIds: new Set(['boss']), views: [], can: () => true }
  vi.mocked(createOrder).mockResolvedValue({ id: 'new-order', no: 'DD2611030001', title: 'aj26110302 机械设计' })
  vi.mocked(addPayment).mockResolvedValue(true)
  vi.mocked(uploadFiles).mockResolvedValue(true)
})
afterEach(() => { h.slots = []; h.effects = []; h.keepGoing = false; vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllGlobals() })

it('自动填入短年份编号并保留先输入的名称；保存携带建议号并显示服务器最终编号', async () => {
  fill(); const stop = hintEffect(); await flush()
  expect(find('q-title').props.value).toBe('aj26110301 机械设计')
  expect(find('q-use-number')).toBeUndefined()
  expect(find('q-number-hint')).toBeUndefined()
  await saveButton().props.onClick()
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ title: 'aj26110301 机械设计', suggestedNumber: 'aj26110301' }), undefined, expect.any(Object))
  expect(text(find('q-share-receipt'))).toContain('aj26110302 机械设计')
  expect(toast.success).not.toHaveBeenCalled()
  expect(find('q-title').props.value).toBe('aj26110302 机械设计')
  stop()
})

it('仅自动填号不算未保存内容，未输入任何内容时可直接关闭', async () => {
  const stop = hintEffect(); await flush()
  expect(find('q-title').props.value).toBe('aj26110301 ')
  const entryDialog = nodes(render()).find(n => n.type === 'dialog' && nodes(n.props.children).some(child => child.props['data-quick-entry-dialog'] !== undefined))
  entryDialog.props.onOpenChange(false)
  expect(closed).toHaveBeenCalledExactlyOnceWith(false)
  expect(nodes(render()).some(n => n.props['data-discard-confirmation'] !== undefined)).toBe(false)
  stop()
})

it('只有系统自动单号不能保存为订单，补写名称后才能保存', async () => {
  const stop = hintEffect(); await flush()
  find('q-price').props.onChange({ target: { value: '800' } })
  find('q-channel-search').props.onChange('channel')
  await saveButton().props.onClick()
  expect(createOrder).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith('请填写订单名称、渠道和销售额')
  find('q-title').props.onChange({ target: { value: 'aj26110301 网络安全' } })
  await saveButton().props.onClick()
  expect(createOrder).toHaveBeenCalledOnce()
  stop()
})

it('用户主动输入纯单号仍属于真实填写内容，原样保存', async () => {
  find('q-title').props.onChange({ target: { value: 'ac26110388' } })
  const stop = hintEffect(); await flush()
  find('q-price').props.onChange({ target: { value: '800' } })
  find('q-channel-search').props.onChange('channel')
  await saveButton().props.onClick()
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ title: 'ac26110388' }), undefined, expect.any(Object))
  expect(vi.mocked(createOrder).mock.calls[0][0]).not.toHaveProperty('suggestedNumber')
  stop()
})

it('已有手工编号不叠加并原样提交', async () => {
  fill('XY2026110308 旅游管理'); const stop = hintEffect(); await flush()
  expect(titleCopy().props.title).toBe('待定 XY2026110308 旅游管理')
  expect(find('q-title').props.value).toBe('XY2026110308 旅游管理')
  find('q-title').props.onChange({ target: { value: 'aj26110380 手工指定' } })
  await saveButton().props.onClick()
  expect(vi.mocked(createOrder).mock.calls[0][0]).not.toHaveProperty('suggestedNumber')
  expect(vi.mocked(createOrder).mock.calls[0][0].title).toBe('aj26110380 手工指定')
  stop()
})

it('用户修改自动编号后，换销售不覆盖手写编号和业务名称', async () => {
  fill(); let stop = hintEffect(); await flush()
  find('q-title').props.onChange({ target: { value: 'aj26110380 手工指定 网络安全' } })
  nodes(render()).find(n => n.type === PersonChoice).props.onChange('acheng')
  vi.mocked(fetch).mockResolvedValueOnce(answer('ac26110302', 'acheng', '2026-11-03', 2) as any)
  stop(); stop = hintEffect(); await flush()
  expect(find('q-title').props.value).toBe('aj26110380 手工指定 网络安全')
  await saveButton().props.onClick()
  expect(vi.mocked(createOrder).mock.calls[0][0]).not.toHaveProperty('suggestedNumber')
  stop()
})

it('取号等待期间补写手工编号，迟到响应不能覆盖', async () => {
  const response = deferred<any>(); vi.mocked(fetch).mockReturnValueOnce(response.promise)
  fill(); const stop = hintEffect()
  expect(saveButton().props.disabled).toBe(true)
  find('q-title').props.onChange({ target: { value: '待定 XY26110308 客户原始题目' } })
  response.resolve(answer('aj26110301')); await flush()
  expect(find('q-title').props.value).toBe('待定 XY26110308 客户原始题目')
  expect(titleCopy().props.title).toBe('待定 XY26110308 客户原始题目')
  stop()
})

it('换归属销售和日期会刷新自动编号、保留名称；更新期间不提交旧编号', async () => {
  fill(); let stop = hintEffect(); await flush()
  nodes(render()).find(n => n.type === PersonChoice).props.onChange('acheng')
  expect(saveButton().props.disabled).toBe(true)
  await saveButton().props.onClick(); expect(createOrder).not.toHaveBeenCalled()
  vi.mocked(fetch).mockResolvedValueOnce(answer('ac26110305', 'acheng', '2026-11-03', 5) as any)
  stop(); stop = hintEffect(); await flush()
  expect(find('q-title').props.value).toBe('ac26110305 机械设计')
  find('q-date').props.onChange({ target: { value: '2026-11-04' } })
  expect(saveButton().props.disabled).toBe(true)
  vi.mocked(fetch).mockResolvedValueOnce(answer('ac26110401', 'acheng', '2026-11-04') as any)
  stop(); stop = hintEffect(); await flush()
  expect(find('q-title').props.value).toBe('ac26110401 机械设计')
  expect(saveButton().props.disabled).toBe(false)
  expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toContain('ownerId=acheng&date=2026-11-04')
  stop()
})

it('迟到的请求和关闭后的响应不覆盖当前建议或名称', async () => {
  const first = deferred<any>(); vi.mocked(fetch).mockReturnValueOnce(first.promise)
  fill(); const firstStop = hintEffect()
  nodes(render()).find(n => n.type === PersonChoice).props.onChange('acheng')
  vi.mocked(fetch).mockResolvedValueOnce(answer('ac26110302', 'acheng', '2026-11-03', 2) as any)
  firstStop(); const secondStop = hintEffect(); await flush()
  first.resolve(answer('aj26110301')); await flush()
  expect(find('q-title').props.value).toBe('ac26110302 机械设计')
  secondStop()
  const late = deferred<any>(); vi.mocked(fetch).mockReturnValueOnce(late.promise)
  const lateStop = hintEffect(); lateStop(); render(false)
  late.resolve(answer('ac26110309', 'acheng', '2026-11-03', 9)); await flush()
  expect(find('q-title').props.value).toBe('ac26110302 机械设计')
})

it('取号失败仍能手填保存，未设前缀的人员不显示无效建议', async () => {
  fill(); let stop = hintEffect(); await flush()
  find('q-date').props.onChange({ target: { value: '2026-11-04' } })
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
  stop(); stop = hintEffect(); await flush()
  expect(find('q-title').props.value).toBe('机械设计')
  expect(text(render())).toContain('可手动填写名称')
  expect(saveButton().props.disabled).toBe(false)
  stop(); vi.mocked(fetch).mockResolvedValueOnce(answer(null, 'boss', '2026-11-04') as any)
  stop = hintEffect(); await flush()
  expect(find('q-number-hint')).toBeUndefined()
  await saveButton().props.onClick()
  expect(vi.mocked(createOrder).mock.calls[0][0]).not.toHaveProperty('suggestedNumber')
  stop()
})

it('连续录单下一单自动使用新单号且保留渠道', async () => {
  h.keepGoing = true
  fill(); let stop = hintEffect(); await flush()
  await saveButton().props.onClick(); await vi.advanceTimersByTimeAsync(801)
  expect(find('q-title').props.value).toBe('')
  expect(find('q-channel-search').props.value).toBe('channel')
  render(); expect(h.effects.at(-1)!.deps).toContain(1)
  vi.mocked(fetch).mockResolvedValueOnce(answer('aj26110303', 'boss', '2026-11-03', 3) as any)
  stop(); stop = hintEffect(); await flush()
  expect(find('q-title').props.value).toBe('aj26110303 ')
  stop()
})

it('名称框右侧只有图标复制，未付款文案带待定和类型但不改真实标题', async () => {
  fill('网络安全'); const stop = hintEffect(); await flush()
  nodes(render()).find(n => n.type === 'button' && text(n).includes('更多信息')).props.onClick()
  find('q-type').props.onChange('论文')
  expect(find('q-title').props.className).toContain('text-base')
  expect(find('q-title').props.className).toContain('pr-12')
  expect(titleCopy().props.title).toBe('待定 aj26110301 网络安全 论文')
  expect(titleCopy().props.label).toBeUndefined()
  expect(find('q-title').props.value).toBe('aj26110301 网络安全')
  nodes(render()).find(n => n.type === IntakePayment).props.onChange('400', '定金')
  expect(titleCopy().props.title).toBe('aj26110301 网络安全 论文')
  expect(find('q-title').props.value).toBe('aj26110301 网络安全')
  stop()
})

it('居中成功回执使用最终单号和实际定金，只保留一个图标复制且关闭录单后仍可用', async () => {
  vi.mocked(createOrder).mockResolvedValueOnce({ id: 'new-order', no: 'DD2611030001', title: 'aj26110302 网络安全' })
  fill('网络安全'); const stop = hintEffect(); await flush()
  nodes(render()).find(n => n.type === IntakePayment).props.onChange('400', '定金')
  await saveButton().props.onClick()
  const receipt = find('q-share-receipt'), expected = 'aj26110302 网络安全 全款800 定金400已付'
  expect(text(receipt)).toContain(expected)
  expect(receipt.props.className).toContain('top-1/2')
  expect(receipt.props.className).toContain('-translate-y-1/2')
  expect(nodes(receipt).filter(n => n.type === CopyOrderName)).toHaveLength(1)
  expect(nodes(receipt).find(n => n.type === CopyOrderName).props.label).toBeUndefined()
  expect(nodes(receipt).find(n => n.type === CopyOrderName).props.title).toBe(expected)
  expect(vi.mocked(createOrder).mock.calls[0][0].title).toBe('aj26110301 网络安全')
  expect(vi.mocked(addPayment).mock.calls[0][1]).toMatchObject({ amount: 400, tag: '定金' })
  expect(toast.success).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(800)
  const receiptDialog = nodes(render(false)).find(n => n.type === 'dialog' && nodes(n.props.children).some(child => child.props.id === 'q-share-receipt'))
  expect(receiptDialog.props.open).toBe(true)
  stop()
})

it('没收定金只在复制文案中标待定，不猜定金金额、不污染真实订单名称', async () => {
  vi.mocked(createOrder).mockResolvedValueOnce({ id: 'new-order', no: 'DD2611030001', title: 'aj26110302 网络安全' })
  fill('网络安全'); const stop = hintEffect(); await flush()
  await saveButton().props.onClick()
  expect(nodes(find('q-share-receipt')).find(n => n.type === CopyOrderName).props.title).toBe('待定 aj26110302 网络安全 全款800 定金未付')
  expect(vi.mocked(createOrder).mock.calls[0][0].title).toBe('aj26110301 网络安全')
  expect(find('q-title').props.value).toBe('aj26110302 网络安全')
  expect(addPayment).not.toHaveBeenCalled()
  stop()
})

it('收款或截图未成功时不生成发群成功文案，完成重试后使用同单已确认金额', async () => {
  vi.stubGlobal('FileReader', class { result = ''; onload?: () => void; readAsDataURL() { this.result = 'data:image/png;base64,proof'; this.onload?.() } })
  vi.mocked(fetch).mockImplementation(async input => String(input).startsWith('data:') ? { blob: async () => new Blob(['image'], { type: 'image/png' }) } as any : answer('aj26110301') as any)
  fill(); nodes(render()).find(n => n.type === IntakePayment).props.onChange('400', '定金')
  nodes(render()).find(n => n.props.onPaste).props.onPaste({ clipboardData: { files: [new File(['image'], 'shot.png', { type: 'image/png' })], items: [], getData: () => '' }, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  await flush()
  vi.mocked(addPayment).mockImplementationOnce(async (_id, _payment, opts) => { opts?.onResult?.({ status: 'error' }); return false })
  await saveButton().props.onClick()
  expect(find('q-share-receipt')).toBeUndefined(); expect(toast.success).not.toHaveBeenCalled()
  vi.mocked(uploadFiles).mockImplementationOnce(async (_files, _target, opts) => { opts?.onResult?.({ status: 'error' }); return false })
  await saveButton().props.onClick()
  expect(find('q-share-receipt')).toBeUndefined(); expect(toast.success).not.toHaveBeenCalled()
  await saveButton().props.onClick()
  expect(createOrder).toHaveBeenCalledOnce()
  expect(addPayment).toHaveBeenCalledTimes(2)
  expect(nodes(find('q-share-receipt')).find(n => n.type === CopyOrderName).props.title).toBe('aj26110302 机械设计 全款800 定金400已付')
})

it('连续录单清空下一单表单后，上单文案仍可复制且不会被新草稿金额覆盖', async () => {
  h.keepGoing = true; fill(); nodes(render()).find(n => n.type === IntakePayment).props.onChange('400', '定金')
  await saveButton().props.onClick(); await vi.advanceTimersByTimeAsync(801)
  expect(find('q-title').props.value).toBe('')
  fill('下一单'); find('q-price').props.onChange({ target: { value: '900' } })
  const receipt = find('q-share-receipt')
  expect(nodes(receipt).find(n => n.type === CopyOrderName).props.title).toBe('aj26110302 机械设计 全款800 定金400已付')
})

it('没有收款权限不推断未付，发群文案复制保留原组件的手动选择兜底', async () => {
  h.session.can = (permission: string) => permission !== 'payment.create'
  fill(); const stop = hintEffect(); await flush()
  expect(titleCopy().props.title).toBe('aj26110301 机械设计')
  await saveButton().props.onClick()
  const copied = nodes(find('q-share-receipt')).find(n => n.type === CopyOrderName)
  expect(copied.props.title).toBe('aj26110302 机械设计 全款800')
  stop()
  h.slots = []; h.cursor = 0
  const copyTree = CopyOrderName(copied.props)
  expect(nodes(copyTree).find(n => n.type === 'input').props).toMatchObject({ value: 'aj26110302 机械设计 全款800', readOnly: true, 'aria-label': '发群文案，可手动复制' })
  expect(nodes(copyTree).find(n => n.type === 'button').props['aria-label']).toBe('复制发群文案')
})
