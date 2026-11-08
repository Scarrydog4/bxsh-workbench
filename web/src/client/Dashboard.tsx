import { writerInitialDone } from '@/shared/writer-stages'
import { isInitialDeliveryPending } from '@/shared/order-deadline'
import { Segmented } from './controls'
import { WriterDashboard } from './WriterDashboard'
import { useAfterSaleTasks, useTaskClock } from './after-sale-data'
import { confirmationState } from '@/shared/as-rules'
import { receiptTotals } from '@/shared/receipts'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, CheckCircle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { OrderView } from '@/shared/types'
import { Avatar, ChannelName, GainTag } from './ui'
import { loadIncome, useSession } from './store'
import { useNav } from './nav'
import { daysUntil, money, businessDate } from '@/shared/format'
import { incomeSummary, type IncomeRow } from '@/shared/income'
import { Due } from './Due'
import { isStale, queueOrdersView } from './orders-shortcut'
import { Spark } from './Spark'
import { ChartSkeleton, SkeletonBlock } from './PageLoading'

/** 首页金额只看到元，分留给明细 */
const yuan = (n: number) => money(Math.round(n))
const pendingDeadline = (v: OrderView) => isInitialDeliveryPending(v) && !writerInitialDone(v)

export function Dashboard() {
  const { me, can } = useSession()
  if (!can('order.create') && me.canWrite) return <WriterDashboard />
  return <Overview />
}

/** 首页三层：今天要处理 → 本月经营 → 明细 */
function Overview() {
  const { views, me, s } = useSession()
  const [incomeError, setIncomeError] = useState(false), [incomeRevision, setIncomeRevision] = useState(0)
  useEffect(() => {
    let active = true
    setIncomeError(false)
    void loadIncome(me.id).then(ok => { if (active) setIncomeError(!ok) })
    return () => { active = false }
  }, [me.id, s.version, incomeRevision])
  const onRetryIncome = () => setIncomeRevision(value => value + 1)
  const live = useMemo(() => views.filter(v => v.status !== '退单'), [views])
  const date = businessDate(new Date())
  const weekday = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short' })
  // 老板不跟单，首页只看钱和量
  if (me.isAdmin) return <BossOverview views={live} date={date} incomeError={incomeError} onRetryIncome={onRetryIncome} />
  return (
    <div className="mx-auto max-w-[1200px] space-y-8 wide:max-w-[1600px] wide:space-y-10">
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold">今天要处理</h1>
          <span className="text-xs text-muted-foreground">{weekday}</span>
        </div>
        <TodoStrip views={live} />
      </section>
      <section>
        <h2 className="mb-3 text-base font-semibold">本月 <span className="ml-1 text-sm font-normal text-muted-foreground">{Number(date.slice(5, 7))} 月 1 日至今</span></h2>
        <Metrics views={live} date={date} incomeError={incomeError} onRetryIncome={onRetryIncome} />
      </section>
      <section className="grid gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <DueList views={live} />
        <div className="space-y-8">
          <ChannelTop views={live} month={date.slice(0, 7)} />
          <Receipts views={live} />
        </div>
      </section>
    </div>
  )
}

// ---------- 老板：收入与单量 ----------

type IncomeLoadState = { incomeError: boolean; onRetryIncome: () => void }

