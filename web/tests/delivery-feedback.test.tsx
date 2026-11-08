import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, cleanups: [] as (() => void)[], effects: new Set<number>(), writes: 0 }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial
    return [hooks.slots[i], (value: any) => { hooks.writes++; hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value }]
  },
  useRef: (current: any) => { const i = hooks.cursor++; return hooks.slots[i] ??= { current } },
  useEffect: (effect: () => void | (() => void)) => {
    const i = hooks.cursor++
    if (!hooks.effects.has(i)) { hooks.effects.add(i); const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup) }
  },
}))
vi.mock('@/components/ui/popover', () => ({ Popover: 'popover', PopoverContent: 'popover-content', PopoverTrigger: 'popover-trigger' }))
vi.mock('@/client/CopyOrderName', () => ({ CopyOrderName: 'copy-order-name' }))
vi.mock('@/client/ImageInputActions', () => ({ ImageInputActions: 'image-input-actions' }))
vi.mock('@/client/ImageViewer', () => ({ isImageName: () => true, thumbnailSource: (id: string) => id }))
vi.mock('@/client/store', () => ({
  useSession: () => ({ order: () => ({ title: '测试交付', attachments: [], afterSales: [] }) }),
  refreshOrders: vi.fn(), uploadDeliveryShot: vi.fn(), markDraft: vi.fn(), markDemo: vi.fn(), finishAfterSale: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }))

import { DeliveryForm } from '@/client/DeliverButton'
import { UploadState } from '@/client/UploadState'
import { markDraft, markDemo, uploadDeliveryShot } from '@/client/store'
import { FEEDBACK_MS, type ActionOptions } from '@/client/operation-feedback'
import { toast } from 'sonner'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const render = () => { hooks.cursor = 0; return DeliveryForm({ kind: 'draft', orderId: 'order', no: 'TEST' }) }
const button = (tree: any, text: string) => nodes(tree).find(n => n.props.children === text)
const states = () => nodes(render()).filter(n => n.type === UploadState).map(n => n.props.phase)
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function add(count: number) {
  let tree = render(); tree.props.onOpenChange(true); tree = render()
  nodes(tree).find(n => n.type === 'image-input-actions').props.onFiles(Array.from({ length: count }, (_, i) => new File(['image'], `shot${i}.png`, { type: 'image/png' })))
  return render()
}
function unmount() { hooks.cleanups.splice(0).forEach(cleanup => cleanup()) }

