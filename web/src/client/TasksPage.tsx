import { fuzzyMatch } from '@/shared/search'
import { PageLoading } from './PageLoading'
import { isStagedWriterPay, writerGroupDone } from '@/shared/writer-stages'
import { taskPendingOrders, taskTodaySummary } from '@/shared/task-today-summary'
import { needsDeadline } from '@/shared/order-deadline'
import { HeaderBar, Segmented } from './controls'
import { TableFooter, TablePageHeader } from './table-kit'
import { OrderProgress } from './OrderProgress'
import { OrderBadges } from './OrderUrgency'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, CaretRight, ClipboardText, MagnifyingGlass } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { OrderView } from '@/shared/types'
import type { AfterSaleTask } from '@/shared/aftersale-task'
import { businessDate, daysUntil, money, payday, shortDate, today } from '@/shared/format'
import { incomeRowsInPayPeriod, incomeSummary } from '@/shared/income'
import { confirmationState } from '@/shared/as-rules'
import { canAdjustDeadline } from '@/shared/perm'
import { useSession, updateOrder, loadIncome } from './store'
import { useNav } from './nav'
import { Avatar, ChannelAvatar, Empty, inputCls } from './ui'
import { DatePicker } from './DatePicker'
import { useAfterSaleTasks, useTaskClock } from './after-sale-data'
import { TaskCountdown, TaskAction, isUrgent } from './TaskCard'
import { ConfirmationPanel } from './TaskReply'
import { DeliverButton } from './DeliverButton'
import { canSeeAfterSale } from '@/shared/after-sale-access'
import { TasksSplit } from './TasksSplit'
import { CopyOrderName } from './CopyOrderName'
import { Magnolia } from './Magnolia'
import { plainKey } from './shortcuts'
import { useDevicePref } from './prefs'

const hm = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
const dayOf = (iso: string) => businessDate(new Date(iso))
const WEEK = '日一二三四五六'

/** 按截止分组：逾期红、今天橙，其余不上色，免得满屏都在喊急。 */
type Bucket = 'group' | 'final' | 'late' | 'today' | 'tomorrow' | 'week' | 'later' | 'undated'
const BUCKETS: { id: Bucket; label: string; dot: string; text?: string }[] = [
  { id: 'group', label: '待发群', dot: 'bg-warn', text: 'text-warn' },
  { id: 'late', label: '逾期', dot: 'bg-danger', text: 'text-danger' },
  { id: 'today', label: '今天截止', dot: 'bg-warn', text: 'text-warn' },
  { id: 'tomorrow', label: '明天截止', dot: 'bg-foreground/50' },
  { id: 'week', label: '7 天内', dot: 'bg-foreground/30' },
  { id: 'later', label: '以后', dot: 'bg-foreground/15' },
  { id: 'final', label: '待正式交付', dot: 'bg-foreground/30' },
  { id: 'undated', label: '截止未填', dot: 'border border-dashed border-muted-foreground' },
]
/** 打开页面只铺开要马上处理的，远的收起来只看数量 */
const OPEN_BY_DEFAULT: Record<Bucket, boolean> = { group: true, final: true, late: true, today: true, tomorrow: true, week: false, later: false, undated: false }
const bucketOf = (v: OrderView, pendingGroup: boolean): Bucket => {
  if (v.status === '已发演示') return 'final'
  if (pendingGroup) return 'group'
  const d = daysUntil(v.dueDate)
  return d === null ? 'undated' : d < 0 ? 'late' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : d < 7 ? 'week' : 'later'
}
/** 颜色和字重只表达主次：要马上处理的深、远的浅；不靠颜色区分类型 */
const loud = (b: Bucket) => b === 'group' || b === 'late' || b === 'today'
const titleTone = (b: Bucket) => loud(b) ? 'font-medium text-foreground' : 'font-normal text-foreground/70'
const asOpen = (a: AfterSaleTask) => !a.doneAt && !a.cancelledAt
const asLate = (a: AfterSaleTask, now: number) => asOpen(a) && confirmationState(a, now) !== 'waiting' && new Date(a.due).getTime() <= now
/** 行内按钮平时隐藏，鼠标移上、键盘选中、弹层打开时出现；触屏一直显示 */
const hoverOnly = 'opacity-0 transition-opacity group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100 focus-within:opacity-100 [&:has([data-state=open])]:opacity-100 [@media(hover:none)]:opacity-100'

