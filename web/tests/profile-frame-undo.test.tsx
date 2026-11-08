import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), queue: [] as (() => void)[], session: {} as any }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((v, j) => v !== old.deps[j])) h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, setUserFrame: vi.fn(), setUserAvatar: vi.fn(), updateMe: vi.fn() }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('@/components/ui/app-dialog', () => ({ AppDialogContent: 'dialog-content', AppDialogBody: 'div', useAppDialogDismiss: ({ onOpenChange }: any) => ({ requestOpenChange: onOpenChange, confirmation: null }) }))
vi.mock('@/client/prefs', () => ({ usePref: (_key: string, fallback: string) => [fallback, vi.fn()] }))
vi.mock('@/components/ui/tabs', () => ({ Tabs: 'tabs', TabsContent: 'tabs-content', TabsList: 'tabs-list', TabsTrigger: 'tabs-trigger' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/ui', () => ({ Avatar: 'avatar', ImageDrop: 'image-drop', SkeletonRows: 'skeleton', inputCls: '' }))
vi.mock('@/client/AvatarFrames', () => ({ AvatarFramePicker: 'frame-picker' }))
vi.mock('sonner', () => ({ toast: { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }))
import { ProfileDialog } from '@/client/Profile'
import { setUserFrame } from '@/client/store'
import { toast } from 'sonner'

const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : n?.props ? text(n.props.children) : ''
const undo = (tree: any) => nodes(tree).find(n => n.type === 'button' && text(n) === '撤销')
const notice = (tree: any) => nodes(tree).find(n => n.props.role === 'status')
function render() {
  h.cursor = 0; h.queue = []
  const tree = ProfileDialog({ open: true, onOpenChange: vi.fn() })
  for (const effect of h.queue) effect()
  return tree
}
async function choose(frame: string) { nodes(render()).find(n => n.type === 'frame-picker').props.onPick(frame); await Promise.resolve(); return render() }
beforeEach(() => {
  vi.useFakeTimers()
  h.session = { me: { id: 'writer', name: '写手', account: 'writer', hue: 150, frame: 'none' }, role: { name: '写手' } }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  vi.mocked(setUserFrame).mockImplementation(async (_id, frame) => { h.session.me = { ...h.session.me, frame }; return true })
})
afterEach(() => {
  for (const effect of h.effects.values()) effect.cleanup?.()
  h.slots = []; h.effects.clear(); h.queue = []; vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

it('撤销按钮属于个人设置弹窗内容，蓝骑士切粉蝴蝶结后确实保存回蓝骑士', async () => {
  await choose('knight')
  let tree = await choose('bow')
  const content = nodes(tree).find(n => n.type === 'dialog-content')
  expect(notice(content)).toBeDefined(); expect(text(notice(content))).toContain('已换成 粉蝴蝶结')
  undo(content).props.onClick(); await Promise.resolve(); tree = render()
  expect(vi.mocked(setUserFrame).mock.calls).toEqual([['writer', 'knight'], ['writer', 'bow'], ['writer', 'knight']])
  expect(h.session.me.frame).toBe('knight')
  expect(text(notice(tree))).toBe('已撤销头像框更换')
  expect(undo(tree)).toBeUndefined()
  expect(toast.success).not.toHaveBeenCalled()
})

it('提示保留完整 8 秒，到期后移除提示与撤销入口', async () => {
  await choose('gold')
  await vi.advanceTimersByTimeAsync(7999)
  expect(undo(render())).toBeDefined()
  await vi.advanceTimersByTimeAsync(1)
  expect(notice(render())).toBeUndefined(); expect(undo(render())).toBeUndefined()
})

it('新选择立即清除旧提示，旧撤销回调不能覆盖仍在保存的新选择', async () => {
  const old = undo(await choose('knight'))
  let finish!: (ok: boolean) => void
  vi.mocked(setUserFrame).mockImplementationOnce((_id, frame) => { h.session.me = { ...h.session.me, frame }; return new Promise(resolve => { finish = resolve }) })
  const waiting = await choose('bow')
  expect(notice(waiting)).toBeUndefined()
  expect(toast.dismiss).toHaveBeenLastCalledWith('avatar-frame-writer')
  old.props.onClick(); await Promise.resolve()
  expect(setUserFrame).toHaveBeenCalledTimes(2)
  finish(true); await Promise.resolve()
  expect(text(notice(render()))).toContain('已换成 粉蝴蝶结')
  expect(h.session.me.frame).toBe('bow')
})
