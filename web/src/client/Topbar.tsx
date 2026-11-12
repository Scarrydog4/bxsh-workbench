import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { plainKey } from './shortcuts'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, Lightning, List, MagnifyingGlass, Plus, CalendarX, CalendarCheck, UserPlus, Camera, UserCircle, GearSix, SignOut, Wrench, BellRinging, Receipt, Wallet, At, UsersThree, ChatsCircle, Megaphone, ChatCircleDots, PauseCircle, PlayCircle, type Icon } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useDialogRoute } from './useDialogRoute'
import { usePref } from './prefs'
import { CompanyResources } from './CompanyResources'
import { cn } from '@/lib/utils'
import { Avatar, ImageDrop, cropAvatar } from './ui'
import { imageFilesFromTransfer } from './image-input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useNav, type Page } from './nav'
import { logout, setUserAvatar, setUserPaused, useSession, useWorkspaceStatus } from './store'
import { markRead } from './store-p2'
import dynamic from 'next/dynamic'
const loadProfile = () => import('./Profile')
const ProfileDialog=lazy(()=>loadProfile().then(m=>({ default: m.ProfileDialog })))
import { relTime } from '@/shared/format'
import { ThemeChoice } from './theme'
import { AppDialogLoading, AppDialogContent, AppDialogHeader, AppDialogBody, useAppDialogDismiss } from '@/components/ui/app-dialog'
import { PageLoading } from './PageLoading'
import { FORUM_COPY } from '@/shared/copy/forum'
import { setForumTarget, useDmUnread } from './forum/live'
import { DEV_LOGIN, DevAccounts } from './DevLogin'
const loadFollowup = () => import('./SalesTaskEntry')
const SalesTaskEntry=dynamic(()=>loadFollowup().then(m=>m.SalesTaskEntry), { loading: () => <PageLoading title="跟进" /> })
const loadReimbursement = () => import('./ReimbursementDialog')
const ReimbursementDialog=lazy(()=>loadReimbursement().then(m=>({ default: m.ReimbursementDialog })))
const loadCheckin = () => import('./CheckinDialog')
const CheckinDialog=lazy(()=>loadCheckin().then(m=>({ default: m.CheckinDialog })))

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { me, role, can, s } = useSession()
  const { palette, newOrder, go } = useNav()
  async function togglePause() {
    const pausing = !me.pausedAt
    if (await setUserPaused(me.id, pausing)) toast.success(pausing ? '已暂停接单' : '已恢复接单')
  }
  const dmUnread = useDmUnread()
  const workspaceReady = useWorkspaceStatus() === 'ready'
  const [avatarOpen, setAvatarOpen] = useState(false)
  const dialogs = useDialogRoute()
  const [lastSettingsTab] = usePref('profile-tab', 'profile')
  const profileOpen = dialogs.settings !== null
  const checkinOpen = dialogs.dialog === 'checkin'
  const afterSaleOpen = dialogs.dialog === 'followup'
  const afterSaleOrder = dialogs.get('followupOrder') ?? ''
  const reimbursementOpen = dialogs.dialog === 'reimburse'
  const reimbursementId = dialogs.get('reimburseId') ?? undefined
  const [reimbursementRequest, setReimbursementRequest] = useState(0)
  const setProfileOpen = useCallback((open: boolean) => open ? dialogs.openSettings(lastSettingsTab) : dialogs.closeSettings(), [dialogs.openSettings, dialogs.closeSettings, lastSettingsTab])
  const setCheckinOpen = useCallback((open: boolean) => open ? dialogs.openDialog('checkin') : dialogs.closeDialog(), [dialogs.openDialog, dialogs.closeDialog])
  const setAfterSaleOpen = useCallback((open: boolean) => open ? dialogs.openDialog('followup') : dialogs.closeDialog(), [dialogs.openDialog, dialogs.closeDialog])
  const setReimbursementOpen = useCallback((open: boolean) => open ? dialogs.openDialog('reimburse') : dialogs.closeDialog(), [dialogs.openDialog, dialogs.closeDialog])
  const [afterSaleDirty, setAfterSaleDirty] = useState(false)
  const [afterSaleBusy, setAfterSaleBusy] = useState(false)
  const afterSaleDismiss = useAppDialogDismiss({ dirty: afterSaleDirty, blocked: afterSaleBusy, onOpenChange: setAfterSaleOpen })
  useEffect(() => { if (reimbursementOpen) setReimbursementRequest(value => value + 1) }, [reimbursementOpen, reimbursementId])
  useEffect(() => { if (!afterSaleOpen) { setAfterSaleDirty(false); setAfterSaleBusy(false) } }, [afterSaleOpen])
  const [over, setOver] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const avatarSaving = useRef(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [visited,setVisited]=useState({profile:false,aftersale:false,reimburse:false})
  useEffect(()=>{if(profileOpen||afterSaleOpen||reimbursementOpen)setVisited(old=>({profile:old.profile||profileOpen,aftersale:old.aftersale||afterSaleOpen,reimburse:old.reimburse||reimbursementOpen}))},[profileOpen,afterSaleOpen,reimbursementOpen])

  useEffect(() => {
    const open = (event: Event) => {
      if (!workspaceReady) return
      const orderId = (event as CustomEvent<{orderId?: string}>).detail?.orderId
      dialogs.openDialog('followup', orderId ? { followupOrder: orderId } : undefined)
    }
    window.addEventListener('bxsh:aftersale-entry', open)
    return () => window.removeEventListener('bxsh:aftersale-entry', open)
  }, [workspaceReady, dialogs.openDialog])
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{id?: string}>).detail?.id
      dialogs.openDialog('reimburse', id ? { reimburseId: id } : undefined)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b' || !plainKey(event)) return
      event.preventDefault(); dialogs.openDialog('reimburse')
    }
    window.addEventListener('bxsh:reimbursement-entry', open)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('bxsh:reimbursement-entry', open); window.removeEventListener('keydown', key) }
  }, [dialogs.openDialog])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'a' && plainKey(event) && workspaceReady && can('aftersale.create')) {
        event.preventDefault(); dialogs.openDialog('followup')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [can, workspaceReady, dialogs.openDialog])
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-background/80 px-2 backdrop-blur sm:gap-2 sm:px-3 md:px-5 wide:h-16">
      <button onClick={onMenu} className="grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-accent md:hidden" aria-label="打开导航">
        <List size={18} />
      </button>
      <button
        disabled={!workspaceReady}
        aria-label="搜索订单和页面"
        onClick={palette}
        className="flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-md border bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground sm:h-8 sm:w-auto sm:min-w-0 sm:flex-1 sm:justify-start md:max-w-[360px] wide:h-9 wide:max-w-[420px] wide:text-base"
      >
        <MagnifyingGlass size={15} className="shrink-0" />
        <span className="hidden truncate sm:inline">搜订单、跳页面、新建…</span>
        <span className="ml-auto hidden gap-0.5 sm:flex">
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </span>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
        {can('order.create') && (
          <Button size="sm" disabled={!workspaceReady} onPointerEnter={() => void import('./QuickEntry')} onFocus={() => void import('./QuickEntry')} onClick={() => newOrder()} className="h-10 min-w-11 gap-1.5 px-2 sm:h-8 sm:min-w-0 sm:px-2.5" aria-label="录单">
            <Plus size={14} weight="bold" className="hidden sm:block" />
            <span>录单</span>
            <span className="kbd hidden border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground/80 sm:inline-flex">N</span>
          </Button>
        )}
        {can('aftersale.create') && <Button size="sm" variant="outline" disabled={!workspaceReady} onPointerEnter={() => void loadFollowup()} onFocus={() => void loadFollowup()} onClick={() => setAfterSaleOpen(true)} className="h-10 min-w-11 gap-1.5 px-2 sm:h-8 sm:min-w-0 sm:px-2.5" aria-label="新增跟进"><Plus size={14} weight="bold" className="hidden sm:block"/>跟进<span className="kbd hidden sm:inline-flex">A</span></Button>}
        <Notifications />
        <button type="button" aria-label="上下班打卡" title="上下班打卡" onPointerEnter={() => void loadCheckin()} onFocus={() => void loadCheckin()} onClick={() => setCheckinOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary sm:h-8 sm:w-auto sm:px-2">
          <CalendarCheck size={18} /><span className="hidden text-xs sm:inline">打卡</span>
        </button>
        <button type="button" aria-label="报销" title="报销（B）"
          onPointerEnter={() => void loadReimbursement()} onFocus={() => void loadReimbursement()} onClick={() => setReimbursementOpen(true)}
          className="hidden h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-primary sm:flex">
          <Receipt size={17}/><span>报销</span><span className="kbd hidden lg:inline-flex">B</span>
          {s.notifications.some(n => n.kind === '报销' && !n.read) && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="有报销提醒"/>}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            title="账号（可把图片拖到这里换头像）"
            aria-label="账号菜单"
            disabled={avatarBusy}
            aria-busy={avatarBusy}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={async (e) => {
              e.preventDefault()
              setOver(false)
              e.stopPropagation()
              if (avatarSaving.current) return
              const f = imageFilesFromTransfer(e.dataTransfer)[0]
              if (!f) { setAvatarOpen(true); toast.error('未收到图片，请点选图片或粘贴'); return }
              avatarSaving.current = true; setAvatarBusy(true)
              try {
                const url = await cropAvatar(f)
                if (!url) { toast.error('图片无法读取，请重新选择'); return }
                if (await setUserAvatar(me.id, url)) toast.success('头像已更新')
              } catch { toast.error('头像未保存，请重试') }
              finally { avatarSaving.current = false; setAvatarBusy(false) }
            }}
            className={cn('ml-1 grid h-10 w-10 place-items-center rounded-full outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring sm:h-auto sm:w-auto', over && 'scale-125 ring-2 ring-primary ring-offset-2 ring-offset-background')}
          >
            <span className="relative"><Avatar user={me} size={28} />{dmUnread > 0 && <span className="num absolute -right-1.5 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground ring-2 ring-background" aria-label={`${FORUM_COPY.dmUi.menu} ${dmUnread}`}>{dmUnread > 99 ? '99+' : dmUnread}</span>}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
              <Avatar user={me} size={32} />
              <div className="min-w-0">
                <div className="truncate text-sm">{me.name}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">
                  {role.name}{me.account && <> · @{me.account}</>}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuItem className="gap-2" onSelect={() => go('dm')}>
              <ChatCircleDots size={15} /> {FORUM_COPY.dmUi.menu}
              {dmUnread > 0 && <span className="num ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 text-primary-foreground">{dmUnread}</span>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {me.isSales && !me.isAdmin && <DropdownMenuItem className="gap-2" onSelect={() => void togglePause()}>
              {me.pausedAt ? <><PlayCircle size={15} /> 恢复接单</> : <><PauseCircle size={15} /> 暂停接单</>}
            </DropdownMenuItem>}
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => setAvatarOpen(true)}
            >
              <Camera size={15} /> 换头像
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onPointerEnter={() => void loadProfile()} onFocus={() => void loadProfile()} onSelect={() => setProfileOpen(true)}>
              <GearSix size={15} /> 设置
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 sm:hidden" onSelect={() => setReimbursementOpen(true)}>
              <Receipt size={16} />报销
              {s.notifications.some(n => n.kind === '报销' && !n.read) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-label="有报销提醒"/>}
            </DropdownMenuItem>
            <div className="px-2 py-2"><ThemeChoice /></div>
            {DEV_LOGIN && <DropdownMenuItem className="gap-2" onSelect={() => setSwitchOpen(true)}>
              <UsersThree size={15} /> 切换账号<span className="ml-auto text-xs text-muted-foreground">开发</span>
            </DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-danger focus:text-danger" onSelect={() => void logout()}>
              <SignOut size={15} /> 退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {DEV_LOGIN && switchOpen && <Dialog open onOpenChange={setSwitchOpen}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-md gap-3 p-5">
          <DialogTitle className="text-base">切换账号</DialogTitle>
          <DialogDescription className="text-xs">开发预览，点头像直接登录成这个人</DialogDescription>
          <DevAccounts currentId={me.id} />
        </DialogContent>
      </Dialog>}
      {(profileOpen||visited.profile)&&<Suspense fallback={<AppDialogLoading open={profileOpen} onOpenChange={setProfileOpen} title="设置" />}><ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} initialTab={dialogs.settings ?? undefined} onTabChange={dialogs.replaceSettings} resources={<CompanyResources />} /></Suspense>}
      {checkinOpen && <Suspense fallback={<AppDialogLoading open={checkinOpen} onOpenChange={setCheckinOpen} title="出勤管理" />}><CheckinDialog key={me.id} open={checkinOpen} onOpenChange={setCheckinOpen} /></Suspense>}
      {(reimbursementOpen || visited.reimburse) && (workspaceReady ? <Suspense fallback={<AppDialogLoading open={reimbursementOpen} onOpenChange={setReimbursementOpen} title="报销" />}><ReimbursementDialog key={me.id} open={reimbursementOpen} onOpenChange={setReimbursementOpen} initialId={reimbursementId} requestKey={reimbursementRequest}/></Suspense> : <AppDialogLoading open={reimbursementOpen} onOpenChange={setReimbursementOpen} title="报销" />)}
      {can('aftersale.create') && <Dialog open={afterSaleOpen} onOpenChange={afterSaleDismiss.requestOpenChange}>
        <AppDialogContent size="md" data-followup-dialog>
          <AppDialogHeader><DialogTitle className="text-base">发起跟进</DialogTitle><DialogDescription className="sr-only">选择订单并登记跟进</DialogDescription></AppDialogHeader>
          <AppDialogBody className="p-5">{workspaceReady ? <SalesTaskEntry key={afterSaleOrder} embedded initialOrderId={afterSaleOrder} onNavigate={() => setAfterSaleOpen(false)} onDirtyChange={setAfterSaleDirty} onBusyChange={setAfterSaleBusy} /> : <PageLoading title="订单" />}</AppDialogBody>
        </AppDialogContent>
      </Dialog>}
      {afterSaleDismiss.confirmation}
      <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-sm gap-3" onClick={event => {
          if (!(event.target as HTMLElement).closest('button, input')) event.currentTarget.querySelector<HTMLElement>('[data-avatar-input]')?.focus({ preventScroll: true })
        }}>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <Avatar user={me} size={32} /> 换头像
          </DialogTitle>
          <DialogDescription className="sr-only">更换头像</DialogDescription>
          <ImageDrop
            autoFocus
            preview={me.avatar}
            onImage={async (url) => {
              if (!(await setUserAvatar(me.id, url))) return false
              toast.success('头像已更新')
              setAvatarOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </header>
  )
}