/** 跟进按到点时间落到哪一天，用于标题深浅和「今天截止」计数 */
const asBucket = (a: AfterSaleTask, now: number): Bucket => {
  if (asLate(a, now)) return 'late'
  const d = daysUntil(businessDate(new Date(confirmationState(a, now) === 'waiting' ? a.confirmBy! : a.due)))
  return d === null || d <= 0 ? 'today' : d === 1 ? 'tomorrow' : d < 7 ? 'week' : 'later'
}

/** J/K 选中的行，两栏连在一起走 */
const Selection = createContext<{ sel: string | null; pick: (key: string) => void }>({ sel: null, pick: () => {} })
function useRow(key: string) {
  const { sel, pick } = useContext(Selection)
  return { selected: sel === key, pick: () => pick(key) }
}

export function TaskTabs({ view }: { view: 'tasks' | 'aftersales' }) {
  const { go } = useNav()
  // 跟进明细原来是单独的导航，现在收在任务里
  return <Segmented label="任务视图" size="sm" value={view} onChange={(k) => go(k === 'tasks' ? 'tasks' : 'aftersales')} items={[['tasks', '待办'], ['aftersales', '交付跟进']]} />
}

/**
 * 任务页：左边是没交付的订单（按截止分组，越急越靠上），右边是没交付的跟进。
 * 原订单保留在左侧展示截止；进行中的跟进在右侧交付，左侧入口跳转到对应跟进。
 * 右下角的日期页签只用来看某天跟进的记录：发了哪些、几点交付、是否按时。
 */
