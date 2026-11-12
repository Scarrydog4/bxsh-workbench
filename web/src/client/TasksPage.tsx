import { fuzzyMatch } from '@/shared/search'
import { PageLoading } from './PageLoading'
import { isStagedWriterPay, writerGroupDone } from '@/shared/writer-stages'
import { taskPendingOrders, taskTodaySummary } from '@/shared/task-today-summary'
import { needsDeadline } from '@/shared/order-deadline'
import { Segmented } from './controls'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, TableFooter, TablePageHeader, type Col } from './table-kit'
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
import { afterSaleState, confirmationState } from '@/shared/as-rules'
import { canAdjustDeadline } from '@/shared/perm'
import { useSession, updateOrder, loadIncome } from './store'
import { useNav } from './nav'
import { Avatar, ChannelName, Empty, inputCls } from './ui'
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
/** 次要操作（填截止、进度、复制名称）不常驻占位，移上或选中时才出现，避免挤窄标题 */
const hoverShow = 'hidden group-hover/row:inline-flex group-data-[selected=true]/row:inline-flex [&:has([data-state=open])]:inline-flex [@media(hover:none)]:inline-flex'
/** 两栏共用同一套列：序号 · 时间 · 两行内容 · 操作，行高一致，左右对得齐 */
const ROW = 'group/row relative grid min-h-[46px] grid-cols-[24px_76px_minmax(0,1fr)_auto] items-center gap-x-2 border-b px-3 py-1.5 text-sm transition-colors hover:bg-accent/50 data-[selected=true]:bg-primary/[0.07] data-[selected=true]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'

/** 跟进按到点时间分组，和左栏同一套分组条 */
const FOLLOWUP_BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'late', label: '逾期' },
  { id: 'today', label: '今天到点' },
  { id: 'tomorrow', label: '明天到点' },
  { id: 'week', label: '7 天内' },
  { id: 'later', label: '以后' },
]

function RowNo({ n }: { n: number }) {
  return <span className="num text-right text-xs text-muted-foreground/70" aria-label={`第 ${n} 条`}>{n}</span>
}

