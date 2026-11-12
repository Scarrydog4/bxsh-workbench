'use client'

import dynamic from 'next/dynamic'
import { pageLoaders, preloadPage } from './page-loaders'
import { PageLoading } from './PageLoading'
import { OrderDrawerLoading } from './OrderDrawerLoading'
import { ADMIN_PAGES, PAGE_PATHS, sidebarPage, usePageRoute } from './page-route'
import { AppDialogLoading } from '@/components/ui/app-dialog'
import { useDialogRoute } from './useDialogRoute'
import { WorkspacePageContext, WorkspaceView } from './WorkspacePage'
import { useRouter } from 'next/navigation'

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { Toaster, toast } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NavContext, type Nav, type Page } from './nav'
import { Sidebar, MobileNav, visiblePages } from './Shell'
import { GO_KEYS, ShortcutsDialog, plainKey } from './shortcuts'
import { Topbar } from './Topbar'
const CommandPalette=lazy(()=>import('./CommandPalette').then(m=>({ default: m.CommandPalette })))
const QuickEntry=lazy(()=>import('./QuickEntry').then(m=>({ default: m.QuickEntry })))
import type { CardKind } from './Cards'
const CardsDialog=dynamic(()=>import('./Cards').then(m=>m.CardsDialog))
const OrderDrawer=lazy(()=>import('./OrderDrawer').then(m=>({ default: m.OrderDrawer })))
const AssistantPage=dynamic(pageLoaders.assistant, { loading: () => <PageLoading page="assistant" /> })
const PreviewHost=dynamic(()=>import('./preview/PreviewHost').then(m=>m.PreviewHost),{ssr:false})
import { usePref } from './prefs'
import { getState, logView, useSession, useWorkspaceStatus, refresh } from './store'
import { type Prefill } from '@/shared/parse'
import { AiIntakeHost } from './AiIntakeHost'
import { RewardHost } from './rewards/RewardHost'