export function TasksPage() {
  const { views, me, can, user, channel } = useSession()
  const { tasks, loading, error, reload } = useAfterSaleTasks()
  const now = useTaskClock()
  const writer = !can('order.create') && me.canWrite
  const [who, setWho] = useState('all')
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const selRef = useRef(sel)
  selRef.current = sel
  const search = useRef<HTMLInputElement>(null)
  const { orders: drafts, pendingGroupIds } = useMemo(() => taskPendingOrders(views, tasks, writer ? me.id : undefined), [views, tasks, writer, me.id])
  const relevant = useMemo(() => tasks.filter((a) => (writer ? a.writerId === me.id : true)), [tasks, writer, me.id])

  const lateDraft = (v: OrderView) => v.status !== '已发演示' && !pendingGroupIds.has(v.id) && (daysUntil(v.dueDate) ?? 0) < 0
  const mine = (v: OrderView, id: string) => v.assignees.some((a) => a.userId === id) && (v.status === '已发演示' && !isStagedWriterPay(v) || !writerGroupDone(v, id))
  // 写手按手上的量从多到少排，每人带上数量和逾期数
  const writerIds = [...new Set([...drafts.flatMap((v) => v.assignees.map((a) => a.userId)), ...relevant.filter(asOpen).map((a) => a.writerId)])]
    .map((id) => ({ id, n: drafts.filter((v) => mine(v, id)).length + relevant.filter((a) => asOpen(a) && a.writerId === id).length, late: drafts.filter((v) => mine(v, id) && lateDraft(v)).length + relevant.filter((a) => a.writerId === id && asLate(a, now)).length }))
    .sort((a, b) => b.n - a.n)
  const showWho = !writer && writerIds.length > 1
  const q = query.trim().toLowerCase()
  const hit = (...parts: (string | null | undefined)[]) => fuzzyMatch(parts, q)
  const draftRows = drafts.filter((v) => (who === 'all' || mine(v, who)) && hit(v.title, channel(v.channelId)?.name, v.progressNote, v.type))
  const asRows = relevant.filter((a) => (who === 'all' || a.writerId === who) && hit(a.title, a.req.join(' '), channel(a.channelId)?.name))
  const todayKey = businessDate(new Date())
  const scopeUser = writer ? me.id : who === 'all' ? undefined : who
  const visibleDrafts = views.filter(v => (!scopeUser || v.assignees.some(a => a.userId === scopeUser)) && hit(v.title, channel(v.channelId)?.name, v.progressNote, v.type))
  const todayDrafts = taskTodaySummary(draftRows, visibleDrafts, todayKey, pendingGroupIds, scopeUser)
  const lateCount = draftRows.filter(lateDraft).length + asRows.filter((a) => asLate(a, now)).length
  const todayFollowups = asRows.filter(a => asOpen(a) && asBucket(a, now) === 'today').length
  const openCount = asRows.filter(asOpen).length

  useEffect(() => {
    let leader = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.target === search.current) { setQuery(''); search.current?.blur(); return }
      if (!plainKey(e)) return
      const k = e.key.toLowerCase()
      // G 开头是跳页，交给全局
      if (k === 'g') { leader = Date.now(); return }
      if (Date.now() - leader < 1200) return
      if (e.key === '/') { e.preventDefault(); search.current?.focus(); return }
      const list = [...document.querySelectorAll<HTMLElement>('[data-task-row]')].filter((el) => el.offsetParent !== null)
      const i = list.findIndex((el) => el.dataset.taskRow === selRef.current)
      if (k === 'j' || k === 'k') {
        if (!list.length) return
        e.preventDefault()
        const next = list[i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + (k === 'j' ? 1 : -1)))]
        setSel(next.dataset.taskRow!)
        next.scrollIntoView({ block: 'nearest' })
        return
      }
      const row = list[i]
      if (!row) return
      const click = (selector: string) => {
        const target = row.querySelector<HTMLElement>(selector)
        if (target) { e.preventDefault(); target.click() }
      }
      if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button, a')) click('[data-open]')
      else if (k === 'd') click('[data-deliver] button')
      else if (k === 'p') click('[data-progress] button')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loading || error && !tasks.length) return <div className="p-3"><PageLoading page="tasks" error={!!error && !loading} onRetry={reload} /></div>

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <TablePageHeader title="任务" lead={<TaskTabs view="tasks" />} summary={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {lateCount > 0 && <span className="font-medium text-danger">逾期 {lateCount}</span>}
          {todayDrafts.total > 0 && <span className="text-warn">初稿今天截止 {todayDrafts.total}</span>}
          {todayFollowups > 0 && <span className="text-warn">跟进今天到点 {todayFollowups}</span>}
          <span>待交付 {draftRows.length}</span>
          <span>跟进 {openCount}</span>
        </span>
      }>
        {writer && <WageLink />}
      </TablePageHeader>
      <HeaderBar>
        <label className="relative">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input ref={search} aria-label="搜索任务" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜订单、渠道、要求" className={cn(inputCls, 'h-8 w-52 pl-8 pr-8')} />
          {!query && <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">/</span>}
        </label>
        {showWho && <Segmented label="按写手看" size="sm" className="-my-1.5 py-1.5" value={who} onChange={setWho}
          items={[...writerIds.map((p) => [p.id, <>
            <Avatar user={user(p.id)} size={18} />{user(p.id)?.name ?? '—'}
            <span className="num text-muted-foreground">{p.n}</span>
            {p.late > 0 && <span className="num rounded-full bg-danger/10 px-1.5 text-[11px] font-medium leading-4 text-danger" title={`逾期 ${p.late}`}>{p.late}</span>}
          </>] as const), ['all', '全部'] as const]} />}
      </HeaderBar>
      <Selection.Provider value={{ sel, pick: setSel }}>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <TasksSplit key={me.id}
            left={<DraftColumn key={who} rows={draftRows} ids={draftRows.map((v) => v.id)} showWriter={!writer} userId={writer ? me.id : who === 'all' ? undefined : who} pendingGroupIds={pendingGroupIds} deliveredToday={todayDrafts.done} />}
            right={<div className="flex min-w-0 max-lg:order-first lg:min-h-0 [&>section]:flex-1">
              <AfterSaleColumn tasks={asRows} now={now} showWriter={!writer} />
            </div>} />
        </div>
      </Selection.Provider>
      <div className="hidden lg:block">
        <TableFooter>
          <span className="ml-auto inline-flex items-center gap-3">
            {([['J K', '选择'], ['Enter', '打开'], ['D', '交付'], ['P', '进度'], ['/', '搜索']] as const).map(([key, label]) => (
              <span key={key} className="inline-flex items-center gap-1">{key.split(' ').map((x) => <span key={x} className="kbd">{x}</span>)}{label}</span>
            ))}
          </span>
        </TableFooter>
      </div>
    </div>
  )
}