/** 提醒中心：服务端存的提醒，实时推送（SSE 推 changed 后重新拉），点开跳到对应订单的页签或页面 */
function Notifications() {
  const workspaceReady = useWorkspaceStatus() === 'ready'
  const { s, user } = useSession()
  const { openOrder, go, afterSale } = useNav()
  const [open, setOpen] = useState(false)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const list = onlyUnread ? s.notifications.filter((n) => !n.read) : s.notifications

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={!workspaceReady} className="relative grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:h-8 sm:w-8" aria-label={`提醒${s.unread ? `，${s.unread} 条未读` : ''}`}>
        <Bell size={17} />
        <AnimatePresence>
          {s.unread > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="num absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[12px] font-medium text-white"
            >
              {s.unread > 99 ? '99+' : s.unread}
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <span className="text-sm font-medium">提醒</span>
          <div className="flex rounded-md border p-0.5 text-xs">
            {[false, true].map((u) => (
              <button key={String(u)} onClick={() => setOnlyUnread(u)} className={cn('rounded px-1.5 py-0.5', onlyUnread === u ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
                {u ? `未读 ${s.unread}` : '全部'}
              </button>
            ))}
          </div>
          {s.unread > 0 && (
            <button className="ml-auto text-xs text-primary hover:underline" onClick={() => void markRead()}>
              全部标为已读
            </button>
          )}
        </div>
        <div className="scroll-thin max-h-[min(420px,70dvh)] overflow-auto p-1">
          {list.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted-foreground">{onlyUnread ? '没有未读提醒' : '还没有提醒'}</div>}
          {list.map((n) => {
            const tone = NOTE_TONE[n.kind] ?? 'var(--info)'
            const Icon = NOTE_ICON[n.kind] ?? Bell
            return (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) void markRead([n.id])
                  setOpen(false)
                  if (n.tab?.startsWith('reimburse:')) window.dispatchEvent(new CustomEvent('bxsh:reimbursement-entry', { detail: { id: n.tab.slice(10) } }))
                  else if (n.tab?.startsWith('aftersale:')) afterSale(n.tab.slice(10))
                  else if (n.tab?.startsWith('page:forum:')) { setForumTarget({ postId: n.tab.slice(11) }); go('forum') }
                  else if (n.tab?.startsWith('page:dm:')) { setForumTarget({ threadId: n.tab.slice(8) }); go('dm') }
                  else if (n.tab?.startsWith('page:')) go(n.tab.slice(5) as Page)
                  else if (n.orderId) openOrder(n.orderId, undefined, n.tab ?? undefined)
                }}
                className={cn('flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-accent', n.kind === '订单加急' && !n.read && 'bg-warn/10')}
              >
                <span className="tone mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ '--t': tone } as React.CSSProperties}>
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm leading-snug', n.read && 'text-muted-foreground')}>{n.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {n.actorId && user(n.actorId) ? `${user(n.actorId)!.name} · ` : ''}
                    {relTime(n.at)}
                    {n.body && ` · ${n.body}`}
                  </span>
                </span>
                {!n.read && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const NOTE_TONE: Record<string, string> = {
  订单加急: 'var(--warn)',
  截止: 'var(--warn)',
  售后到期: 'var(--warn)',
  售后逾期: 'var(--danger)',
  被催: 'var(--danger)',
  节点到期: 'var(--warn)',
  待收到期: 'var(--warn)',
  结算: 'var(--gold)',
  报销: 'var(--gold)',
  '被 @': 'var(--info)',
  公告: 'var(--primary)',
  dm: 'var(--primary)',
}
const NOTE_ICON: Record<string, Icon> = {
  订单加急: Lightning,
  截止: CalendarX,
  售后到期: CalendarX,
  售后逾期: CalendarX,
  节点到期: CalendarX,
  新订单: UserPlus,
  新售后: Wrench,
  被催: BellRinging,
  待收到期: Receipt,
  结算: Wallet,
  报销: Receipt,
  '被 @': At,
  公告: Megaphone,
  反馈: ChatsCircle,
  Skill: ChatsCircle,
  文档: ChatsCircle,
  新成果: ChatsCircle,
  dm: ChatCircleDots,
}