export default function AppShell({ children }: { children: ReactNode }) {
  const { can, me, role: safeRole } = useSession()
  const [page, setPage, route] = usePageRoute()
  const router = useRouter()
  const workspaceStatus = useWorkspaceStatus()
  useEffect(() => { if (page === 'income') preloadPage('income') }, [page, me.id, safeRole, workspaceStatus])
  const [channelId,setChannelId]=useState<string|null>(null)
  const [channelFocus,setChannelFocus]=useState(0)
  const [afterSaleId,setAfterSaleId] = useState<string|null>(null)
  const [drawer, setDrawer] = useState<{ id: string; list: string[]; tab?: string; field?: string } | null>(null)
  const dialogRoute = useDialogRoute()
  const quick = workspaceStatus === 'ready' && dialogRoute.dialog === 'entry'
  const setQuick = useCallback((open: boolean) => open ? dialogRoute.openDialog('entry') : dialogRoute.closeDialog(), [dialogRoute.openDialog, dialogRoute.closeDialog])
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [cards, setCards] = useState<{ ids: string[]; kind: CardKind } | null>(null)
  const [palette, setPalette] = useState(false)
  const [collapsed, setCollapsed] = usePref('sidebar-collapsed', false)
  const [mobileNav, setMobileNav] = useState(false)
  const [rewriteSeed, setRewriteSeed] = useState<{ orderId: string; attachmentId: string } | null>(null)

  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    const resize = () => {
      if (viewport && window.innerWidth < 640 && viewport.scale === 1) {
        root.style.setProperty('--workbench-height', `${viewport.height}px`)
        root.style.setProperty('--workbench-top', `${viewport.offsetTop}px`)
      } else {
        root.style.removeProperty('--workbench-height')
        root.style.removeProperty('--workbench-top')
      }
    }
    resize()
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    return () => {
      viewport?.removeEventListener('resize', resize)
      viewport?.removeEventListener('scroll', resize)
      window.removeEventListener('resize', resize)
      root.style.removeProperty('--workbench-height')
      root.style.removeProperty('--workbench-top')
    }
  }, [])

  const [visited,setVisited]=useState({assistant:false,quick:false,cards:false,drawer:false,palette:false})
  useEffect(()=>{setVisited(old=>{const next={assistant:old.assistant||page==='assistant',quick:old.quick||quick,cards:old.cards||!!cards,drawer:old.drawer||!!drawer,palette:old.palette||palette};return Object.keys(next).some(k=>next[k as keyof typeof next]!==old[k as keyof typeof old])?next:old})},[page,quick,!!cards,!!drawer,palette])

  const openOrder = useCallback((id: string, list?: string[], tab?: string, field?: string) => {
    setDrawer({ id, list: list ?? [id], tab, field })
  }, [])

  const nav: Nav = useMemo(
    () => ({
      page,
      preload: preloadPage,
      prepare: (p) => {
        setChannelId(null)
        setAfterSaleId(null)
        route.prepare(p)
        setMobileNav(false)
      },
      go: (p) => {
        setChannelId(null)
        setAfterSaleId(null)
        setPage(p)
        preloadPage(p)
        setMobileNav(false)
      },
      openChannel:(id)=>{setChannelId(id);setChannelFocus(n=>n+1);setPage('channels');setMobileNav(false)},
      afterSale: (id) => { setDrawer(null); setAfterSaleId(id??null); setPage('aftersales'); setMobileNav(false) },
      openOrder,
      newOrder: (p) => {
        if (workspaceStatus !== 'ready') return
        setPrefill(p ?? null)
        setQuick(true)
      },
      palette: () => setPalette(true),
      cards: (ids, kind = 'order') => setCards({ ids, kind }),
      rewrite: (orderId, attachmentId) => {
        setRewriteSeed({ orderId, attachmentId })
        setDrawer(null)
        setPage('toolbox')
        setMobileNav(false)
      },
    }),
    [page, setPage, route.prepare, openOrder, workspaceStatus, setQuick],
  )

  const roleKey = `${me.id}:${me.roleId}`
  const prevRole = useRef(roleKey)
  // 角色权限变了（比如被管理员改了角色），当前页没权限就回首页
  useEffect(() => {
    const allowed: Record<Page, boolean> = {
      home: true, contractors: safeRole.locked, inquiries: can('order.create'),
      cases: can('order.view'), talk: can('order.view'), reviews: safeRole.locked || (can('order.view') && me.canWrite),
      tasks: can('order.view'),
      aftersales: can('order.view'),
      assistant: can('order.view') || can('order.create'),
      orders: can('order.view'),
      channels: can('channel.view'),
      income: true,
      forum: true,
      dm: true,
      toolbox: can('toolbox.use') || can('toolbox.manage') || can('points.manage'),
      settle: can('settle.manage'),
      settings: can('options.manage'),
      roles: can('role.manage'),
      audit: can('audit.view'),
      trash: can('trash.view'),
    }
    // 旧版的「反馈」页并进了论坛
    if ((page as string) === 'feedback') setPage('forum', true)
    else if (!allowed[page] || (ADMIN_PAGES.includes(page) && !safeRole.locked)) setPage('home', true)
    // 只在角色真变了时关掉打开的单（首次进来不关，扫码打开的单要留着）
    if (prevRole.current !== roleKey) { setDrawer(null); setAfterSaleId(null) }
    prevRole.current = roleKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleKey, page, safeRole])

  // 扫卡片二维码进来：/?o=<单号>&as=<轮次> → 打开这单（带轮次就到跟进页签）；看不到的单只说找不到
  useEffect(() => {
    if (workspaceStatus !== 'ready') return
    const q = new URLSearchParams(location.search)
    const no = q.get('o')
    if (!no) return
    const remaining = new URLSearchParams(q)
    remaining.delete('o'); remaining.delete('as')
    router.replace(route.pathname + (remaining.size ? `?${remaining}` : ''), { scroll: false })
    const v = getState().orders.find((x) => x.no === no)
    if (v) setDrawer({ id: v.id, list: [v.id], tab: q.get('as') ? 'aftersale' : undefined })
    else toast.error(`找不到 ${no}：可能已删除，或不在你的查看范围`)
  }, [workspaceStatus, route.pathname, router])

  const session = useSession()
  const pages = useMemo(() => visiblePages(session).map((i) => i.page), [session])
  const [help, setHelp] = useState(false)
  useEffect(() => { document.title = `${page === 'aftersales' ? '交付跟进' : page === 'dm' ? '私信' : visiblePages(session).find(item => item.page === sidebarPage(page))?.label ?? '工作台'} · 笔下工单` }, [page, roleKey])
  useEffect(() => {
    let leader = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (workspaceStatus === 'ready') setPalette((v) => !v)
        return
      }
      if (!plainKey(e)) return
      const key = e.key.toLowerCase()
      // G 之后 1.2 秒内再按一个字母跳页
      if (Date.now() - leader < 1200) {
        leader = 0
        const target = GO_KEYS.find((g) => g.key === key && pages.includes(g.page))
        if (target) { e.preventDefault(); nav.go(target.page) }
        return
      }
      if (key === 'g') { leader = Date.now(); return }
      if (e.key === '?') { e.preventDefault(); setHelp(true) }
      else if (key === 'n' && can('order.create') && workspaceStatus === 'ready') {
        e.preventDefault()
        setPrefill(null)
        setQuick(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [can, pages, nav, workspaceStatus, setQuick])

  const tablePage = ['tasks', 'aftersales', 'orders', 'channels', 'income', 'settle', 'audit', 'trash', 'roles', 'forum', 'dm'].includes(page) || (page === 'home' && !can('order.create') && me.canWrite)
  const clientView = route.pending || Object.values(PAGE_PATHS).includes(route.pathname) || route.pathname.startsWith('/forum/')
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}>
      <TooltipProvider delayDuration={300}>
        <NavContext.Provider value={nav}>
          <div className="workspace-shell flex h-[var(--workbench-height,100dvh)] overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
            <MobileNav open={mobileNav} onOpenChange={setMobileNav} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar onMenu={() => setMobileNav(true)} />
              {/* 首页、我的收入、发工资只讲钱，金额用正文色 */}
              <main data-workspace-page={page} data-money={page === 'home' || page === 'income' || page === 'settle' ? 'plain' : undefined} className={tablePage ? 'min-h-0 flex-1 overflow-hidden' : 'scroll-thin min-h-0 flex-1 overflow-auto'}>
                {/* 任务页两张表并排，2K 屏上不限最大宽度，多出的宽度给订单名和要求 */}
                <div className={tablePage ? (page === 'tasks' ? '' : 'max-w-[1600px] ') + 'mx-auto flex h-full min-h-0 w-full flex-col md:px-6 md:py-5 [&>*]:min-h-0 [&>*]:flex-1 md:[&>*]:overflow-hidden md:[&>*]:rounded-xl md:[&>*]:border wide:max-w-[1920px]' : 'mx-auto w-full max-w-[1440px] px-4 pb-24 pt-5 md:px-8 wide:max-w-[1760px] wide:px-10'}>
                  {workspaceStatus !== 'ready' ? <PageLoading page={page} error={workspaceStatus === 'error'} onRetry={() => void refresh(true)} /> : <WorkspacePageContext.Provider value={{ channelId, channelFocus, afterSaleId, setAfterSaleId, rewriteSeed, clearRewriteSeed: () => setRewriteSeed(null) }}>
                    <Suspense fallback={page === 'assistant' ? <PageLoading page="assistant" /> : null}><div hidden={page !== 'assistant'}>{(page === 'assistant' || visited.assistant) && (can('order.view') || can('order.create')) && <AssistantPage key={`${roleKey}:${JSON.stringify(safeRole)}`} />}</div></Suspense>
                    {(ADMIN_PAGES.includes(page) && (route.pending || !safeRole.locked)) ? <PageLoading page={page} /> : <Suspense fallback={<PageLoading page={page} />}>{clientView ? <WorkspaceView page={page} /> : children}</Suspense>}
                  </WorkspacePageContext.Provider>}
                </div>
              </main>
            </div>
          </div>
          {(palette||visited.palette)&&<Suspense fallback={<AppDialogLoading open={palette} onOpenChange={setPalette} title="搜索订单和页面" size="md" />}><CommandPalette open={palette} onOpenChange={setPalette} onHelp={() => setHelp(true)} /></Suspense>}
          {help && <ShortcutsDialog open={help} onOpenChange={setHelp} pages={pages} />}
          {dialogRoute.dialog === 'entry' && workspaceStatus !== 'ready' && <AppDialogLoading open onOpenChange={setQuick} title="录单" size="md" />}
          {workspaceStatus === 'ready' && (quick||visited.quick) && <Suspense fallback={<AppDialogLoading open={quick} onOpenChange={setQuick} title="录单" size="md" />}><QuickEntry open={quick} onOpenChange={setQuick} prefill={prefill} /></Suspense>}
          {(cards||visited.cards)&&<CardsDialog open={!!cards} onOpenChange={(o) => !o && setCards(null)} orderIds={cards?.ids ?? []} kind={cards?.kind} />}
          {(drawer||visited.drawer)&&<Suspense fallback={<OrderDrawerLoading open={!!drawer} onClose={() => setDrawer(null)} />}><OrderDrawer
            state={drawer}
            onClose={() => setDrawer(null)}
            onMove={(id) => {
              setDrawer((d) => (d ? { ...d, id } : d))
            }}
            onViewed={(id) => logView(id)}
          /></Suspense>}
          {workspaceStatus === 'ready' && <AiIntakeHost />}
          {workspaceStatus === 'ready' && <RewardHost />}
          <PreviewHost />
          <Toaster
            position="bottom-center"
            style={
              {
                '--normal-bg': 'hsl(var(--popover))',
                '--normal-text': 'hsl(var(--popover-foreground))',
                '--normal-border': 'hsl(var(--border))',
              } as React.CSSProperties
            }
            toastOptions={{ className: 'text-sm' }}
          />
        </NavContext.Provider>
      </TooltipProvider>
    </MotionConfig>
  )
}