function IncomeLoadError({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground', className)}>
    <span>收入加载失败</span><button type="button" className="rounded-md border px-3 py-1.5 text-foreground" onClick={onRetry}>重新加载</button>
  </div>
}

function BossOverview({ views, date, incomeError, onRetryIncome }: { views: OrderView[]; date: string } & IncomeLoadState) {
  const { s, me } = useSession()
  const { go } = useNav()
  const income = s.income[me.id]
  const month = date.slice(0, 7)
  const counts = daily(views, date, () => 1)
  const sales = daily(views, date, v => v.sales ?? 0)
  const net = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number)
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
    const day = (prefix: string, i: number) => `${prefix}-${String(i + 1).padStart(2, '0')}`
    const sum = (key: string) => (income ?? []).filter(r => r.date.slice(0, 10) === key).reduce((a, r) => a + (r.amount ?? 0), 0)
    return { cur: Array.from({ length: d }, (_, i) => sum(day(month, i))), last: Array.from({ length: d }, (_, i) => sum(day(prev, i))) }
  }, [income, date, month])
  const [active, setActive] = useState<number | null>(null)
  const pending = income ? incomeSummary(income, month).pending : 0
  const netNow = total(net.cur), netLast = total(net.last)
  const orderN = total(counts.cur), salesNow = total(sales.cur)
  const label = `${Number(date.slice(5, 7))} 月 1 日 – ${Number(date.slice(8))} 日`
  return (
    <div className="mx-auto max-w-[1200px] space-y-8 wide:max-w-[1600px] wide:space-y-10">
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold wide:text-xl">本月收入</h1>
          <span className="text-xs text-muted-foreground wide:text-sm">{label} · 截至当前 · 按下单日期</span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 wide:gap-4">
          <div className="col-span-2 flex min-w-0 flex-col rounded-xl border bg-card p-5 lg:row-span-2 wide:p-6">
            <div className="flex items-center justify-between text-xs text-muted-foreground wide:text-sm">
              预计净收入
              <button onClick={() => go('income')} className="inline-flex items-center gap-0.5 hover:text-primary">明细 <ArrowRight size={11} /></button>
            </div>
            {!income ? incomeError ? <IncomeLoadError onRetry={onRetryIncome} className="mt-3 min-h-48 flex-1" /> : <div role="status" aria-busy="true" className="mt-3 flex flex-1 flex-col gap-3"><span className="sr-only">正在加载本月收入…</span><div aria-hidden="true" className="flex flex-1 flex-col gap-3"><SkeletonBlock className="h-10 w-48" /><SkeletonBlock className="h-4 w-36" /><ChartSkeleton className="mt-auto h-28 wide:h-36" /></div></div> : <>
              <div className="mt-3 flex items-start gap-2"><span className="text-[40px] font-semibold leading-none tracking-tight tabular-nums wide:text-[48px]">{yuan(netNow)}</span><GainTag value={netNow} /></div>
              <div className="mt-3 h-4 text-xs text-muted-foreground wide:h-5 wide:text-sm">
                {active !== null
                  ? <span className="text-foreground">{counts.days[active]}{active === net.cur.length - 1 ? ' 截至当前' : ''} 累计 {yuan(cumulative(net.cur)[active])} · 上月同期 {yuan(cumulative(net.last)[active])}</span>
                  : <><Delta cur={netNow} last={netLast} />{pending ? ` · 另有 ${pending} 项金额未定` : ''}</>}
              </div>
              <div className="mt-auto pt-5">
                <Spark kind="line" inProgress className="h-28 wide:h-36" values={cumulative(net.cur)} compare={cumulative(net.last)} active={active} onActive={setActive} label="本月累计净收入，浅灰虚线为上月同期" />
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground wide:text-sm">
                  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-primary" />本月累计</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-primary" />今日截至当前</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-muted-foreground/60" />上月同期</span>
                </div>
              </div>
            </>}
          </div>
          <Metric
            label="销售额"
            action={<button type="button" onClick={() => go('income')} className="inline-flex items-center gap-0.5 hover:text-primary">日／周／月 <ArrowRight size={11}/></button>}
            value={yuan(salesNow)}
            valueClassName="text-gold"
            gain={salesNow}
            sub={<><Delta cur={salesNow} last={total(sales.last)} /> · 截至当前</>}
            spark={(a, set) => <Spark kind="line" inProgress values={cumulative(sales.cur)} compare={cumulative(sales.last)} active={a} onActive={set} label="本月累计销售额，浅灰虚线为上月同期" />}
            readout={i => `${sales.days[i]}${i === sales.cur.length - 1 ? ' 截至当前' : ''} 累计 ${yuan(cumulative(sales.cur)[i])}`}
          />
          <Metric
            label="接单"
            value={<>{orderN}<span className="ml-1 text-sm font-normal text-muted-foreground">单</span></>}
            sub={<Delta cur={orderN} last={total(counts.last)} />}
            spark={(a, set) => <Spark kind="bars" values={counts.cur} active={a} onActive={set} label="本月每日接单" />}
            readout={i => `${counts.days[i]} · ${counts.cur[i]} 单`}
          />
          <Metric
            label="客单价"
            value={orderN ? yuan(salesNow / orderN) : '—'}
            sub={total(counts.last) ? <>上月同期 {yuan(total(sales.last) / total(counts.last))}</> : undefined}
          />
          <Collection views={views} />
        </div>
      </section>
      <section className="grid gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px] wide:grid-cols-[minmax(0,1fr)_400px] wide:gap-x-10">
        <MonthTrend views={views} income={income} date={date} incomeError={incomeError} onRetryIncome={onRetryIncome} />
        <ChannelTop views={views} month={month} aligned />
      </section>
    </div>
  )
}

