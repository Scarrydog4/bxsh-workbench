import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle, ClipboardText, TrendUp } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { businessDate, shortDate } from '@/shared/format'
import { buildWriterWorkbench, type WriterWorkbenchRow } from '@/shared/writer-workbench'
import { useSession } from './store'
import { useNav } from './nav'
import { useAfterSaleTasks } from './after-sale-data'
import { DataTable, TableFooter, TablePageHeader, type Col } from './table-kit'
import { ChannelName, Empty, SkeletonRows, StatusPill } from './ui'
import { Segmented } from './controls'
import { OrderProgress } from './OrderProgress'
import { OrderBadges } from './OrderUrgency'
import { Due } from './Due'
import { DeliverButton } from './DeliverButton'
import { TaskCountdown } from './TaskCard'
import { AfterSaleColumn } from './TasksPage'
import { WriterDeliveryHistory } from './WriterDeliveryHistory'

type WriterTableRow = WriterWorkbenchRow & { channelName: string }
const WorkbenchContext = createContext({ now: 0, ids: [] as string[], ready: false })

function OrderTitle({ row }: { row: WriterWorkbenchRow }) {
  const { ids } = useContext(WorkbenchContext)
  const { openOrder } = useNav()
  return <div className="flex min-w-0 items-center gap-1.5"><OrderBadges v={row.order}/><button type="button" title={row.order.title} className="min-w-0 flex-1 truncate text-left font-medium hover:text-primary" onClick={e => { e.stopPropagation(); openOrder(row.order.id, ids) }}>{row.order.title}</button></div>
}
function OrderChannel({ row }: { row: WriterWorkbenchRow }) {
  const { channel } = useSession()
  return <ChannelName channel={channel(row.order.channelId)}/>
}
function Deadline({ row }: { row: WriterWorkbenchRow }) {
  const { now } = useContext(WorkbenchContext)
  return row.nextTask ? <TaskCountdown a={row.nextTask} now={now} short/> : row.order.status === '已发演示' && !row.groupDone ? <span className="text-xs text-muted-foreground">待正式交付</span> : row.stage === 'initial' ? <Due date={row.order.dueDate} status="未交付"/> : <span className="text-xs text-muted-foreground">{row.stage === 'group' ? '待安排发群' : '—'}</span>
}
// 列和 cell 身份保持稳定，倒计时/数据刷新不会卸载正在上传的交付面板。
const WRITER_COLUMNS: Col<WriterTableRow>[] = [
    { id: 'title', header: '订单名称', hideable: false, size: 300, sort: r => r.order.title, cell: r => <OrderTitle row={r}/> },
    { id: 'stage', header: '交付进度', size: 105, sort: r => r.stageLabel, cell: r => <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs', r.stage === 'done' ? 'text-ok' : r.stage === 'followup' ? 'text-warn' : 'text-foreground')}>
      {r.stage === 'done' ? <CheckCircle size={14} weight="fill"/> : <span className={cn('h-1.5 w-1.5 rounded-full', r.stage === 'followup' ? 'bg-warn' : 'bg-primary')}/>}{r.stageLabel}
    </span> },
    { id: 'progressNote', header: '当前进度', size: 200, sort: r => r.order.progressNote ?? '', cell: r => <OrderProgress v={r.order}/> },
    { id: 'deadline', header: '处理截止', size: 155, sort: r => r.deadlineAt ?? '9999', filterValue: r => r.deadlineAt ? r.deadlineAt.slice(0, 10) : null, cell: r => <Deadline row={r}/> },
    { id: 'actions', header: '操作', size: 190, cell: r => <WorkbenchActions row={r}/> },
    { id: 'requirements', header: '本次要求', size: 260, filterValue: r => r.nextTask?.req.join('；') || r.order.note, cell: r => {
      const text = r.nextTask?.req.join('；') || r.order.note
      return <span className="flex min-w-0 items-center gap-2 text-xs"><span className="shrink-0 text-muted-foreground">{r.nextTask ? `第 ${r.nextTask.round} 轮 · ${r.nextTask.reason}` : ''}</span><span className="truncate" title={text || undefined}>{text || (r.nextTask ? '查看要求截图' : '—')}</span></span>
    } },
    { id: 'channel', header: '渠道', size: 150, sort: r => r.channelName, cell: r => <OrderChannel row={r}/> },
    { id: 'orderDate', header: '下单日期', size: 120, sort: r => r.order.orderDate, cell: r => shortDate(r.order.orderDate) },
    { id: 'status', header: '订单状态', size: 110, sort: r => r.order.status, cell: r => <StatusPill status={r.order.status}/> },
    { id: 'urgency', header: '加急说明', size: 220, filterValue: r => r.order.urgency?.note ?? '', cell: r => <span className="block truncate text-xs text-warn" title={r.order.urgency?.note}>{r.order.urgency?.note || '—'}</span> },
    { id: 'group', header: '微信群', size: 220, sort: r => r.order.wechatGroup, cell: r => <span className="block truncate text-xs" title={r.order.wechatGroup}>{r.order.wechatGroup || '—'}</span> },
  ]

