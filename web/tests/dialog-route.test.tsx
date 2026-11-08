import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ path: '/orders', query: '', cursor: 0, slots: [] as any[], queue: [] as (() => void)[], effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), push: vi.fn(), replace: vi.fn(), events: new Map<string, () => void>() }))
vi.mock('next/navigation', () => ({ usePathname: () => h.path, useSearchParams: () => new URLSearchParams(h.query), useRouter: () => ({ push: h.push, replace: h.replace }) }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (value: unknown) => { h.slots[i] = value }] },
  useRef: (value: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: value } },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((d, j) => d !== old.deps[j])) h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) },
}))
import { DialogRouteProvider } from '@/client/useDialogRoute'
import { forumPostFromPath, forumPostPath, pageFromPath, PAGE_PATHS } from '@/client/page-route'
function render() {
  h.cursor = 0; h.queue = []
  const element = DialogRouteProvider({ children: null })
  for (const run of h.queue) run()
  return element.props.value
}
beforeEach(() => {
  h.path = '/orders'; h.query = ''; h.slots = []; h.effects.clear(); h.events.clear()
  vi.stubGlobal('window', { addEventListener: (name: string, fn: () => void) => h.events.set(name, fn), removeEventListener: (name: string) => h.events.delete(name) })
})
afterEach(() => { for (const effect of h.effects.values()) effect.cleanup?.(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('刷新读取设置与记录参数，设置和业务弹窗互斥且不遗留旧记录', () => {
  h.query = 'dialog=reimburse&reimburseId=old&followupOrder=old-order'
  const route = render()
  expect(route.dialog).toBe('reimburse'); expect(route.get('reimburseId')).toBe('old')
  route.openSettings('password')
  expect(render().settings).toBe('password'); expect(render().dialog).toBeNull()
  expect(h.push).toHaveBeenLastCalledWith('/orders?settings=password', { scroll: false })
  render().openDialog('followup', { followupOrder: 'mine' })
  expect(render().get('followupOrder')).toBe('mine'); expect(render().get('reimburseId')).toBeNull()
  render().closeDialog()
  expect(h.replace).toHaveBeenLastCalledWith('/orders', { scroll: false })
})

it('慢路由中快速打开再关闭，迟到的打开地址不能把弹窗重新打开', () => {
  render().openDialog('checkin')
  expect(render().dialog).toBe('checkin')
  render().closeDialog()
  expect(render().dialog).toBeNull()
  h.query = 'dialog=checkin'
  expect(render().dialog).toBeNull()
  h.query = ''
  expect(render().dialog).toBeNull()
  expect(render().dialog).toBeNull()
  expect(h.push).toHaveBeenCalledTimes(1); expect(h.replace).toHaveBeenCalledTimes(1)
})

it('同值不重复导航，浏览器后退按真实网址关闭弹窗', () => {
  render().openSettings('profile'); render().openSettings('profile')
  expect(h.push).toHaveBeenCalledTimes(1)
  h.query = 'settings=profile'; render(); render()
  h.query = ''; h.events.get('popstate')!()
  expect(render().settings).toBeNull()
  h.path = '/tasks'
  expect(render().dialog).toBeNull()
})

it('使用用户要求的正式网址，论坛详情可来回解析', () => {
  expect(PAGE_PATHS.settle).toBe('/payroll'); expect(PAGE_PATHS.toolbox).toBe('/tools')
  expect(PAGE_PATHS.roles).toBe('/admin/accounts')
  expect(pageFromPath('/admin/audit')).toBe('audit')
  expect(pageFromPath('/forum/post-123')).toBe('forum')
  expect(forumPostFromPath(forumPostPath('post-123'))).toBe('post-123')
  expect(forumPostFromPath('/forum')).toBeNull()
})