/** 柱顶标签：过万写成 ¥1.3万 */
const short = (n: number) => Math.abs(n) >= 10000 ? `¥${(n / 10000).toFixed(1).replace(/\.0$/, '')}万` : yuan(n)

type TrendMetric = 'net' | 'sales' | 'n'
const TREND: { id: TrendMetric; label: string }[] = [{ id: 'net', label: '净收入' }, { id: 'sales', label: '销售额' }, { id: 'n', label: '单量' }]

/** 近 6 个月：一组柱子，柱顶直接写数，当月实色 */
function MonthTrend({ views, income, date, incomeError, onRetryIncome }: { views: OrderView[]; income?: IncomeRow[]; date: string } & IncomeLoadState) {
  const [y, m] = date.split('-').map(Number)
  const [metric, setMetric] = useState<TrendMetric>('net')
  const [active, setActive] = useState<number | null>(null)
  const rows = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(y, m - 6 + i, 1)).toISOString().slice(0, 7)).map((key, i, all) => {
    const list = views.filter(v => v.orderDate.startsWith(key))
    return {
      key,
      month: `${Number(key.slice(5))}月`,
      // 第一根和跨年那根下面标年份
      year: i === 0 || key.slice(0, 4) !== all[i - 1].slice(0, 4) ? `${key.slice(0, 4)}年` : '',
      net: income ? incomeSummary(income, key).amount : 0,
      sales: list.reduce((a, v) => a + (v.sales ?? 0), 0),
      n: list.length,
    }
  })
  const value = (r: typeof rows[number]) => r[metric]
  const label = (r: typeof rows[number]) => metric === 'n' ? `${r.n}单` : short(value(r))
  const max = Math.max(1, ...rows.map(value))
  const last = rows.length - 1, pick = active ?? last, shown = rows[pick]
  return (
    <div className="flex h-full min-w-0 flex-col">
      <SectionTitle action={
        <Segmented size="sm" label="指标" value={metric} onChange={setMetric} items={TREND.map(t => [t.id, t.label] as const)} />
      }>每月对比</SectionTitle>
      <div className="flex-1 rounded-xl border bg-card px-5 pb-4 pt-5 wide:px-6 wide:pb-5 wide:pt-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground wide:text-sm">
          <span className="text-sm font-medium text-foreground wide:text-base">{shown.month}{pick === last && <span className="ml-1 text-xs font-normal text-muted-foreground wide:text-sm">至今</span>}</span>
          <span className="inline-flex items-baseline gap-1">净收入 {income ? <span className="font-medium tabular-nums text-foreground">{yuan(shown.net)}</span> : incomeError ? <span>暂不可用</span> : <span role="status" aria-label="净收入加载中" className="inline-block h-3 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />}</span>
          <span>销售额 <span className="font-medium tabular-nums text-gold">{yuan(shown.sales)}</span></span>
          <span><span className="font-medium tabular-nums text-foreground">{shown.n}</span> 单</span>
        </div>
        {metric === 'net' && !income ? incomeError ? <IncomeLoadError onRetry={onRetryIncome} className="mt-4 h-48 wide:h-64" /> : <div role="status" aria-busy="true" className="mt-4"><span className="sr-only">正在加载每月净收入…</span><div aria-hidden="true"><ChartSkeleton className="h-48 wide:h-64" /></div></div> : <div className="mt-4 grid h-48 grid-cols-6 items-end gap-2 border-b sm:gap-6 wide:h-64" onPointerLeave={e => { if (e.pointerType === 'mouse') setActive(null) }}>
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              aria-label={`${r.month} ${income ? `净收入 ${yuan(r.net)}，` : ''}销售额 ${yuan(r.sales)}，${r.n} 单`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              className="flex h-full flex-col items-center justify-end outline-none"
            >
              <span className={cn('mb-1.5 whitespace-nowrap text-[11px] tabular-nums transition-colors sm:text-xs wide:text-sm', i === pick ? 'font-medium text-primary' : 'text-muted-foreground/70')}>{value(r) ? label(r) : ''}</span>
              <span
                className={cn('w-full max-w-10 rounded-t-[3px] transition-colors wide:max-w-14', i === pick ? 'bg-primary' : 'bg-primary/20')}
                style={{ height: `calc(${(value(r) / max) * 100}% - 22px)`, minHeight: value(r) ? 3 : 1 }}
              />
            </button>
          ))}
        </div>}
        <div className="mt-2 grid grid-cols-6 gap-2 text-center sm:gap-6">
          {rows.map((r, i) => (
            <div key={r.key} className={cn('text-xs wide:text-sm', r.year && i > 0 && 'border-l border-border/70')}>
              <div className={cn('whitespace-nowrap', i === pick ? 'font-medium text-foreground' : 'text-muted-foreground')}>{r.month}</div>
              <div className="h-4 whitespace-nowrap text-[11px] text-muted-foreground/70 wide:h-5 wide:text-xs">{r.year}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- 第一层：今天要处理 ----------

type Todo = { key: string; label: string; count: number; sub?: string; tone: 'danger' | 'warn' | 'info'; onOpen: () => void }

function TodoStrip({ views }: { views: OrderView[] }) {
  const { me } = useSession()
  const { go, openOrder } = useNav()
  const { tasks } = useAfterSaleTasks(), now = useTaskClock()
  const queue = (list: OrderView[]) => () => list.length && openOrder(list[0].id, list.map(v => v.id))
  const review = views.filter(v => v.reviewFlag)
  const pending = views.filter(pendingDeadline)
  const late = pending.filter(v => (daysUntil(v.dueDate) ?? 1) < 0)
  const dueToday = pending.filter(v => daysUntil(v.dueDate) === 0)
  const stale = views.filter(isStale)
  const after = tasks.filter(a => !a.doneAt && !a.cancelledAt && (me.isAdmin || a.by === me.id))
  const waiting = after.filter(a => confirmationState(a, now) === 'waiting').length
  const todos: Todo[] = [
    { key: 'late', label: '已逾期', count: late.length, sub: late.length ? '最久 ' + Math.max(...late.map(v => -(daysUntil(v.dueDate) ?? 0))) + ' 天' : undefined, tone: 'danger', onOpen: queue(late) },
    { key: 'today', label: '今天截止', count: dueToday.length, tone: 'warn', onOpen: queue(dueToday) },
    { key: 'after', label: me.isAdmin ? '跟进进行中' : '我发的跟进', count: after.length, sub: waiting ? `${waiting} 项待确认` : undefined, tone: 'info', onOpen: () => go('aftersales') },
    ...(me.isAdmin ? [{ key: 'review', label: '待核对', count: review.length, tone: 'warn', onOpen: queue(review) } as Todo] : []),
    { key: 'stale', label: '超 30 天未交付', count: stale.length, tone: 'warn', onOpen: () => { queueOrdersView('stale'); go('orders') } },
  ]
  if (todos.every(t => !t.count)) return (
    <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-4 text-sm text-muted-foreground">
      <CheckCircle size={18} className="text-ok" weight="fill" /> 没有逾期、截止和待核对的单
    </div>
  )
  const tone = { danger: 'text-danger', warn: 'text-warn', info: 'text-info' }
  const bar = { danger: 'bg-danger', warn: 'bg-warn', info: 'bg-info' }
  // 有事的排前面占大块，没事的收成一行小字
  const busy = todos.filter(t => t.count), idle = todos.filter(t => !t.count)
  return (
    <>
      <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(168px,1fr))] sm:overflow-visible sm:px-0 sm:pb-0 scroll-hidden">
        {busy.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={t.onOpen}
            className="group relative min-w-[140px] snap-start overflow-hidden rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-accent/40 sm:min-w-0"
          >
            <span className={cn('absolute inset-y-3 left-0 w-[3px] rounded-r', bar[t.tone])} />
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums leading-none', tone[t.tone])}>{t.count}</div>
            <div className="mt-2 flex h-4 items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">{t.sub ?? ''}</span>
              <ArrowRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </button>
        ))}
      </div>
      {!!idle.length && <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle size={14} weight="fill" className="text-ok" />{idle.map(t => t.label).join('、')}：没有</p>}
    </>
  )
}

