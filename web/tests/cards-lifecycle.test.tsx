import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], views: [{ id: 'o1', no: 'DD1', afterSales: [] }] as any[], writes: [] as any[], pending: [] as (() => void)[] }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => any, deps: any[]) => {
    const i = h.cursor++, old = h.slots[i]
    if (!old || deps.some((v, j) => v !== old.deps[j])) h.effects.push(() => { old?.cleanup?.(); h.slots[i] = { deps, cleanup: fn() } })
  },
  useMemo: (fn: () => unknown) => fn(),
}))
vi.mock('@/client/store', () => ({ useSession: () => ({ views: h.views, s: { users: [], channels: [] } }), logExport: vi.fn() }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('html-to-image', () => ({ toCanvas: vi.fn((node: any) => new Promise(resolve => { h.pending.push(() => resolve({ toBlob: (cb: any) => cb(new Blob([node.name], { type: 'image/png' })), toDataURL: () => `data:${node.name}` })) })) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
import { CardsDialog } from '@/client/Cards'
import { logExport } from '@/client/store'
import { toCanvas } from 'html-to-image'
import { toast } from 'sonner'
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
function render(open = true, stage?: any) {
  h.cursor = 0
  const tree = CardsDialog({ open, onOpenChange: vi.fn(), orderIds: ['o1'] })
  const holder = nodes(tree).find(n => n.props.ref)
  if (!open) { if (holder.props.ref.current) holder.props.ref.current.isConnected = false; holder.props.ref.current = null }
  else if (stage) holder.props.ref.current = stage
  for (const effect of h.effects.splice(0)) effect()
  return tree
}
const copy = (tree: any) => nodes(tree).find(n => n.props['aria-label'] === '复制卡片图片').props.onClick()
beforeEach(() => {
  vi.stubGlobal('document', { fonts: { ready: new Promise<void>(() => {}) } })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ClipboardItem', class { constructor(public data: any) {} })
  vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async (items: any[]) => { h.writes.push(items[0].data['image/png']); await items[0].data['image/png'] }) } })
})
afterEach(() => { h.slots = []; h.effects = []; h.writes = []; h.pending = []; vi.clearAllMocks(); vi.unstubAllGlobals() })
it('不等待远程字体且在点击同步阶段写剪贴板，图片Promise随后完成', async () => {
  const task = copy(render(true, { name: 'current', isConnected: true }))
  expect(navigator.clipboard.write).toHaveBeenCalledOnce()
  expect(toCanvas).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(h.pending).toHaveLength(1))
  expect(toCanvas).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ skipFonts: true, pixelRatio: 2 }))
  h.pending[0](); await task
  expect(await (await h.writes[0]).text()).toBe('current')
  expect(logExport).toHaveBeenCalledOnce(); expect(toast.success).toHaveBeenCalledWith('订单卡已复制')
})
it('生成未完成时关闭再开同一单，不复用脱离DOM的任务，也不提示旧任务成功', async () => {
  const old = copy(render(true, { name: 'old', isConnected: true }))
  await vi.waitFor(() => expect(h.pending).toHaveLength(1))
  render(false)
  const current = copy(render(true, { name: 'reopened', isConnected: true }))
  expect(navigator.clipboard.write).toHaveBeenCalledTimes(2)
  const stale = expect(h.writes[0]).rejects.toBeInstanceOf(Error)
  await vi.waitFor(() => expect(h.pending).toHaveLength(2))
  h.pending[0](); h.pending[1](); await Promise.all([old, current, stale])
  expect(await (await h.writes[1]).text()).toBe('reopened')
  expect(toCanvas).toHaveBeenCalledTimes(2)
  expect(logExport).toHaveBeenCalledOnce(); expect(toast.success).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled()
})
