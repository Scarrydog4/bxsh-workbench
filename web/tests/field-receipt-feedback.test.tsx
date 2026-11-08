import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], reduce: false, animate: vi.fn(), addPayment: vi.fn(), confirmed: undefined as any }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (value: any) => { h.slots[i] = typeof value === 'function' ? value(h.slots[i]) : value }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (effect: () => void, deps?: any[]) => {
    const i = h.cursor++, old = h.slots[i]
    if (!old || !deps || deps.some((value, index) => !Object.is(value, old.deps[index]))) h.effects.push(() => { old?.cleanup?.(); h.slots[i] = { deps, cleanup: effect() } })
  },
}))
vi.mock('motion/react', async () => ({ ...await vi.importActual('motion/react'), useReducedMotion: () => h.reduce, animate: h.animate }))
vi.mock('@/client/store', () => ({
  addPayment: h.addPayment, getConfirmedOrder: () => h.confirmed,
  useSession: () => ({ me: { id: 'boss' }, s: { payTags: ['定金', '尾款', '全款', '退款'] }, role: { id: 'admin', locked: true, fields: { sales: true } }, can: () => true, user: () => ({ name: '老板' }) }),
}))
vi.mock('@/client/nav', () => ({ useNav: () => ({ rewrite: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

import { InlineText, PayInput, Payments, Files } from '@/client/OrderDrawer'
import { PercentInput } from '@/client/PercentInput'
import { AnimatedNumber } from '@/client/ui'
import { OperationStatus } from '@/client/operation-feedback'
import { UploadState } from '@/client/UploadState'
import { ImageInputActions } from '@/client/ImageInputActions'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
function render<T>(run: () => T, attach?: (tree: T) => void) { h.cursor = 0; h.effects = []; const tree = run(); attach?.(tree); for (const effect of h.effects) effect(); return tree }
function status(tree: any) { return nodes(tree).find(n => n.type === OperationStatus)?.props.state ?? nodes(tree).find(n => n.props.feedback)?.props.feedback.state }
const input = (tree: any) => nodes(tree).find(n => n.type === 'input')
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
beforeEach(() => { vi.useFakeTimers(); h.animate.mockImplementation(() => ({ stop: vi.fn() })) })
afterEach(() => { for (const slot of h.slots) slot?.cleanup?.(); h.slots = []; h.effects = []; h.reduce = false; h.confirmed = undefined; vi.clearAllMocks(); vi.useRealTimers() })

it('金额连续修改时旧成功不能覆盖新请求；失败保留草稿和局部错误', async () => {
  const first = deferred<boolean>(), second = deferred<boolean>()
  const onSave = vi.fn().mockReturnValueOnce(first.promise).mockImplementationOnce((_value, report) => { report({ status: 'error', message: '金额超出可修改范围' }); return second.promise })
  const props = { value: 80, onSave }, draw = () => render(() => PayInput(props))
  input(draw()).props.onChange({ target: { value: '90' } }); const request1 = input(draw()).props.onBlur()
  expect(status(draw()).status).toBe('saving')
  input(draw()).props.onChange({ target: { value: '100' } }); const request2 = input(draw()).props.onBlur()
  first.resolve(true); await request1
  expect(status(draw()).status).toBe('saving')
  second.resolve(false); await request2
  expect(status(draw())).toMatchObject({ status: 'error', message: '金额超出可修改范围' })
  props.value = 90
  expect(input(draw()).props.value).toBe('100')
  expect(onSave.mock.calls.map(call => call[0])).toEqual([90, 100])
})

it('比例输入中的草稿不被刷新覆盖，网络不确定保留内容供核对重试', async () => {
  const onSave = vi.fn().mockImplementation(async (_value, report) => { report({ status: 'uncertain', message: '结果尚未确认，请核对后重试' }); return false })
  const props = { value: .2, label: '本单比例', onSave }, draw = () => render(() => PercentInput(props))
  input(draw()).props.onChange({ target: { value: '33.33' } })
  props.value = .25
  expect(input(draw()).props.value).toBe('33.33')
  await input(draw()).props.onBlur()
  expect(status(draw()).status).toBe('uncertain')
  expect(input(draw()).props.value).toBe('33.33')
  expect(onSave).toHaveBeenCalledWith(.3333, expect.any(Function))
})

it('文本编辑保留草稿，旧请求完成不会清掉下一次编辑的内容', async () => {
  const saved = deferred<boolean>(), onSave = vi.fn().mockReturnValue(saved.promise)
  const props = { value: '原备注', editable: true, onSave }, draw = () => render(() => InlineText(props))
  nodes(draw()).find(n => n.props.onEdit).props.onEdit()
  input(draw()).props.onChange({ target: { value: '第一次修改' } }); input(draw()).props.onBlur()
  nodes(draw()).find(n => n.props.onEdit).props.onEdit()
  input(draw()).props.onChange({ target: { value: '第二次正在写' } })
  props.value = '第一次修改'; draw()
  saved.resolve(true); await flush()
  expect(input(draw()).props.value).toBe('第二次正在写')
  expect(status(draw()).status).toBe('idle')
})

it('数字首次显示、无权限值恢复和权限切换不滚动；动画终值精确并清理旧实例', () => {
  const el = { textContent: '' }, props = { value: 10.21 as number | undefined, animateOnMount: false, animationKey: 'boss', format: (n: number) => n.toFixed(2) }
  const draw = () => render(() => AnimatedNumber(props), tree => { tree.props.ref.current = el })
  draw(); expect(h.animate).not.toHaveBeenCalled(); expect(el.textContent).toBe('10.21')
  props.value = 20.39; draw()
  const options = h.animate.mock.calls[0][2], stop = h.animate.mock.results[0].value.stop
  options.onUpdate(20.389999999); options.onComplete()
  expect(el.textContent).toBe('20.39')
  props.value = undefined; draw(); expect(stop).toHaveBeenCalledOnce(); expect(el.textContent).toBe('—')
  props.value = 31.56; draw(); expect(h.animate).toHaveBeenCalledTimes(1)
  props.animationKey = 'sales'; props.value = 40; draw(); expect(h.animate).toHaveBeenCalledTimes(1); expect(el.textContent).toBe('40.00')
  h.reduce = true; props.value = 50.77; draw(); expect(h.animate).toHaveBeenCalledTimes(1); expect(el.textContent).toBe('50.77')
})

const order = () => ({ id: 'o', status: '未交付', sales: 100, received: 0, unpaid: 100, payments: [], receivables: [], attachments: [] } as any)
it('收款乐观达到已收齐时仍显示保存中，服务端成功后才给已收齐确认', async () => {
  const saved = deferred<boolean>(), onFormOpen = vi.fn(), props = { v: order(), compact: true, formOpen: true, onFormOpen }
  h.addPayment.mockReturnValue(saved.promise)
  const draw = () => render(() => Payments(props))
  const saving = nodes(draw()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
  props.v = { ...props.v, received: 100, unpaid: 0 }
  expect(status(draw())).toMatchObject({ status: 'saving', message: '正在保存收款' })
  expect(onFormOpen).not.toHaveBeenCalled()
  h.confirmed = props.v; saved.resolve(true); await saving
  expect(status(draw())).toMatchObject({ status: 'success', message: '已收齐' })
  expect(onFormOpen).toHaveBeenCalledWith(false)
  vi.advanceTimersByTime(1000); expect(status(draw()).status).toBe('idle')
})

it('收款失败和金额回滚不残留收齐确认，输入金额继续保留', async () => {
  const saved = deferred<boolean>(), onFormOpen = vi.fn(), props = { v: order(), compact: true, formOpen: true, onFormOpen }
  h.addPayment.mockImplementation((_id, _payment, options) => { options.onResult({ status: 'error', message: '收款未保存' }); return saved.promise })
  const draw = () => render(() => Payments(props))
  const saving = nodes(draw()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
  props.v = { ...props.v, received: 100, unpaid: 0 }; draw()
  props.v = order(); h.confirmed = props.v; saved.resolve(false); await saving
  expect(status(draw())).toMatchObject({ status: 'error', message: '收款未保存' })
  expect(nodes(draw()).find(n => n.props['aria-label'] === '金额').props.value).toBe('100')
  expect(onFormOpen).not.toHaveBeenCalled()
})

it('附件部分失败后保留每个文件状态，继续上传复用原批次数组', async () => {
  const first = new File(['a'], 'a.txt'), second = new File(['b'], 'b.txt'), batch = [first, second]
  const onFiles = vi.fn().mockImplementationOnce(async (files, options) => {
    options.onFile({ file: files[0], index: 0, total: 2, phase: 'uploaded' })
    options.onFile({ file: files[1], index: 1, total: 2, phase: 'error', message: '上传失败' })
    options.onResult({ status: 'error', message: '第二份上传失败，已完成的文件保留' }); return false
  }).mockResolvedValueOnce(true)
  const draw = () => render(() => Files({ v: order(), onFiles }))
  await nodes(draw()).find(n => n.type === ImageInputActions).props.onFiles(batch)
  expect(nodes(draw()).filter(n => n.type === UploadState).map(n => n.props.phase)).toEqual(['uploaded', 'error'])
  nodes(draw()).find(n => n.props.children === '继续上传').props.onClick(); await flush()
  expect(onFiles.mock.calls[1][0]).toBe(batch)
  expect(status(draw()).status).toBe('success')
})