// ---------- 第二层：本月经营 ----------

/** 本月每天的序列，以及上月同期（同样天数）的序列 */
export function daily(views: OrderView[], date: string, pick: (v: OrderView) => number) {
  const [y, m, d] = date.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
  const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()
  const sum = (prefix: string, day: number) => views.filter(v => v.orderDate === `${prefix}-${String(day).padStart(2, '0')}`).reduce((a, v) => a + pick(v), 0)
  const cur = Array.from({ length: d }, (_, i) => sum(date.slice(0, 7), i + 1))
  const last = Array.from({ length: Math.min(d, prevDays) }, (_, i) => sum(prev, i + 1))
  return { cur, last, days: cur.map((_, i) => `${m}月${i + 1}日`) }
}
const cumulative = (list: number[]) => list.reduce<number[]>((out, v) => [...out, (out.at(-1) ?? 0) + v], [])
const total = (list: number[]) => list.reduce((a, v) => a + v, 0)

function Delta({ cur, last }: { cur: number; last: number }) {
  if (!last) return <span>上月同期 0</span>
  const pct = Math.round(((cur - last) / last) * 100)
  return <span>比上月同期 <span className={cn('font-medium tabular-nums', pct > 0 ? 'text-ok' : pct < 0 ? 'text-danger' : '')}>{pct > 0 ? '+' : ''}{pct}%</span></span>
}