/** 写手工作台沿用大表，只把默认信息和顺序换成交付优先。 */
export function WriterDashboard() {
  const { views, me, channel } = useSession()
  const { openOrder, go } = useNav()
  const { tasks, loading, error } = useAfterSaleTasks()
  const [now, setNow] = useState(Date.now)
  const [scope, setScope] = useState<'pending' | 'delivered' | 'all'>('pending')
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const work = useMemo(() => buildWriterWorkbench(views, tasks, me.id, now), [views, tasks, me.id, now])
  const rows = useMemo(() => (scope === 'pending' ? work.rows.filter(r => r.stage !== 'done' && r.stage !== 'followup') : work.rows).map(r => ({ ...r, channelName: channel(r.order.channelId)?.name ?? '' })), [scope, work.rows, channel])
  const followups = useMemo(() => work.rows.flatMap(r => r.tasks), [work.rows])
  const pending = work.rows.length - work.summary.done
  const ids = rows.map(r => r.order.id)

  return <WorkbenchContext.Provider value={{ now, ids, ready: !loading && !error }}><div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
    <TablePageHeader title="我的工作台" summary={`${pending} 单待处理`}>
      <Button variant="ghost" size="sm" className="gap-1 text-primary" onClick={() => go('income')}>完整收入 <ArrowRight size={14}/></Button>
    </TablePageHeader>
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2.5 text-xs">
      <span className="font-medium text-foreground">交付与质量</span>
      <span className="text-muted-foreground">待完成 <b className="num font-medium text-foreground">{work.summary.initial}</b></span>
      <span className="text-muted-foreground">待发群 <b className="num font-medium text-foreground">{work.summary.group}</b></span>
      <span className="text-muted-foreground">待跟进 <b className="num font-medium text-foreground">{work.summary.followup}</b></span>
      {work.summary.urgent > 0 && <span className="font-medium text-warn">加急 {work.summary.urgent}</span>}
      <span className="ml-auto text-muted-foreground">{businessDate(new Date(now))}</span>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
      <Segmented size="sm" label="工作台范围" value={scope} onChange={setScope} items={[[ 'pending', '待处理' ], [ 'delivered', '已交付' ], [ 'all', '全部订单' ]]}/>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        {work.growthHints.length > 0 ? <><TrendUp size={15} className="shrink-0 text-primary"/><span>{work.growthHints.slice(0, 2).join(' · ')}</span></> : <><CheckCircle size={15} className="shrink-0"/><span>交付前核对要求与截图，跟进逐项确认</span></>}
      </span>
    </div>
    {scope === 'delivered' ? <div className="min-h-0 flex-1"><WriterDeliveryHistory/></div> : <>
    {error && <div role="alert" className="shrink-0 border-b px-4 py-2 text-xs text-warn">跟进暂未加载，交付操作已暂停。<button className="ml-2 underline" onClick={() => window.dispatchEvent(new Event('bxsh:changed'))}>重试</button></div>}
    <div className="grid min-h-0 flex-1 grid-cols-1 content-start overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
    <section aria-label="订单" className="flex h-[70dvh] min-h-[360px] min-w-0 flex-col lg:h-full lg:min-h-0">
    {loading ? <SkeletonRows rows={8}/> : <DataTable fill id={`writer-workbench:${me.id}`} cols={WRITER_COLUMNS} rows={rows} rowId={r => r.order.id}
      onRowClick={r => openOrder(r.order.id, ids, r.nextTask ? 'aftersale' : undefined)}
      defaultVisibility={{ requirements: false, orderDate: false, status: false, urgency: false, group: false }}
      empty={<Empty icon={<ClipboardText size={22}/>} title={scope === 'pending' ? '目前没有待交付订单' : '还没有分配的订单'}/>}
      footer={table => <TableFooter>{table.getRowModel().rows.length} 单 · 默认加急优先，再按截止排列<span className="ml-auto hidden sm:inline">点击订单查看要求与截图</span></TableFooter>}/>}
    </section>
    <aside aria-label="我的跟进" className="order-first flex h-[min(60dvh,420px)] min-h-0 min-w-0 flex-col border-b lg:order-last lg:h-full lg:border-b-0 lg:border-l">
      {loading ? <SkeletonRows rows={3}/> : error ? <div className="p-4 text-sm text-muted-foreground">跟进暂未加载</div> : <AfterSaleColumn tasks={followups} now={now} showWriter={false} compact/>}
    </aside>
    </div>
    </>}
  </div></WorkbenchContext.Provider>
}

function WorkbenchActions({ row }: { row: WriterWorkbenchRow }) {
  const { ready } = useContext(WorkbenchContext)
  const { can } = useSession()
  const { openOrder } = useNav()
  if (!ready) return <span className="text-xs text-muted-foreground">等待跟进加载</span>
  const task = row.nextTask
  if (!task && row.order.afterSales.some(a => !a.doneAt && !a.cancelledAt)) return <button className="text-xs text-muted-foreground" onClick={e => { e.stopPropagation(); openOrder(row.order.id, undefined, 'aftersale') }}>协作跟进中 · 查看</button>
  return <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
    {task ? <button className="text-xs text-primary" onClick={() => openOrder(row.order.id, undefined, 'aftersale')}>查看跟进 · {row.pendingTasks.length}</button> : row.stage !== 'done' && can('order.draft') ? <DeliverButton kind="draft" orderId={row.order.id} no={row.order.no}/> : <button className="text-xs text-primary" onClick={() => openOrder(row.order.id)}>查看交付</button>}
  </div>
}
