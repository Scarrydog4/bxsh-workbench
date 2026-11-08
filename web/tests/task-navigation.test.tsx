import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  slots: [] as any[], cursor: 0,
  effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), queue: [] as (() => void)[],
  workspace: 'ready', routeState: {} as any, dialog: null as string | null, hold: false, push: vi.fn(), replace: vi.fn(), prefs: {} as Record<string, any>, session: {} as any, nav: {} as any, tasks: [] as any[],
}))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn, useContext: (ctx: any) => ctx.displayName === 'WorkspacePageContext' ? h.routeState : h.nav,
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((v, j) => v !== old.deps[j])) h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) },
}))
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname, useRouter: () => ({ push: h.push, replace: h.replace }) }))
vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('@/client/useDialogRoute', () => ({ useDialogRoute: () => ({ dialog: h.dialog, openDialog: (kind: string) => { h.dialog = kind }, closeDialog: () => { h.dialog = null } }) }))
vi.mock('@/components/ui/app-dialog', () => ({ AppDialogLoading: 'dialog-loading' }))
vi.mock('next/dynamic', () => ({ default: () => 'dynamic-page' }))
vi.mock('motion/react', () => ({ motion: { aside: 'aside', span: 'span' }, MotionConfig: 'motion-config' }))
vi.mock('sonner', () => ({ Toaster: 'toaster', toast: { error: vi.fn() } }))
vi.mock('@/client/store', () => ({ useSession: () => h.session, useWorkspaceStatus: () => h.workspace, refresh: vi.fn(), getState: () => ({ orders: [] }), logView: vi.fn() }))
vi.mock('@/client/after-sale-data', () => ({ useAfterSaleTasks: () => ({ tasks: h.tasks }) }))
vi.mock('@/client/prefs', () => ({ usePref: (key: string, fallback: unknown) => [h.prefs[key] ?? fallback, (next: unknown) => { h.prefs[key] = next }] }))
vi.mock('@/client/page-loaders', () => ({ pageLoaders: {}, preloadPage: vi.fn() }))
vi.mock('@/client/Topbar', () => ({ Topbar: 'topbar' }))
vi.mock('@/client/Dashboard', () => ({ Dashboard: 'dashboard' }))
vi.mock('@/client/TasksPage', () => ({ TasksPage: 'tasks-page', TaskTabs: 'task-tabs' }))
vi.mock('@/client/AiIntakeHost', () => ({ AiIntakeHost: 'intake-host' }))
vi.mock('@/client/forum/Corner', () => ({ SidebarCorner: 'sidebar-corner' }))
vi.mock('@/client/shortcuts', () => ({ GO_KEYS: [], ShortcutsDialog: 'shortcuts', plainKey: () => false, Keys: 'keys', goKeyFor: () => undefined }))
vi.mock('@/components/ui/sheet', () => ({ Sheet: 'sheet', SheetContent: 'sheet-content', SheetTitle: 'sheet-title' }))
vi.mock('@/components/ui/tooltip', () => ({ Tooltip: 'tooltip', TooltipContent: 'tooltip-content', TooltipTrigger: 'tooltip-trigger', TooltipProvider: 'tooltip-provider' }))