function Column({ title, count, extra, children, footer, compact = false }: { title: string; count: number; extra?: ReactNode; children: ReactNode; footer?: ReactNode; compact?: boolean }) {
  return (
    <section className={cn('flex min-w-0 flex-col bg-card', compact ? 'h-full min-h-0 overflow-hidden' : 'max-lg:border-b lg:h-full lg:min-h-0')}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-4 text-sm font-medium">
        {title}
        <span className="num font-normal text-muted-foreground">{count}</span>
        {extra && <span className="ml-auto inline-flex items-center gap-2 text-xs font-normal">{extra}</span>}
      </header>
      <div className={cn('scroll-thin flex-1', compact ? 'min-h-0 overflow-y-auto' : 'lg:min-h-0 lg:overflow-y-auto')}>{children}</div>
      {footer}
    </section>
  )
}

function GroupHeader({ bucket, count, open, onToggle, hint, children }: { bucket: (typeof BUCKETS)[number]; count: number; open: boolean; onToggle: () => void; hint?: string; children?: ReactNode }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle}
      className="sticky top-0 z-10 flex h-8 w-full items-center gap-2 border-b bg-muted/80 px-4 text-left text-xs font-medium backdrop-blur supports-[backdrop-filter]:bg-muted/60">
      <CaretRight size={11} weight="bold" className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      <span className={cn('h-2 w-2 shrink-0 rounded-full', bucket.dot)} />
      <span className={bucket.text}>{bucket.label}</span>
      <span className="num font-normal text-muted-foreground">{count}</span>
      {children}
      {hint && <span className="num ml-auto hidden shrink-0 font-normal text-muted-foreground xl:inline">{hint}</span>}
    </button>
  )
}

/** 今天这组的小进度条：交一单涨一截 */
function TodayMeter({ done, left }: { done: number; left: number }) {
  const total = done + left
  return (
    <span className="ml-1 inline-flex items-center gap-1.5 font-normal text-muted-foreground" title={`今天截止的订单：已交 ${done} 单，待交 ${left} 单`}>
      <span className="hidden h-1 w-10 shrink-0 sm:block overflow-hidden rounded-full bg-border">
        <motion.span className="block h-full rounded-full bg-foreground/50" initial={false} animate={{ width: `${total ? (done / total) * 100 : 0}%` }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} />
      </span>
      已交 <span className="num">{done}</span> · 待交 <span className="num">{left}</span>
    </span>
  )
}