function Metrics({ views, date, incomeError, onRetryIncome }: { views: OrderView[]; date: string } & IncomeLoadState) {
  const hasSales = views.some(v => v.sales !== undefined)
  const counts = daily(views, date, () => 1)
  const sales = daily(views, date, v => v.sales ?? 0)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric
        label="接单"
        value={<>{total(counts.cur)}<span className="ml-1 text-sm font-normal text-muted-foreground">单</span></>}
        sub={<Delta cur={total(counts.cur)} last={total(counts.last)} />}
        spark={(active, set) => <Spark kind="bars" values={counts.cur} active={active} onActive={set} label="本月每日接单" />}
        readout={i => `${counts.days[i]} · ${counts.cur[i]} 单`}
      />
      {hasSales ? <>
        <Metric
          label="销售额"
          value={yuan(total(sales.cur))}
          valueClassName="text-gold"
          sub={<><Delta cur={total(sales.cur)} last={total(sales.last)} /> · 截至当前</>}
          spark={(active, set) => <Spark kind="line" inProgress values={cumulative(sales.cur)} compare={cumulative(sales.last)} active={active} onActive={set} label="本月累计销售额，浅灰虚线为上月同期" />}
          readout={i => `${sales.days[i]}${i === sales.cur.length - 1 ? ' 截至当前' : ''} 累计 ${yuan(cumulative(sales.cur)[i])}${sales.last[i] !== undefined ? ` · 上月 ${yuan(cumulative(sales.last)[i])}` : ''}`}
        />
        <Collection views={views} />
      </> : <InProgress views={views} />}
      <Income month={date.slice(0, 7)} incomeError={incomeError} onRetryIncome={onRetryIncome} />
    </div>
  )
}

function Metric({ label, value, valueClassName, gain, sub, spark, readout, action }: {
  label: string
  value: ReactNode
  valueClassName?: string
  gain?: number
  sub?: ReactNode
  spark?: (active: number | null, set: (i: number | null) => void) => ReactNode
  readout?: (i: number) => string
  action?: ReactNode
}) {
  const [active, setActive] = useState<number | null>(null)
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-card p-4 wide:p-5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground wide:text-sm">{label}{action}</div>
      <div className="mt-2 flex min-w-0 items-start gap-2"><span className={cn('truncate text-[26px] font-semibold leading-none tracking-tight tabular-nums wide:text-[32px]', valueClassName)}>{value}</span>{gain !== undefined && <GainTag value={gain} />}</div>
      <div className="mt-2 h-4 truncate text-xs text-muted-foreground wide:h-5 wide:text-sm">{active !== null && readout ? <span className="text-foreground">{readout(active)}</span> : sub}</div>
      {spark && <div className="mt-auto hidden pt-3 sm:block wide:pt-4">{spark(active, setActive)}</div>}
    </div>
  )
}