/** 每条最多两行：第一行标题，第二行灰色备注，写不下就截断，悬停看全文 */
function RowText({ badges, title, tone, sub, subTitle, onOpen }: { badges: ReactNode; title: string; tone: string; sub: string; subTitle?: string; onOpen: () => void }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        {badges}
        <button type="button" data-open onClick={onOpen} title={title} className={cn('min-w-0 truncate text-left leading-5 hover:text-primary', tone)}>{title}</button>
      </div>
      <p className="truncate text-xs leading-4 text-muted-foreground" title={subTitle ?? (sub || undefined)}>{sub || ' '}</p>
    </div>
  )
}

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
      {/* 顶部只留一行：视图切换、搜索、按写手看。各项计数只在两栏的栏头和分组条里出现一次 */}
      <TablePageHeader title="任务" lead={<TaskTabs view="tasks" />}>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {showWho && <Segmented label="按写手看" size="sm" value={who} onChange={setWho}
            items={[...writerIds.map((p) => [p.id, <>
              <Avatar user={user(p.id)} size={18} />{user(p.id)?.name ?? '—'}
              <span className="num text-muted-foreground">{p.n}</span>
              {p.late > 0 && <span className="num rounded-full bg-danger/10 px-1.5 text-[11px] font-medium leading-4 text-danger" title={`逾期 ${p.late}`}>{p.late}</span>}
            </>] as const), ['all', '全部'] as const]} />}
          <label className="relative">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input ref={search} aria-label="搜索任务" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜订单、渠道、要求" className={cn(inputCls, 'h-8 w-52 pl-8 pr-8')} />
            {!query && <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">/</span>}
          </label>
          {writer && <WageLink />}
        </div>
      </TablePageHeader>
      <Selection.Provider value={{ sel, pick: setSel }}>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <TasksSplit key={me.id}
            left={<DraftTable key={who} rows={draftRows} showWriter={!writer} userId={writer ? me.id : who === 'all' ? undefined : who} pendingGroupIds={pendingGroupIds} deliveredToday={todayDrafts.done} />}
            right={<div className="flex min-w-0 max-lg:order-first lg:min-h-0 [&>section]:flex-1">
              <FollowupTable tasks={asRows} now={now} showWriter={!writer} />
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
      className="sticky top-0 z-10 flex h-8 w-full items-center gap-2 border-b bg-muted/80 px-3 text-left text-xs font-medium backdrop-blur supports-[backdrop-filter]:bg-muted/60">
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
  const [saved, save] = useDevicePref<Partial<Record<Bucket, boolean>>>('tasks-open-followup-groups', {})
  const groups = FOLLOWUP_BUCKETS
    .map((b) => ({ bucket: { ...BUCKETS.find((x) => x.id === b.id)!, label: b.label }, rows: open.filter((a) => asBucket(a, now) === b.id) }))
    .filter((g) => g.rows.length)
  const numbers = new Map(groups.flatMap((g) => g.rows).map((a, i) => [a.id, i + 1]))
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
        {doneToday.length > 0 && <span className="text-muted-foreground">今天已交 {doneToday.length}</span>}
        {/* 记录原来是底部一排日期页签，收进栏头的下拉，栏头和左栏同高 */}
        {days.length > 0 && (
          <Select value={tab} onValueChange={setTab}>
            <SelectTrigger aria-label="查看进行中或某天的跟进记录" className="-my-1 h-7 w-auto gap-1 border-transparent px-2 text-xs shadow-none hover:border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="live">进行中</SelectItem>
              {days.map(([k, set]) => (
                <SelectItem key={k} value={k}>{k === todayKey ? '今天' : shortDate(k).replace('月', '.').replace('日', '')} 的记录 · {set.size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </>}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {tab === 'live' ? (
            open.length || doneToday.length ? (
              <>
                {groups.map(({ bucket, rows }) => {
                  const isOpen = saved[bucket.id] ?? true
                  return (
                    <div key={bucket.id}>
                      <GroupHeader bucket={bucket} count={rows.length} open={isOpen} onToggle={() => save({ ...saved, [bucket.id]: !isOpen })} />
                      {isOpen && rows.map((a) => <LiveRow key={a.id} a={a} n={numbers.get(a.id)!} now={now} showWriter={showWriter} />)}
                    </div>
                  )
                })}
                {!open.length && <div className="flex items-center gap-2 border-b px-3 py-3 text-sm text-muted-foreground"><Magnolia size={22} />跟进都交完了</div>}
                {doneToday.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground last:border-b-0">
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

function LiveRow({ a, n, now, showWriter }: { a: AfterSaleTask; n: number; now: number; showWriter: boolean }) {
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
    <div data-task-row={key} data-selected={selected} onClick={pick} className={cn(ROW, urgency && 'bg-warn/5')}>
      {(late || urgency) && <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', late ? 'bg-danger' : 'bg-warn')} />}
      <RowNo n={n} />
      <span className="min-w-0"><TaskCountdown a={a} now={now} short /></span>
      <RowText badges={<OrderBadges v={order(a.orderId) ?? {}} />} title={a.title} tone={titleTone(asBucket(a, now))} onOpen={() => afterSale(a.id)}
        sub={[a.round > 1 ? `第 ${a.round} 轮` : '', req, ch?.name].filter(Boolean).join(' · ')} subTitle={req || undefined} />
      <span className="flex shrink-0 items-center justify-end gap-2">
        <span className={cn('items-center', hoverShow)}><CopyOrderName title={a.title} /></span>
        {!waiting && <span data-deliver className={cn(!(late || isUrgent(a, now)) && hoverOnly)}><TaskAction a={a} label="交付" /></span>}
        {showWriter && <span title={user(a.writerId)?.name} className="flex w-7 shrink-0 justify-center"><Avatar user={user(a.writerId)} size={20} /></span>}
      </span>
      {/* 写手要先回复预计完成时间：确认面板占整行，放在两行内容下面 */}
      {waiting && (
        <div className="col-span-full mt-1.5 min-w-0 pl-8">
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
    <div className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
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

// ---------- 两栏表格：待交付 / 跟进 ----------

/** 选中行整行着色；单元格自带底色，所以要落到 td 上 */
const rowTone = (selected: boolean, warn: boolean) => cn(
  selected ? '[&>td]:!bg-primary/[0.08]' : warn && '[&>td]:bg-warn/5')
// 订单名最多两行，再长才截断；悬停看全文
const cellTitle = 'min-w-0 flex-1 line-clamp-2 break-all text-left leading-5 hover:text-primary hover:underline underline-offset-4'

/** 分组开关：一排带数量的小按钮，既是汇总也是筛选；点一下收起或展开这一组 */
function BucketChips({ groups, isOpen, toggle, children }: { groups: { bucket: (typeof BUCKETS)[number]; count: number }[]; isOpen: (b: Bucket) => boolean; toggle: (b: Bucket) => void; children?: ReactNode }) {
  return (
    <div role="group" aria-label="按时间分组显示" className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5">
      {groups.map(({ bucket, count }) => (
        <button key={bucket.id} type="button" aria-pressed={isOpen(bucket.id)} onClick={() => toggle(bucket.id)} title={isOpen(bucket.id) ? `收起「${bucket.label}」` : `展开「${bucket.label}」`}
          className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isOpen(bucket.id) ? 'border-border bg-card font-medium shadow-sm' : 'border-transparent text-muted-foreground hover:bg-accent')}>
          <span className={cn('h-2 w-2 shrink-0 rounded-full', bucket.dot)} />
          <span className={isOpen(bucket.id) ? bucket.text : undefined}>{bucket.label}</span>
          <span className="num font-normal text-muted-foreground">{count}</span>
        </button>
      ))}
      {children}
    </div>
  )
}

function GroupLabel({ bucket, count, hint, children }: { bucket: (typeof BUCKETS)[number]; count: number; hint?: string; children?: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', bucket.dot)} />
      <span className={bucket.text}>{bucket.label}</span>
      <span className="num font-normal text-muted-foreground">{count}</span>
      {children}
      {hint && <span className="num ml-auto font-normal text-muted-foreground">{hint}</span>}
    </span>
  )
}

function DraftTable({ rows, showWriter, userId, pendingGroupIds, deliveredToday }: { rows: OrderView[]; showWriter: boolean; userId?: string; pendingGroupIds: Set<string>; deliveredToday: number }) {
  const { can, me, role, user, channel } = useSession()
  const { openOrder, afterSale } = useNav()
  const { sel, pick } = useContext(Selection)
  const [saved, save] = useDevicePref<Partial<Record<Bucket, boolean>>>('tasks-open-groups', {})
  const isOpen = (b: Bucket) => saved[b] ?? OPEN_BY_DEFAULT[b]
  const bucketById = useMemo(() => new Map(rows.map((v) => [v.id, bucketOf(v, pendingGroupIds.has(v.id))])), [rows, pendingGroupIds])
  const groups = BUCKETS.map((b) => ({ bucket: b, rows: rows.filter((v) => bucketById.get(v.id) === b.id) })).filter((g) => g.rows.length)
  // 序号按显示顺序连续编，跨分组不重置；收起的分组也占号，展开收起时号码不变
  const ordered = groups.flatMap((g) => g.rows)
  const numbers = useMemo(() => new Map(ordered.map((v, i) => [v.id, i + 1])), [ordered.map((v) => v.id).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = ordered.filter((v) => isOpen(bucketById.get(v.id)!))
  const ids = shown.map((v) => v.id)
  const dateHint = (offset: number) => {
    const d = today()
    d.setDate(d.getDate() + offset)
    return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`
  }
  const cols: Col<OrderView>[] = [
    // 默认宽度按 1440 屏左栏（约 690px）排满不出横向滚动；屏幕更宽时表格自动按比例拉开
    { id: 'no', header: '#', size: 36, minSize: 32, hideable: false, cell: (v) => <RowNo n={numbers.get(v.id) ?? 0} /> },
    { id: 'due', header: '截止', size: 64, minSize: 56, cell: (v) => <DueMark v={v} bucket={bucketById.get(v.id) ?? 'later'} /> },
    { id: 'order', header: '订单', size: 186, minSize: 120, hideable: false, grow: true, cell: (v) => (
      <div className="flex min-w-0 items-center gap-1">
        <OrderBadges v={v} />
        <button type="button" data-open onClick={(e) => { e.stopPropagation(); pick(`d:${v.id}`); openOrder(v.id, ids) }} title={v.title} className={cn(cellTitle, titleTone(bucketById.get(v.id) ?? 'later'))}>{v.title}</button>
        <CopyOrderName title={v.title} />
      </div>
    ) },
    { id: 'progress', header: '进度', size: 110, grow: true, cell: (v) => (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 line-clamp-2 break-all text-xs leading-4 text-muted-foreground" title={v.progressNote || undefined}>{v.progressNote || '—'}</span>
        {/* 只留铅笔图标，文字给进度内容让位；悬停有「填写当前进度」提示 */}
        {canAdjustDeadline(v, me, role) && <span data-progress className="shrink-0 [&_button>span]:sr-only" onClick={(e) => e.stopPropagation()}><OrderProgress v={v} compact /></span>}
      </div>
    ) },
    { id: 'channel', header: '渠道', size: 140, minSize: 60, cell: (v) => <ChannelName channel={channel(v.channelId)} size={18} /> },
    ...(showWriter ? [{ id: 'writer', header: '写手', size: 56, minSize: 44, cell: (v: OrderView) => {
      const writerId = userId ?? v.assignees.find((a) => !writerGroupDone(v, a.userId))?.userId
      const w = writerId ? user(writerId) : undefined
      // 只放头像，名字悬停可见，省出位置给「交付」
      return w ? <span title={w.name} className="flex justify-center"><Avatar user={w} size={20} /></span> : <span title="未派写手" className="flex justify-center"><span className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/60" /></span>
    } }] : []),
    { id: 'actions', header: '操作', size: 116, minSize: 96, hideable: false, cell: (v) => {
      const activeFollowup = v.afterSales.find((a) => !a.doneAt && !a.cancelledAt && canSeeAfterSale({ ownerId: v.ownerId, deletedAt: null }, a, me, role))
      const canDraft = can('order.draft') && (role.locked || v.assignees.some((a) => a.userId === me.id))
      return (
        <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {activeFollowup
            ? <span data-deliver><button type="button" className="inline-flex h-7 items-center gap-1 text-xs text-primary hover:underline" title="这单正在跟进，请在跟进中交付" onClick={() => afterSale(activeFollowup.id)}>查看跟进<CaretRight size={12} /></button></span>
            : canDraft && <span data-deliver><DeliverButton kind="draft" userId={userId} orderId={v.id} no={v.no} /></span>}
          {needsDeadline(v) && can('order.edit') && <DatePicker plain value={null} placeholder="填截止" label={`给 ${v.no} 填截止`} className="!mx-0 !w-auto text-xs text-primary" onChange={(day) => day && void updateOrder(v.id, { dueDate: day })} />}
        </span>
      )
    } },
  ]
  const todayDone = deliveredToday > 0 && !groups.some((g) => g.bucket.id === 'today')
  return (
    <section className="flex min-w-0 flex-col bg-card max-lg:border-b lg:h-full lg:min-h-0">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-4 text-sm font-medium">
        待交付 <span className="num font-normal text-muted-foreground">{rows.length}</span>
        {shown.length < rows.length && <span className="text-xs font-normal text-muted-foreground">显示 {shown.length}</span>}
      </header>
      {rows.length > 0 && <BucketChips groups={groups.map((g) => ({ bucket: g.bucket, count: g.rows.length }))} isOpen={isOpen} toggle={(b) => save({ ...saved, [b]: !isOpen(b) })}>
        {todayDone && <span className="ml-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Magnolia size={18} />今天截止的 {deliveredToday} 单都交了</span>}
      </BucketChips>}
      <div className="flex min-h-0 flex-1 flex-col">
        <DataTable fill id="tasks-drafts" freeze={3} toolbar={() => null} rows={shown} rowId={(v) => v.id} cols={cols}
          onRowClick={(v) => pick(`d:${v.id}`)}
          rowAttrs={(v) => ({ 'data-task-row': `d:${v.id}`, 'data-selected': sel === `d:${v.id}` })}
          rowClassName={(v) => rowTone(sel === `d:${v.id}`, !!v.urgency || bucketById.get(v.id) === 'late')}
          groupBy={(v) => bucketById.get(v.id) ?? 'later'}
          groupLabel={(key) => {
            const g = groups.find((x) => x.bucket.id === key)
            if (!g) return key
            return <GroupLabel bucket={g.bucket} count={g.rows.length} hint={key === 'today' ? dateHint(0) : key === 'tomorrow' ? dateHint(1) : undefined}>
              {key === 'today' && <TodayMeter done={deliveredToday} left={g.rows.length} />}
            </GroupLabel>
          }}
          empty={rows.length ? <div className="px-4 py-10 text-center text-sm text-muted-foreground">分组都收起了，点上面的分组按钮展开</div> : <Empty icon={<ClipboardText size={20} />} title="订单都交付了" />} />
      </div>
    </section>
  )
}

function FollowupTable({ tasks, now, showWriter }: { tasks: AfterSaleTask[]; now: number; showWriter: boolean }) {
  const { order, me, user } = useSession()
  const { afterSale } = useNav()
  const { sel, pick } = useContext(Selection)
  const [tab, setTab] = useState('live')
  const todayKey = businessDate(new Date())
  const at = (x: AfterSaleTask) => new Date(confirmationState(x, now) === 'waiting' ? x.confirmBy! : x.due).getTime()
  const open = tasks.filter(asOpen).sort((a, b) => Number(!!order(b.orderId)?.urgency) - Number(!!order(a.orderId)?.urgency) || at(a) - at(b))
  const doneToday = tasks.filter((a) => a.doneAt && dayOf(a.doneAt) === todayKey)
  const waitingMine = (a: AfterSaleTask) => confirmationState(a, now) === 'waiting' && a.writerId === me.id
  const waiting = open.filter(waitingMine).length
  const [saved, save] = useDevicePref<Partial<Record<Bucket, boolean>>>('tasks-open-followup-groups', {})
  const isOpen = (b: Bucket) => saved[b] ?? true
  const bucketById = new Map(open.map((a) => [a.id, asBucket(a, now)]))
  const groups = FOLLOWUP_BUCKETS
    .map((b) => ({ bucket: { ...BUCKETS.find((x) => x.id === b.id)!, label: b.label }, rows: open.filter((a) => bucketById.get(a.id) === b.id) }))
    .filter((g) => g.rows.length)
  const ordered = groups.flatMap((g) => g.rows)
  const numbers = new Map(ordered.map((a, i) => [a.id, i + 1]))
  const shown = ordered.filter((a) => isOpen(bucketById.get(a.id)!))
  const days = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const a of tasks) {
      for (const t of [a.start, a.doneAt, a.cancelledAt]) {
        if (!t) continue
        const k = dayOf(t)
        if (!m.has(k)) m.set(k, new Set())
        m.get(k)!.add(a.id)
      }
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)
  }, [tasks])
  const record = tab === 'live' ? [] : tasks.filter((a) => days.find(([k]) => k === tab)?.[1].has(a.id)).sort((a, b) => a.start.localeCompare(b.start))
  const reqOf = (a: AfterSaleTask) => a.req.join('；') || (a.shots.length ? '见截图' : '')
  const cols: Col<AfterSaleTask>[] = [
    // 默认宽度按 1440 屏右栏（约 460px）排满；倒计时放不下就折成两行，不撑宽表格
    { id: 'no', header: '#', size: 36, minSize: 32, hideable: false, cell: (a) => <RowNo n={numbers.get(a.id) ?? 0} /> },
    // 时间用短写法（13h、逾 3h、确认 58:17），一行放得下，左右两表行高一致
    { id: 'time', header: '剩余', size: 84, minSize: 76, cell: (a) => <span className="whitespace-nowrap" title={afterSaleState(a, now).label}><TaskCountdown a={a} now={now} tiny /></span> },
    { id: 'order', header: '订单', size: 130, minSize: 110, hideable: false, grow: true, cell: (a) => (
      <div className="flex min-w-0 items-center gap-1">
        <OrderBadges v={order(a.orderId) ?? {}} />
        <button type="button" data-open onClick={(e) => { e.stopPropagation(); pick(`a:${a.id}`); afterSale(a.id) }} title={a.title} className={cn(cellTitle, titleTone(bucketById.get(a.id) ?? 'later'))}>{a.title}</button>
        <CopyOrderName title={a.title} />
      </div>
    ) },
    { id: 'req', header: '要求', size: 80, minSize: 70, grow: true, cell: (a) => <span className="line-clamp-2 break-all text-xs leading-4 text-muted-foreground" title={reqOf(a) || undefined}>{a.round > 1 && <span className="mr-1.5 text-foreground/70">第 {a.round} 轮</span>}{reqOf(a) || '—'}</span> },
    ...(showWriter ? [{ id: 'writer', header: '写手', size: 56, minSize: 44, cell: (a: AfterSaleTask) => <span title={user(a.writerId)?.name} className="flex justify-center"><Avatar user={user(a.writerId)} size={20} /></span> }] : []),
    { id: 'actions', header: '操作', size: 72, minSize: 64, hideable: false, cell: (a) => waitingMine(a)
      ? <span className="text-xs text-warn">先回复时间</span>
      : <span data-deliver onClick={(e) => e.stopPropagation()}><TaskAction a={a} label="交付" /></span> },
  ]
  return (
    <section className="flex min-w-0 flex-col bg-card max-lg:border-b lg:h-full lg:min-h-0">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-4 text-sm font-medium">
        跟进 <span className="num font-normal text-muted-foreground">{open.length}</span>
        <span className="ml-auto inline-flex items-center gap-2 text-xs font-normal">
          {waiting > 0 && <span className="text-warn">待确认 {waiting}</span>}
          {doneToday.length > 0 && <span className="text-muted-foreground">今天已交 {doneToday.length}</span>}
          {days.length > 0 && (
            <Select value={tab} onValueChange={setTab}>
              <SelectTrigger aria-label="查看进行中或某天的跟进记录" className="-my-1 h-7 w-auto gap-1 border-transparent px-2 text-xs shadow-none hover:border-border"><SelectValue /></SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="live">进行中</SelectItem>
                {days.map(([k, set]) => <SelectItem key={k} value={k}>{k === todayKey ? '今天' : shortDate(k).replace('月', '.').replace('日', '')} 的记录 · {set.size}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </span>
      </header>
      {tab === 'live' ? <>
        {open.length > 0 && <BucketChips groups={groups.map((g) => ({ bucket: g.bucket, count: g.rows.length }))} isOpen={isOpen} toggle={(b) => save({ ...saved, [b]: !isOpen(b) })} />}
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable fill id="tasks-followups" freeze={3} toolbar={() => null} rows={shown} rowId={(a) => a.id} cols={cols}
            onRowClick={(a) => pick(`a:${a.id}`)}
            rowAttrs={(a) => ({ 'data-task-row': `a:${a.id}`, 'data-selected': sel === `a:${a.id}` })}
            rowClassName={(a) => rowTone(sel === `a:${a.id}`, !!order(a.orderId)?.urgency || asLate(a, now))}
            groupBy={(a) => bucketById.get(a.id) ?? 'later'}
            groupLabel={(key) => { const g = groups.find((x) => x.bucket.id === key); return g ? <GroupLabel bucket={g.bucket} count={g.rows.length} /> : key }}
            expandedRow={(a) => waitingMine(a) ? <ConfirmationPanel orderId={a.orderId} a={a} now={now} /> : null}
            empty={open.length ? <div className="px-4 py-10 text-center text-sm text-muted-foreground">分组都收起了，点上面的分组按钮展开</div> : <Empty icon={<Magnolia size={24} />} title={doneToday.length ? `今天的 ${doneToday.length} 条跟进都交完了` : '没有要改的'} />} />
        </div>
      </> : <div className="scroll-thin flex-1 lg:min-h-0 lg:overflow-y-auto">{record.map((a) => <RecordRow key={a.id} a={a} day={tab} />)}</div>}
    </section>
  )
}