function DraftColumn({ rows, ids, showWriter, userId, pendingGroupIds, deliveredToday }: { rows: OrderView[]; ids: string[]; showWriter: boolean; userId?: string; pendingGroupIds: Set<string>; deliveredToday: number }) {
  const [saved, save] = useDevicePref<Partial<Record<Bucket, boolean>>>('tasks-open-groups', {})
  const isOpen = (b: Bucket) => saved[b] ?? OPEN_BY_DEFAULT[b]
  const groups = BUCKETS.map((b) => ({ bucket: b, rows: rows.filter((v) => bucketOf(v, pendingGroupIds.has(v.id)) === b.id) }))
  const dateHint = (offset: number) => {
    const d = today()
    d.setDate(d.getDate() + offset)
    return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`
  }
  return (
    <Column title="待交付" count={rows.length}>
      {rows.length || deliveredToday ? groups.map(({ bucket, rows: list }) => {
        const isToday = bucket.id === 'today'
        if (!list.length && !(isToday && deliveredToday)) return null
        const open = isOpen(bucket.id)
        return (
          <div key={bucket.id}>
            <GroupHeader bucket={bucket} count={list.length + (isToday ? deliveredToday : 0)} open={open} onToggle={() => save({ ...saved, [bucket.id]: !open })}
              hint={isToday ? dateHint(0) : bucket.id === 'tomorrow' ? dateHint(1) : undefined}>
              {isToday && <TodayMeter done={deliveredToday} left={list.length} />}
            </GroupHeader>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  {isToday && !list.length ? (
                    <div className="flex items-center gap-2 border-b px-4 py-3 text-sm text-muted-foreground"><Magnolia size={22} />今天截止的都交了</div>
                  ) : (
                    <AnimatePresence initial={false}>
                      {list.map((v) => <DraftRow key={v.id} v={v} ids={ids} bucket={bucket.id} showWriter={showWriter} userId={userId} />)}
                    </AnimatePresence>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      }) : (
        <Empty icon={<ClipboardText size={20} />} title="订单都交付了" />
      )}
    </Column>
  )
}

/** 截止：一行小字 + 一根随时间变短的条；逾期条空掉、底色泛红 */
function DueMark({ v, bucket }: { v: OrderView; bucket: Bucket }) {
  if (bucket === 'final') return <span className="text-xs text-muted-foreground" title="等待正式交付，原订单截止不再催办">{v.status === '已发演示' ? '已演示' : '待交付'}</span>
  if (bucket === 'group') return <span className="text-xs font-medium text-warn">待发群</span>
  const d = daysUntil(v.dueDate)
  if (d === null) return <span className="text-xs text-muted-foreground">—</span>
  const span = Math.max(1, (new Date(v.dueDate!).getTime() - new Date(v.orderDate).getTime()) / 86400000)
  const passed = (today().getTime() - new Date(v.orderDate + 'T00:00:00').getTime()) / 86400000
  // 逾期就是没有剩余时间了：条空掉，只留红字
  const left = d < 0 ? 0 : Math.min(1, Math.max(0.06, 1 - passed / span))
  const text = d < 0 ? `逾 ${-d} 天` : d === 0 ? '今天' : d === 1 ? '明天' : d < 7 ? `周${WEEK[new Date(v.dueDate + 'T00:00:00').getDay()]}` : shortDate(v.dueDate).replace('月', '/').replace('日', '')
  return (
    <span className="grid gap-1" title={`${shortDate(v.dueDate)}截止 · ${shortDate(v.orderDate)}下单`}>
      <span className={cn('num whitespace-nowrap text-xs', d < 0 ? 'font-medium text-danger' : d === 0 ? 'font-medium text-warn' : 'text-muted-foreground')}>{text}</span>
      <span className={cn('h-[3px] w-9 overflow-hidden rounded-full', d < 0 ? 'bg-danger/25' : 'bg-muted')}>
        <span className={cn('block h-full rounded-full', d === 0 ? 'bg-warn' : 'bg-foreground/30')} style={{ width: `${left * 100}%` }} />
      </span>
    </span>
  )
}

function DraftRow({ v, ids, bucket, showWriter, userId }: { v: OrderView; ids: string[]; bucket: Bucket; showWriter: boolean; userId?: string }) {
  const { can, me, role, user, channel } = useSession()
  const { openOrder, afterSale } = useNav()
  const activeFollowup = v.afterSales.find(a => !a.doneAt && !a.cancelledAt && canSeeAfterSale({ ownerId: v.ownerId, deletedAt: null }, a, me, role))
  const key = `d:${v.id}`
  const { selected, pick } = useRow(key)
  const canDraft = can('order.draft') && (role.locked || v.assignees.some((a) => a.userId === me.id))
  const ch = channel(v.channelId)
  const writerId = userId ?? v.assignees.find(a => !writerGroupDone(v, a.userId))?.userId
  const w = writerId ? user(writerId) : undefined
  const late = bucket === 'late'
  // 逾期、今天、待发群的「交付」常驻，其余移上去才出现
  const pinned = late || bucket === 'today' || bucket === 'group' || bucket === 'final'
  return (
    <motion.div exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} data-task-row={key} data-selected={selected} onClick={pick}
      className={cn('group/row relative grid min-h-11 grid-cols-[44px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 border-b px-4 py-2 text-sm transition-colors hover:bg-accent/50 data-[selected=true]:bg-primary/[0.07] data-[selected=true]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]', v.urgency && 'bg-warn/5')}>
      {(late || v.urgency) && <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', late ? 'bg-danger' : 'bg-warn')} />}
      <span className="row-span-2 pt-1"><DueMark v={v} bucket={bucket} /></span>
      <div className="flex min-w-0 flex-wrap items-start gap-1.5">
        <OrderBadges v={v} />
        <button type="button" data-open onClick={() => openOrder(v.id, ids)} className={cn('min-w-0 flex-1 whitespace-normal break-words text-left leading-5 hover:text-primary', titleTone(bucket))} title={v.title}>{v.title}</button>
        <span className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 max-sm:hidden [@media(hover:none)]:opacity-100"><CopyOrderName title={v.title} /></span>
        {v.progressNote && <span className="min-w-0 basis-full break-words text-xs text-muted-foreground" title={`进度：${v.progressNote}`}>{v.progressNote}</span>}
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2">
        <span className={cn('flex items-center gap-1', hoverOnly)}>
          {needsDeadline(v) && can('order.edit') && <DatePicker plain value={null} placeholder="填截止" label={`给 ${v.no} 填截止`} className="!mx-0 !w-auto text-xs text-primary" onChange={(day) => day && void updateOrder(v.id, { dueDate: day })} />}
          {canAdjustDeadline(v, me, role) && <span data-progress><OrderProgress v={v} compact /></span>}
        </span>
        {activeFollowup ? <span data-deliver><button type="button" className="inline-flex h-7 items-center gap-1 text-xs text-primary hover:underline" title="这单正在跟进，请在跟进中交付" onClick={() => afterSale(activeFollowup.id)}>查看跟进<CaretRight size={12}/></button></span> : canDraft && <span data-deliver className={cn(!pinned && hoverOnly)}><DeliverButton kind="draft" userId={userId} orderId={v.id} no={v.no} /></span>}
        {ch && <span className="hidden w-24 min-w-0 items-center gap-1.5 text-xs text-muted-foreground 2xl:flex" title={ch.name}><ChannelAvatar channel={ch} size={16} /><span className="truncate">{ch.name}</span></span>}
        {ch && <span className="2xl:hidden" title={ch.name}><ChannelAvatar channel={ch} size={16} /></span>}
        {showWriter && (w
          ? <span title={w.name} className="flex w-7 shrink-0 justify-center"><Avatar user={w} size={20} /></span>
          : <span title="未派写手" className="flex w-7 shrink-0 justify-center"><span className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/60" /></span>)}
      </div>
    </motion.div>
  )
}

export function AfterSaleColumn({ tasks, now, showWriter, compact = false }: { tasks: AfterSaleTask[]; now: number; showWriter: boolean; compact?: boolean }) {
  const { order, me } = useSession()
  const [tab, setTab] = useState('live')
  const todayKey = businessDate(new Date())
  const open = tasks
    .filter(asOpen)
    .sort((a, b) => {
      const at = (x: AfterSaleTask) => new Date(confirmationState(x, now) === 'waiting' ? x.confirmBy! : x.due).getTime()
      return Number(!!order(b.orderId)?.urgency) - Number(!!order(a.orderId)?.urgency) || at(a) - at(b)
    })
  const doneToday = tasks.filter((a) => a.doneAt && dayOf(a.doneAt) === todayKey)
  const waiting = open.filter((a) => confirmationState(a, now) === 'waiting' && a.writerId === me.id).length
  const late = open.filter((a) => asLate(a, now)).length
  // 每天的记录：当天发布或当天交付的跟进
  const days = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const a of tasks) {
      for (const at of [a.start, a.doneAt, a.cancelledAt]) {
        if (!at) continue
        const k = dayOf(at)
        if (!m.has(k)) m.set(k, new Set())
        m.get(k)!.add(a.id)
      }
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)
  }, [tasks])
  const record = tab === 'live' ? [] : tasks.filter((a) => days.find(([k]) => k === tab)?.[1].has(a.id)).sort((a, b) => a.start.localeCompare(b.start))
  return (
    <Column
      title="跟进"
      count={open.length}
      compact={compact}
      extra={<>
        {waiting > 0 && <span className="text-warn">待确认 {waiting}</span>}
        {late > 0 && <span className="font-medium text-danger">逾期 {late}</span>}
        {doneToday.length > 0 && <span className="text-muted-foreground">今天已交 {doneToday.length}</span>}
      </>}
      footer={
        <div className="scroll-hidden flex shrink-0 items-center gap-1 overflow-x-auto border-t bg-muted/40 px-2 py-1.5">
          <TabBtn on={tab === 'live'} onClick={() => setTab('live')}>
            进行中
          </TabBtn>
          {days.length > 0 && <span className="shrink-0 px-1.5 text-xs text-muted-foreground">记录</span>}
          {days.map(([k, set]) => (
            <TabBtn key={k} on={tab === k} onClick={() => setTab(k)}>
              {k === todayKey ? '今天' : shortDate(k).replace('月', '.').replace('日', '')}
              <span className="num ml-1 text-muted-foreground">{set.size}</span>
            </TabBtn>
          ))}
        </div>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {tab === 'live' ? (
            open.length || doneToday.length ? (
              <>
                {open.map((a) => (
                  <LiveRow key={a.id} a={a} now={now} showWriter={showWriter} />
                ))}
                {!open.length && <div className="flex items-center gap-2 border-b px-4 py-3 text-sm text-muted-foreground"><Magnolia size={22} />跟进都交完了</div>}
                {doneToday.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground last:border-b-0">
                    <Check size={13} weight="bold" className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate" title={a.title}>
                      {a.title}{a.round > 1 && ` · 第 ${a.round} 轮`}
                    </span>
                    <span className="num shrink-0">{hm(a.doneAt!)} 交付</span>
                  </div>
                ))}
              </>
            ) : (
              <Empty icon={<Magnolia size={24} />} title="没有要改的" />
            )
          ) : (
            record.map((a) => <RecordRow key={a.id} a={a} day={tab} />)
          )}
        </motion.div>
      </AnimatePresence>
    </Column>
  )
}

function LiveRow({ a, now, showWriter }: { a: AfterSaleTask; now: number; showWriter: boolean }) {
  const { me, user, channel, order } = useSession()
  const { afterSale } = useNav()
  const key = `a:${a.id}`
  const { selected, pick } = useRow(key)
  const waiting = confirmationState(a, now) === 'waiting' && a.writerId === me.id
  const late = asLate(a, now)
  const ch = channel(a.channelId)
  const urgency = order(a.orderId)?.urgency
  const req = a.req.join('；') || (a.shots.length ? '见截图' : '')
  return (
    <div data-task-row={key} data-selected={selected} onClick={pick}
      className={cn('group/row relative border-b px-4 py-2 transition-colors hover:bg-accent/50 data-[selected=true]:bg-primary/[0.07] data-[selected=true]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]', urgency && 'bg-warn/5')}>
      {(late || urgency) && <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', late ? 'bg-danger' : 'bg-warn')} />}
      {/* 窄屏放不下：倒计时和按钮一行，订单名另起一行 */}
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-[92px] shrink-0"><TaskCountdown a={a} now={now} short /></span>
        <OrderBadges v={order(a.orderId) ?? {}} />
        <button type="button" data-open onClick={() => afterSale(a.id)} className={cn('order-1 min-w-0 basis-full whitespace-normal break-words text-left text-sm leading-5 hover:text-primary', titleTone(asBucket(a, now)))} title={a.title}>{a.title}</button>
        <span className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"><CopyOrderName title={a.title} /></span>
        {a.round > 1 && <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">第 {a.round} 轮</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {!waiting && <span data-deliver className={cn(!(late || isUrgent(a, now)) && hoverOnly)}><TaskAction a={a} /></span>}
          {ch && <span title={ch.name}><ChannelAvatar channel={ch} size={16} /></span>}
          {showWriter && <span title={user(a.writerId)?.name} className="flex w-7 shrink-0 justify-center"><Avatar user={user(a.writerId)} size={20} /></span>}
        </span>
      </div>
      {req && <p className="mt-1 whitespace-normal break-words text-xs text-muted-foreground" title={req}>{req}</p>}
      {waiting && (
        <div className="mt-2 min-w-0">
          <ConfirmationPanel orderId={a.orderId} a={a} now={now} />
        </div>
      )}
    </div>
  )
}

/** 某天的记录：发布时间、交付时间、按时还是逾期。只看，不操作。 */
function RecordRow({ a, day }: { a: AfterSaleTask; day: string }) {
  const { user } = useSession()
  const late = (a.deliveredLateMin ?? 0) > 0
  const result = a.cancelledAt ? '已撤回' : a.doneAt ? (late ? `逾期 ${Math.round(a.deliveredLateMin! / 60) || 1} 小时交付` : '按时交付') : '还没交付'
  return (
    <div className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-b-0">
      <span className={cn('w-[92px] shrink-0 text-xs', late ? 'text-danger' : !a.doneAt && !a.cancelledAt ? 'text-foreground' : 'text-muted-foreground')}>{result}</span>
      <span className="min-w-0 flex-1 truncate" title={a.title}>
        {a.title} {a.round > 1 && <span className="text-xs text-muted-foreground">第 {a.round} 轮</span>}
      </span>
      <span className="num shrink-0 text-xs text-muted-foreground">
        {dayOf(a.start) === day && `${hm(a.start)} 发`}
        {dayOf(a.start) === day && a.doneAt && dayOf(a.doneAt) === day && ' · '}
        {a.doneAt && dayOf(a.doneAt) === day && `${hm(a.doneAt)} 交`}
      </span>
      <Avatar user={user(a.writerId)} size={18} />
    </div>
  )
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-xs transition-colors', on ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  )
}

/** 写手最关心的另一件事：这期工资多少、哪天发。点了去「我的收入」。 */
function WageLink() {
  const { s, me } = useSession()
  const { go } = useNav()
  useEffect(() => { void loadIncome(me.id) }, [me.id, s.version])
  const period = payday(businessDate(new Date()))!
  const { amount, pending } = incomeSummary(incomeRowsInPayPeriod(s.income[me.id] ?? [], period))
  return (
    <button type="button" onClick={() => go('income')} className="group ml-auto inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm hover:bg-accent">
      <span className="text-muted-foreground">本期工资 · {period}</span>
      <span className="num font-medium">{money(amount)}</span>
      {pending > 0 && <span className="text-xs text-muted-foreground">另 {pending} 项未定</span>}
      <CaretRight size={12} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