function Collection({ views }: { views: OrderView[] }) {
  const { go } = useNav()
  const { unpaid } = receiptTotals(views)
  const sales = views.reduce((a, v) => a + (v.sales ?? 0), 0)
  const pct = sales ? Math.round(((sales - unpaid) / sales) * 100) : 0
  const owing = views.filter(v => (v.unpaid ?? 0) > 0).length
  return (
    <Metric
      label="待收款"
      action={<button onClick={() => go('channels')} className="inline-flex items-center gap-0.5 hover:text-primary">按渠道 <ArrowRight size={11} /></button>}
      value={yuan(unpaid)}
      valueClassName="text-foreground"
      sub={<>{owing} 单没收齐 · 全部订单</>}
      spark={() => (
        <div className="flex h-14 flex-col justify-end gap-1.5 wide:h-20">
          <div className="flex justify-between text-xs wide:text-sm"><span className="text-muted-foreground">回款率</span><span className="font-medium tabular-nums">{pct}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
          <div className="text-xs text-muted-foreground tabular-nums wide:text-sm">已收 {yuan(sales - unpaid)} / {yuan(sales)}</div>
        </div>
      )}
    />
  )
}

function InProgress({ views }: { views: OrderView[] }) {
  const list = views.filter(v => (v.status === '未交付' || v.status === '已发演示') && !writerInitialDone(v))
  return <Metric label="进行中" value={<>{list.length}<span className="ml-1 text-sm font-normal text-muted-foreground">单</span></>} sub="未交付和已发演示" />
}

function Income({ month, incomeError, onRetryIncome }: { month: string } & IncomeLoadState) {
  const { s, me, role } = useSession()
  const rows = s.income[me.id]
  const label = me.isAdmin ? '预计净收入' : role.fields.commission !== 'none' ? '我的提成' : '我的收入'
  if (!rows) return incomeError ? <Metric label={label} value="—" sub="收入加载失败" action={<button type="button" className="text-primary" onClick={onRetryIncome}>重新加载</button>} /> : <Metric label={label} value={<span role="status" aria-label="收入加载中" className="inline-block h-[26px] w-32 animate-pulse rounded-md bg-muted align-middle motion-reduce:animate-none" />} />
  const { amount, pending } = incomeSummary(rows, month)
  return <Metric label={label} value={yuan(amount)} sub={pending ? `另有 ${pending} 项金额未定` : '按下单日期'} />
}

// ---------- 第三层：明细 ----------

function SectionTitle({ children, count, action }: { children: ReactNode; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold wide:text-[18px]">{children}{count !== undefined && <span className="ml-1.5 text-sm font-normal tabular-nums text-muted-foreground wide:text-base">{count}</span>}</h2>
      {action}
    </div>
  )
}

function More({ onClick, children = '全部' }: { onClick: () => void; children?: ReactNode }) {
  return <button onClick={onClick} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary wide:text-sm">{children} <ArrowRight size={11} /></button>
}

const DUE_LIMIT = 12

function DueList({ views }: { views: OrderView[] }) {
  const { openOrder, go } = useNav()
  const { user, channel } = useSession()
  const list = views.filter(v => pendingDeadline(v) && v.dueDate && (daysUntil(v.dueDate) ?? 99) <= 7).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
  const group = (v: OrderView) => { const d = daysUntil(v.dueDate)!; return d < 0 ? '已逾期' : d === 0 ? '今天' : d === 1 ? '明天' : '7 天内' }
  const shown = list.slice(0, DUE_LIMIT)
  const ids = list.map(v => v.id)
  return (
    <div className="min-w-0">
      <SectionTitle count={list.length} action={<More onClick={() => go('orders')}>订单</More>}>7 天内截止</SectionTitle>
      {!list.length ? <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">7 天内没有要截止的单</p> : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {['已逾期', '今天', '明天', '7 天内'].map(name => {
            const rows = shown.filter(v => group(v) === name)
            if (!rows.length) return null
            const all = list.filter(v => group(v) === name).length
            return (
              <div key={name}>
                <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"><span>{name}</span><span className="tabular-nums">{all}</span></div>
                {rows.map(v => (
                  <button key={v.id} onClick={() => openOrder(v.id, ids)} className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent/50">
                    <span className="w-20 shrink-0 text-xs"><Due date={v.dueDate} status={v.status} /></span>
                    <span className="min-w-0 flex-1 truncate">{v.title}</span>
                    <span className="hidden w-28 shrink-0 truncate text-xs sm:block"><ChannelName channel={channel(v.channelId)} size={16} muted /></span>
                    <span className="flex w-14 shrink-0 justify-end">
                      {v.assignees.map(a => <Avatar key={a.userId} user={user(a.userId)} size={20} className="-ml-1.5 ring-2 ring-card first:ml-0" />)}
                    </span>
                  </button>
                ))}
              </div>
            )
          })}
          {list.length > DUE_LIMIT && <button onClick={() => openOrder(list[DUE_LIMIT].id, ids)} className="w-full border-t px-4 py-2.5 text-center text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground">还有 {list.length - DUE_LIMIT} 单</button>}
        </div>
      )}
    </div>
  )
}

