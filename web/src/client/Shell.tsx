import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PAGE_PATHS, ADMIN_PAGES, sidebarPage } from './page-route'
import { usePref } from './prefs'
import { useAfterSaleTasks } from './after-sale-data'
import { useEffect, type ComponentType } from 'react'
import { motion } from 'motion/react'
import {
  House,
  ListChecks,
  Sparkle,
  ClipboardText, Images, Scales,
  Storefront,
  Wallet,
  Toolbox,
  ShieldCheck,
  ClockCounterClockwise,
  Trash,
  SidebarSimple,
  Coins,
  Receipt,
  GearSix,
  ChatsCircle,
  CaretDown,
  Bank,
  ChatText,
  ImageSquare,
  Wrench,
  type IconProps,
} from '@phosphor-icons/react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useNav, type Page } from './nav'
import { useSession, useWorkspaceStatus } from './store'
import { FORUM_COPY } from '@/shared/copy/forum'
import { SidebarCorner } from './forum/Corner'
import type { PermKey } from '@/shared/types'
import { useWorkData } from './work-materials/data'
import { Keys, goKeyFor } from './shortcuts'

interface Item {
  page: Page
  label: string
  icon: ComponentType<IconProps>
  perm?: PermKey
  /** 除了权限点之外的显示条件（比如结算：能管结算，或自己有结算单） */
  show?: (x: ReturnType<typeof useSession>) => boolean
}

type NavDrawer = { id: 'materials' | 'finance' | 'admin'; label: string; icon: ComponentType<IconProps>; items: Item[] }
type NavEntry = Item | NavDrawer
const isDrawer = (entry: NavEntry): entry is NavDrawer => 'items' in entry

const MAIN: NavEntry[] = [
  { page: 'home', label: '工作台', icon: House },
  { page: 'orders', label: '订单', icon: ClipboardText, perm: 'order.view' },
  { page: 'inquiries', label: '意向单', icon: ClipboardText, perm: 'order.create' },
  { page: 'channels', label: '渠道', icon: Storefront, perm: 'channel.view' },
  { page: 'reviews', label: '奖惩', icon: Scales, show: x => x.role.locked || (x.can('order.view') && x.me.canWrite) },
  { page: 'tasks', label: '任务', icon: ListChecks, perm: 'order.view' },
  { id: 'materials', label: '素材', icon: Images, items: [
    { page: 'cases', label: '案例', icon: ImageSquare, perm: 'order.view' },
    { page: 'talk', label: '话术', icon: ChatText, perm: 'order.view' },
  ] },
  { id: 'finance', label: '财务', icon: Bank, items: [
    { page: 'income', label: '收入', icon: Wallet },
    { page: 'contractors', label: '外包合作方', icon: Storefront, show: x => x.role.locked },
    { page: 'settle', label: '工资结算', icon: Coins, show: (x) => x.can('settle.manage') },
  ] },
  { page: 'toolbox', label: '工具箱', icon: Toolbox, perm: 'toolbox.use' },
  { page: 'assistant', label: '智能助手', icon: Sparkle, perm: 'order.view' },
  { page: 'forum', label: FORUM_COPY.forum.nav, icon: ChatsCircle },
]
/** 排序用的页面：抽屉按第一个子页面定位。 */
export const navEntryPages = (entry: NavEntry): Page[] => isDrawer(entry) ? entry.items.map(item => item.page) : [entry.page]
/** 按管理员保存的顺序排列；没列到的按默认顺序排在后面。 */
export function orderedNav(saved: string[]) {
  const order = saved.filter(page => page !== 'talk').map(page => page === 'feedback' ? 'forum' : page)
  const rank = (entry: NavEntry) => {
    const index = order.indexOf(navEntryPages(entry)[0])
    return index < 0 ? order.length + MAIN.indexOf(entry) : index
  }
  return [...MAIN].sort((a, b) => rank(a) - rank(b))
}
export const ADMIN: Item[] = [
  { page: 'settings', label: '系统设置', icon: GearSix, perm: 'options.manage' },
  { page: 'roles', label: '角色与账号', icon: ShieldCheck, perm: 'role.manage' },
  { page: 'audit', label: '审计日志', icon: ClockCounterClockwise, perm: 'audit.view' },
  { page: 'trash', label: '回收站', icon: Trash, perm: 'trash.view' },
]