import AppShell from '@/client/AppShell'
import { MobileNav, navEntryPages, orderedNav, Sidebar, visiblePages } from '@/client/Shell'
import { WorkspacePage, WorkspacePageContext } from '@/client/WorkspacePage'
import { pageFromPath } from '@/client/page-route'
import { NavContext } from '@/client/nav'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const writer = (id = 'writer-a') => ({ me: { id, roleId: 'writer', canWrite: true }, role: { locked: false, perms: ['order.view'] }, s: { navOrder: [] }, can: (perm: string) => perm === 'order.view' })
function render() {
  h.cursor = 0; h.queue = []
  const marker: any = { type: 'route-page', props: {} }
  const tree = AppShell({ children: marker })
  h.nav = nodes(tree).find(n => n.type === NavContext.Provider).props.value
  const provider = nodes(tree).find(n => n.type === WorkspacePageContext.Provider)
  if (provider) { h.routeState = provider.props.value; (marker as any).props.children = WorkspacePage({ page: pageFromPath(location.pathname) }) }
  for (const run of h.queue) run()
  return tree
}
const detail = (tree: any) => nodes(tree).find(n => n.type === 'dynamic-page' && 'selectedId' in n.props)
function navigation(mobile = false) {
  const tree = mobile ? MobileNav({ open: true, onOpenChange: vi.fn() }) : Sidebar({ collapsed: false, onToggle: vi.fn() })
  const list = nodes(tree).find(n => n.type?.name === 'NavList')
  return nodes(list.type(list.props)).filter(n => n.props['data-nav'])
}
beforeEach(() => {
  WorkspacePageContext.displayName = 'WorkspacePageContext'
  h.hold = false; h.dialog = null
  h.push.mockImplementation((path: string) => { if (!h.hold) location.pathname = path })
  h.replace.mockImplementation((path: string) => { if (!h.hold) location.pathname = path })
  h.workspace = 'ready'; h.session = writer(); h.prefs = {}; h.nav = {}; h.tasks = [
    { id: 'open-a', doneAt: null }, { id: 'open-b', doneAt: null },
    { id: 'done', doneAt: '2026-10-25' }, { id: 'cancelled', cancelledAt: '2026-10-25' },
  ]
  vi.stubGlobal('window', { innerWidth: 1280, visualViewport: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  vi.stubGlobal('document', { documentElement: { style: { setProperty: vi.fn(), removeProperty: vi.fn() } } })
  vi.stubGlobal('location', { pathname: '/', search: '' })
  vi.stubGlobal('history', { pushState: vi.fn((_s, _t, path) => { location.pathname = path }), replaceState: vi.fn((_s, _t, path) => { location.pathname = path }) })
})
afterEach(() => {
  for (const effect of h.effects.values()) effect.cleanup?.()
  h.slots = []; h.cursor = 0; h.effects.clear(); h.queue = []; vi.clearAllMocks(); vi.unstubAllGlobals()
})

it('写手与老板都有任务入口，没有订单查看权限时仍不显示', () => {
  expect(visiblePages(h.session).map(i => i.page)).toContain('tasks')
  expect(visiblePages(h.session).map(i => i.page)).not.toContain('aftersales')
  expect(visiblePages({ ...h.session, me: { ...h.session.me, canWrite: false }, can: () => true }).map(i => i.page)).toContain('tasks')
  expect(visiblePages({ ...h.session, can: () => false }).map(i => i.page)).not.toContain('tasks')
})

it.each([false, true])('交付跟进只选中任务，角标只归任务；手机导航=%s', mobile => {
  render(); h.nav.afterSale('followup-a'); render()
  const list = navigation(mobile)
  expect(list.filter(n => n.props['aria-current'] === 'page').map(n => n.props['data-nav'])).toEqual(['tasks'])
  expect(text(list.find(n => n.props['data-nav'] === 'tasks'))).toBe('任务2')
  expect(text(list.find(n => n.props['data-nav'] === 'home'))).toBe('工作台')
  const taskLink = list.find(n => n.props['data-nav'] === 'tasks')
  taskLink.props.onNavigate(); location.pathname = taskLink.props.href
  const tree = render()
  expect(h.nav.page).toBe('tasks')
  expect(nodes(tree).filter(n => n.type === 'tasks-page')).toHaveLength(1)
  expect(detail(tree)).toBeUndefined()
})

it('离开跟进再从普通导航返回，不会重开之前的详情', () => {
  render(); h.nav.afterSale('followup-a')
  expect(detail(render()).props.selectedId).toBe('followup-a')
  h.nav.go('orders'); render(); h.nav.go('aftersales')
  expect(detail(render()).props.selectedId).toBeNull()
  h.nav.afterSale('followup-b')
  expect(detail(render()).props.selectedId).toBe('followup-b')
})

it('从订单切到指定跟进关闭旧订单抽屉，避免两层详情叠放', () => {
  render(); h.nav.openOrder('order-a')
  expect(nodes(render()).find(n => n.props.state?.id === 'order-a')).toBeDefined()
  h.nav.afterSale('followup-b')
  const tree = render()
  expect(detail(tree).props.selectedId).toBe('followup-b')
  expect(nodes(tree).some(n => n.props.state?.id)).toBe(false)
})

it('切换员工或角色后旧跟进选择清空', () => {
  render(); h.nav.afterSale('followup-a'); render()
  h.session = writer('writer-b'); render()
  expect(detail(render()).props.selectedId).toBeNull()
  h.nav.afterSale('followup-b'); render()
  h.session = { ...h.session, me: { ...h.session.me, roleId: 'sales' } }; render()
  expect(detail(render()).props.selectedId).toBeNull()
})


it('页面链接可直达，普通切换写入历史，后退恢复对应高亮', () => {
  location.pathname = '/orders'
  render(); expect(h.nav.page).toBe('orders')
  h.nav.go('tasks'); render()
  expect(location.pathname).toBe('/tasks')
  expect(h.push).toHaveBeenCalledTimes(1)
  expect(h.nav.page).toBe('tasks')
  location.pathname = '/orders'
  render()
  expect(h.nav.page).toBe('orders')
})

it('不能通过直接网址进入无权限管理页', () => {
  location.pathname = '/admin/accounts'
  render(); render()
  expect(h.nav.page).toBe('home')
  expect(location.pathname).toBe('/')
  expect(h.replace).toHaveBeenCalledTimes(1)
  expect(h.push).not.toHaveBeenCalled()
})


it('完整订单未到时不挂载粘贴录单，也不能通过导航回调提前录单', () => {
  h.workspace = 'loading'
  const tree = render()
  expect(nodes(tree).some(n => n.type === 'intake-host')).toBe(false)
  h.nav.newOrder()
  expect(nodes(render()).some(n => n.type === 'dynamic-page' && n.props.open && 'prefill' in n.props)).toBe(false)
  h.workspace = 'ready'
  expect(nodes(render()).some(n => n.type === 'intake-host')).toBe(true)
})


it('只有老板显示桌面与手机管理组，Link 使用正式网址并预取', () => {
  h.session = { ...writer(), role: { locked: true }, can: () => true }
  render()
  expect(navigation().some(n => n.props['data-nav'] === 'roles')).toBe(false)
  h.prefs['sidebar.admin-open'] = true
  h.prefs['sidebar.finance-open'] = true
  render()
  for (const mobile of [false, true]) {
    const list = navigation(mobile)
    expect(list.find(n => n.props['data-nav'] === 'roles').props.href).toBe('/admin/accounts')
    expect(list.find(n => n.props['data-nav'] === 'settle').props.href).toBe('/payroll')
    expect(list.every(n => n.props.prefetch)).toBe(true)
  }
  h.session = { ...writer(), can: () => true }; render()
  expect(navigation().some(n => ['settings', 'roles', 'audit', 'trash'].includes(n.props['data-nav']))).toBe(false)
})

it('路由网络尚未返回时立即高亮目标页面并遮住旧页面', () => {
  render(); h.hold = true; h.nav.go('orders')
  const tree = render()
  expect(location.pathname).toBe('/')
  expect(h.nav.page).toBe('orders')
  expect(nodes(tree).some(n => n.type === 'route-page')).toBe(false)
  expect(h.push).toHaveBeenCalledWith('/orders', { scroll: false })
})

it('录单直达链接在完整数据到达前只开可关闭的加载框', () => {
  h.workspace = 'loading'; h.dialog = 'entry'
  const tree = render(), loading = nodes(tree).find(n => n.type === 'dialog-loading')
  expect(loading.props.size).toBe('md')
  expect(nodes(tree).some(n => n.props.prefill !== undefined)).toBe(false)
  loading.props.onOpenChange(false)
  expect(h.dialog).toBeNull()
})

it('素材和财务是可展开的抽屉，按子页面保存的顺序定位', () => {
  const pages = (saved: string[]) => orderedNav(saved).flatMap(navEntryPages)
  expect(pages([]).slice(0, 9)).toEqual(['home','orders','channels','reviews','tasks','cases','talk','income','settle'])
  expect(pages(['tasks','income','cases','orders']).slice(0, 7)).toEqual(['tasks','income','settle','cases','talk','orders','home'])
  expect(orderedNav(['talk']).filter(item => item.label === '素材')).toHaveLength(1)
})

it.each([['/cases','案例'],['/talk','话术']])('素材子页面各自选中：%s', (path, label) => {
  location.pathname = path
  h.prefs['sidebar.materials-open'] = true
  render()
  for (const mobile of [false,true]) {
    const active = navigation(mobile).filter(n => n.props['aria-current'] === 'page')
    expect(active.map(n => n.props.href)).toEqual([path])
    expect(text(active[0])).toBe(label)
  }
})