function ChannelTop({ views, month, aligned = false }: { views: OrderView[]; month: string; aligned?: boolean }) {
  const { channel } = useSession()
  const { go, openChannel } = useNav()
  const hasSales = views.some(v => v.sales !== undefined)
  const rows = useMemo(() => {
    const m = new Map<string, { n: number; amt: number }>()
    for (const v of views.filter(v => v.orderDate.startsWith(month))) {
      const r = m.get(v.channelId) ?? { n: 0, amt: 0 }
      r.n++
      r.amt += v.sales ?? 0
      m.set(v.channelId, r)
    }
    return [...m.entries()].map(([id, r]) => ({ id, ...r, value: hasSales ? r.amt : r.n })).sort((a, b) => b.value - a.value).slice(0, 5)
  }, [views, month, hasSales])
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className={aligned ? 'flex h-full min-w-0 flex-col' : undefined}>
      <SectionTitle action={<More onClick={() => go('channels')}>全部渠道</More>}>当月渠道构成</SectionTitle>
      {!rows.length ? <p className={cn('text-sm text-muted-foreground', aligned ? 'flex flex-1 items-center justify-center rounded-xl border bg-card px-4 py-6 text-center' : 'py-4')}>本月还没有接单</p> : (
        <div className={aligned ? 'flex-1 rounded-xl border bg-card px-3 py-3 wide:px-4' : undefined}>
          <ul className="-mx-2">
            {rows.map((r, i) => (
              <li key={r.id}>
                <button onClick={() => openChannel(r.id)} className="group grid w-full grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm hover:bg-accent/50 wide:grid-cols-[minmax(0,9rem)_1fr_auto] wide:py-3 wide:text-base">
                  <span className="min-w-0 truncate"><ChannelName channel={channel(r.id)} size={22} /></span>
                  <span className="h-1.5 rounded-full bg-muted"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} /></span>
                  <span className={cn('flex items-center gap-1 tabular-nums', hasSales && 'text-gold')}>
                    {hasSales ? yuan(r.amt) : `${r.n} 单`}
                    <ArrowRight size={11} className="text-muted-foreground/50 transition-colors group-hover:text-primary" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Receipts({ views }: { views: OrderView[] }) {
  const { openOrder } = useNav()
  const { channel } = useSession()
  if (!views.some(v => v.sales !== undefined)) return null
  const rows = views.flatMap(v => (v.payments ?? []).filter(p => !p.revoked).map(p => ({ v, p }))).sort((a, b) => b.p.date.localeCompare(a.p.date)).slice(0, 6)
  return (
    <div>
      <SectionTitle>最近收款</SectionTitle>
      {!rows.length ? <p className="py-4 text-sm text-muted-foreground">还没有收款记录</p> : (
        <ul className="divide-y">
          {rows.map(({ v, p }) => (
            <li key={p.id}>
              <button onClick={() => openOrder(v.id, undefined, 'payments')} className="flex w-full items-center gap-2 py-2 text-left text-sm hover:text-primary">
                <ChannelName channel={channel(v.channelId)} size={18} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{v.title}</span>
                <span className={cn('shrink-0 tabular-nums', p.tag === '退款' && 'text-danger')}>{p.tag === '退款' ? '−' : '+'}{yuan(Math.abs(p.amount))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