beforeEach(() => {
  vi.useFakeTimers()
  let sequence = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:feedback-${++sequence}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  unmount()
  hooks.slots = []; hooks.cursor = 0; hooks.effects.clear(); hooks.writes = 0
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

it('每张截图显示真实读取、等待、上传和保存阶段；交付确认没有百分比，成功后才延迟关闭', async () => {
  const first = deferred<string | null>(), second = deferred<string | null>(), confirm = deferred<boolean>()
  let progress: ((p: number) => void) | undefined
  vi.mocked(uploadDeliveryShot).mockImplementationOnce((_file, _target, cb) => { progress = cb; return first.promise }).mockImplementationOnce((_file, _target, cb) => { progress = cb; return second.promise })
  vi.mocked(markDraft).mockImplementation(async (_id, _proofs, opts) => { const ok = await confirm.promise; if (ok) await opts?.onConfirmed?.(); return ok })
  let tree = add(2)
  expect(states()).toEqual(['reading', 'reading'])
  nodes(tree).filter(n => n.type === 'img').forEach(n => n.props.onLoad())
  expect(states()).toEqual(['waiting', 'waiting'])
  button(render(), '确认交付').props.onClick()
  expect(states()).toEqual(['uploading', 'waiting'])
  progress?.(0.37)
  tree = render()
  const firstState = nodes(tree).find(n => n.type === UploadState)
  const visual = nodes(UploadState(firstState.props))
  expect(visual.find(n => n.props.role === 'progressbar').props['aria-valuenow']).toBe(37)
  expect(nodes(tree).find(n => n.props.role === 'status').props.children).toBe('正在上传第 1/2 张截图')
  progress?.(1)
  expect(states()).toEqual(['saving', 'waiting'])
  expect(markDraft).not.toHaveBeenCalled()
  first.resolve('file-1'); await flush()
  expect(states()).toEqual(['uploaded', 'uploading'])
  second.resolve('file-2'); await flush()
  tree = render()
  expect(states()).toEqual(['uploaded', 'uploaded'])
  expect(nodes(tree).find(n => n.props.role === 'status').props.children).toBe('正在确认交付…')
  expect(button(tree, '处理中…').props['aria-busy']).toBe(true)
  expect(nodes(tree).some(n => n.props.children === '✓ 已确认交付')).toBe(false)
  expect(toast.success).not.toHaveBeenCalled()
  confirm.resolve(true); await flush()
  tree = render()
  expect(button(tree, '✓ 已确认交付').props.disabled).toBe(true)
  expect(toast.success).toHaveBeenCalledExactlyOnceWith('订单已交付，截图已存档')
  expect(tree.props.open).toBe(true)
  await vi.advanceTimersByTimeAsync(FEEDBACK_MS.success - 1)
  expect(render().props.open).toBe(true)
  await vi.advanceTimersByTimeAsync(1)
  expect(render().props.open).toBe(false)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  expect(toast.success).toHaveBeenCalledOnce()
})

it('部分上传不确定后保留全部缩略图，重试跳过已上传文件并继续原 File 的断点', async () => {
  vi.mocked(uploadDeliveryShot)
    .mockResolvedValueOnce('file-1')
    .mockImplementationOnce(async (_file, _target, _cb, opts) => { opts?.onResult?.({ status: 'uncertain' }); return null })
    .mockResolvedValueOnce('file-2')
    .mockResolvedValueOnce('file-3')
  vi.mocked(markDraft).mockImplementation(async (_id, _proofs, opts) => { await opts?.onConfirmed?.(); return true })
  button(add(3), '确认交付').props.onClick(); await flush()
  let tree = render()
  expect(states()).toEqual(['uploaded', 'uncertain', 'reading'])
  expect(nodes(tree).filter(n => n.type === 'img')).toHaveLength(3)
  expect(nodes(tree).find(n => n.props.role === 'alert').props.children).toContain('结果尚未确认')
  expect(markDraft).not.toHaveBeenCalled()
  button(tree, '重试确认').props.onClick(); await flush()
  const calls = vi.mocked(uploadDeliveryShot).mock.calls
  expect(calls).toHaveLength(4)
  expect(calls[1][0]).toBe(calls[2][0])
  expect(calls.filter(([file]) => file === calls[0][0])).toHaveLength(1)
  expect(markDraft).toHaveBeenCalledWith('order', ['file-1', 'file-2', 'file-3'], expect.any(Object))
  await vi.advanceTimersByTimeAsync(FEEDBACK_MS.success)
  tree = render(); expect(tree.props.open).toBe(false)
})

it('明确上传失败时保留失败标记和缩略图，允许去掉失败文件', async () => {
  vi.mocked(uploadDeliveryShot).mockResolvedValue(null)
  button(add(1), '确认交付').props.onClick(); await flush()
  expect(states()).toEqual(['error'])
  const tree = render()
  expect(nodes(tree).find(n => n.props['aria-label'] === '去掉这张').props.disabled).toBe(false)
  nodes(tree).find(n => n.props['aria-label'] === '去掉这张').props.onClick()
  expect(states()).toEqual([])
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
})

it('成功停留期间卸载，清理定时器及对象 URL，并解除等待，不再更新组件状态', async () => {
  let finish: ActionOptions | undefined
  vi.mocked(uploadDeliveryShot).mockResolvedValue('file-1')
  vi.mocked(markDraft).mockImplementation(async (_id, _proofs, opts) => { finish = opts; await opts?.onConfirmed?.(); return true })
  button(add(1), '确认交付').props.onClick(); await flush()
  expect(finish?.onConfirmed).toBeTypeOf('function')
  expect(vi.getTimerCount()).toBe(2) // 接收高亮和确认成功停留均须在卸载时清理
  unmount()
  const writes = hooks.writes
  await flush()
  expect(vi.getTimerCount()).toBe(0)
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  expect(hooks.writes).toBe(writes)
})

it('确认请求期间被实时刷新卸载，收到服务端确认后仍只提示一次成功，不恢复局部状态', async () => {
  const confirmed = deferred<boolean>()
  vi.mocked(uploadDeliveryShot).mockResolvedValue('file-1')
  vi.mocked(markDraft).mockImplementation(async (_id, _proofs, opts) => { const ok = await confirmed.promise; if (ok) await opts?.onConfirmed?.(); return ok })
  button(add(1), '确认交付').props.onClick(); await flush()
  expect(markDraft).toHaveBeenCalledOnce()
  unmount()
  const writes = hooks.writes
  expect(toast.success).not.toHaveBeenCalled()
  confirmed.resolve(true); await flush()
  expect(toast.success).toHaveBeenCalledExactlyOnceWith('订单已交付，截图已存档')
  expect(hooks.writes).toBe(writes)
  expect(vi.getTimerCount()).toBe(0)
})

it('减少动态效果时缺少截图只显示错误文字，不触发抖动；真实进度仍可读取', () => {
  vi.stubGlobal('window', { matchMedia: vi.fn(() => ({ matches: true })) })
  const tree = render(), zone = nodes(tree).find(n => n.props['aria-label'] === '交付截图粘贴和拖入区域')
  const addClass = vi.fn(), removeClass = vi.fn()
  zone.props.ref.current = { classList: { add: addClass, remove: removeClass }, get offsetWidth() { throw new Error('不应触发布局读取') } }
  button(tree, '确认交付').props.onClick()
  expect(addClass).not.toHaveBeenCalled(); expect(removeClass).not.toHaveBeenCalled()
  expect(nodes(render()).find(n => n.props.role === 'alert').props.children).toEqual(['先附', '群内发稿截图'])
  const bar = nodes(UploadState({ phase: 'uploading', progress: 0.5 })).find(n => n.props.style)
  expect(bar.props.className).toContain('motion-reduce:transition-none')
})


it('订单交付默认正式交付，切到发演示仍需截图且只提交演示动作，跟进不出现演示选项', async () => {
  expect(button(render(), '正式交付').props['aria-pressed']).toBe(true)
  button(render(), '发演示').props.onClick()
  button(render(), '确认已发演示').props.onClick()
  expect(markDemo).not.toHaveBeenCalled()
  expect(markDraft).not.toHaveBeenCalled()
  vi.mocked(uploadDeliveryShot).mockResolvedValue('demo-proof')
  vi.mocked(markDemo).mockImplementation(async (_id, _proofs, opts) => { await opts?.onConfirmed?.(); return true })
  add(1)
  button(render(), '确认已发演示').props.onClick()
  await flush()
  expect(markDemo).toHaveBeenCalledWith('order', ['demo-proof'], expect.any(Object))
  expect(markDraft).not.toHaveBeenCalled()
  expect(toast.success).toHaveBeenCalledWith('已记录演示，正式交付仍待完成')
  expect(nodes(render()).some(n => n.props.children === '✓ 已记录演示')).toBe(true)
  await vi.advanceTimersByTimeAsync(FEEDBACK_MS.success)
  hooks.cursor = 0
  const followup = DeliveryForm({ kind: 'aftersale', orderId: 'order', asId: 'followup' })
  expect(nodes(followup).some(n => n.props['aria-label'] === '交付方式')).toBe(false)
})