const allowed = (x: ReturnType<typeof useSession>, i: Item) => (!ADMIN_PAGES.includes(i.page) || x.role.locked) && (!i.show || i.show(x)) && (i.page === 'assistant' ? x.can('order.view') || x.can('order.create') : !i.perm || x.can(i.perm) || i.page === 'toolbox' && (x.can('toolbox.manage') || x.can('points.manage')))
/** 当前账号能进的页面，侧栏、搜索面板和快捷键共用 */
export const NAV_ITEMS = [...MAIN.flatMap(entry => isDrawer(entry) ? entry.items : [entry]), ...ADMIN]
export function visiblePages(x: ReturnType<typeof useSession>) { return NAV_ITEMS.filter((i) => allowed(x, i)) }

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg?v=flower-20261026" width={32} height={32} alt="笔下工单" className="shrink-0" />
      {!compact && (
        <span className="min-w-0 whitespace-nowrap text-[17px] font-semibold tracking-tight wide:text-[19px]">笔下工单</span>
      )}
    </div>
  )
}

function NavList({ collapsed, onPick }: { collapsed?: boolean; onPick?: () => void }) {
  const router = useRouter()
  const { page, prepare, preload } = useNav()
  const workspaceReady = useWorkspaceStatus() === 'ready'
  const ses = useSession()
  const { tasks } = useAfterSaleTasks()
  const activeCount = tasks.filter(a=>!a.doneAt&&!a.cancelledAt).length
  const { s } = ses
  const canReview = workspaceReady && (ses.role.locked || (ses.can('order.view') && ses.me.canWrite))
  const { data: reviewCount, reload: refreshReviewCount } = useWorkData<number>(canReview ? '/api/reviews?count' : null, ses.me.id, s.version)
  useEffect(() => {
    window.addEventListener('bxsh:review-updated', refreshReviewCount)
    return () => window.removeEventListener('bxsh:review-updated', refreshReviewCount)
  }, [refreshReviewCount])
  const [adminOpen, setAdminOpen] = usePref('sidebar.admin-open', false)
  const [materialsOpen, setMaterialsOpen] = usePref('sidebar.materials-open', false)
  const [financeOpen, setFinanceOpen] = usePref('sidebar.finance-open', false)
  const drawerState = { admin: [adminOpen, setAdminOpen], materials: [materialsOpen, setMaterialsOpen], finance: [financeOpen, setFinanceOpen] } as const
  useEffect(() => {
    if (ADMIN_PAGES.includes(page)) setAdminOpen(true)
    if (page === 'cases' || page === 'talk') setMaterialsOpen(true)
    if (page === 'income' || page === 'settle') setFinanceOpen(true)
  }, [page])
  const render = (items: Item[]) =>
    items
      .filter((i) => allowed(ses, i))
      .map((i) => {
        // 「交付跟进」属于任务，工作台保留独立入口。
        const active = sidebarPage(page) === i.page
        const label = i.label
        const Icon = i.icon
        const btn = (
          <Link
            href={PAGE_PATHS[i.page]}
            prefetch={false}
            key={i.page}
            data-nav={i.page}
            onPointerEnter={() => { if (!active && workspaceReady) { preload?.(i.page); router.prefetch(PAGE_PATHS[i.page]) } }}
            onFocus={() => { if (!active && workspaceReady) { preload?.(i.page); router.prefetch(PAGE_PATHS[i.page]) } }}
            aria-label={i.page === 'reviews' && reviewCount ? label + '，' + reviewCount + ' 条待处理' : label}
            aria-current={active ? 'page' : undefined}
            onNavigate={() => {
              prepare?.(i.page)
              onPick?.()
            }}
            className={cn(
              'group relative flex h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors wide:h-9 wide:text-sm',
              active ? 'text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            {active && (
              <motion.span layoutId={collapsed ? 'nav-active-c' : onPick ? 'nav-active-m' : 'nav-active'} className="absolute inset-0 rounded-md border bg-card shadow-sm" />
            )}
            <Icon size={17} className={cn('relative shrink-0', active && 'text-primary')} />
            {collapsed && i.page === 'reviews' && !!reviewCount && <span className="absolute right-0 top-0 rounded-full bg-primary/15 px-1 text-[10px] leading-tight text-primary">{reviewCount}</span>}
            {!collapsed && <span className="relative flex flex-1 items-center justify-between truncate">{label}{i.page === 'reviews' && !!reviewCount && <span className="ml-2 rounded-full bg-primary/10 px-2 text-xs text-primary">{reviewCount}</span>}{i.page==='tasks'&&workspaceReady&&activeCount>0&&<span className="ml-2 rounded-full bg-primary/10 px-2 text-xs text-primary">{activeCount}</span>}</span>}
            {!collapsed && !onPick && goKeyFor(i.page) && <Keys keys={['G', goKeyFor(i.page)!.toUpperCase()]} className="relative hidden gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 md:inline-flex" />}
          </Link>
        )
        return collapsed ? (
          <Tooltip key={i.page}>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent side="right">{i.label}{goKeyFor(i.page) && <span className="ml-2 text-muted-foreground">G {goKeyFor(i.page)!.toUpperCase()}</span>}</TooltipContent>
          </Tooltip>
        ) : (
          btn
        )
      })
  return (
    <nav aria-label="工作台导航" className="flex flex-col gap-0.5">
      {[...orderedNav(s.navOrder), { id: 'admin', label: '管理', icon: Wrench, items: ADMIN } as NavDrawer].map(entry => {
        if (!isDrawer(entry)) return render([entry])
        const visible = entry.items.filter(item => allowed(ses, item))
        if (visible.length < 2) return render(visible)
        const [open, setOpen] = drawerState[entry.id]
        if (collapsed) return <div key={entry.id} className={cn('flex flex-col gap-0.5', entry.id === 'admin' && 'mt-3 border-t pt-3')}>{render(visible)}</div>
        const holdsActive = visible.some(item => sidebarPage(page) === item.page)
        const Icon = entry.icon
        return <div key={entry.id} className="flex flex-col gap-0.5">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring wide:h-9 wide:text-sm', !open && holdsActive ? 'text-foreground' : 'text-muted-foreground')}>
            <Icon size={17} className={cn('shrink-0', !open && holdsActive && 'text-primary')}/><span className="flex-1 text-left">{entry.label}</span><CaretDown size={13} className={cn('transition-transform', !open && '-rotate-90')} />
          </button>
          <div className="nav-disclosure" data-open={open} inert={!open} aria-hidden={!open}><div className="min-h-0 overflow-hidden"><div className="flex flex-col gap-0.5 pl-3">{render(visible)}</div></div></div>
        </div>
      })}
    </nav>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <motion.aside
      animate={{ width: collapsed ? 56 : 224 }}
      className="hidden shrink-0 flex-col border-r bg-sidebar md:flex"
      initial={false}
    >
      <div className={cn('flex h-14 items-center px-3 wide:h-16', collapsed ? 'justify-center' : 'justify-between')}>
        <Logo compact={collapsed} />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <NavList collapsed={collapsed} />
      </div>
      <div className="px-2 pb-1 empty:hidden"><SidebarCorner collapsed={collapsed} /></div>
      <div className={cn('flex p-2 pt-1', collapsed ? 'justify-center' : 'justify-end')}>
        <button
          onClick={onToggle}
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={collapsed ? '展开导航' : '收起导航'}
        >
          <SidebarSimple size={17} />
        </button>
      </div>
    </motion.aside>
  )
}

export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-64 flex-col overflow-y-auto bg-sidebar p-3">
        <SheetTitle className="sr-only">导航</SheetTitle>
        <div className="mb-4 px-1 pt-1">
          <Logo />
        </div>
        <NavList onPick={() => onOpenChange(false)} />
        <div className="mt-4 space-y-3 border-t pt-3">
          <button type="button" onClick={() => { onOpenChange(false); window.dispatchEvent(new CustomEvent('bxsh:reimbursement-entry')) }} className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-accent"><Receipt size={17}/>报销</button>
        </div>
        <div className="mt-4 empty:hidden"><SidebarCorner onPick={() => onOpenChange(false)} /></div>
      </SheetContent>
    </Sheet>
  )
}
