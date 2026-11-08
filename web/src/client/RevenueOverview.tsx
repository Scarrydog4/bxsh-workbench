import { IncomeEmpty } from './IncomeEmpty'
import { useIncomeReport } from './useIncomeReport'
import { PageLoading } from './PageLoading'
import { useMemo, useState } from 'react'
import { Segmented } from './controls'
import { ArrowLeft } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { incomeMoney as money, incomeAxisMoney, incomeGrains, visiblePeriod, incomeRangeCaption } from './income-display'
import { sumMoney } from '@/shared/calc'
import type { IncomeHourly, IncomeReport, IncomeReportBucket, IncomeReportGranularity, IncomeReportMetrics, IncomeReportOrder } from '@/shared/income-report'
import { DataTable, TableFooter, type Col } from './table-kit'
import { Avatar, ChannelAvatar, ChannelName, Money, StatusPill } from './ui'
import { IncomeFilterSelect } from './IncomeFilterSelect'
import { useSession } from './store'
import { useNav } from './nav'
import { usePref } from './prefs'
import { JournalTimeChart, isCurrentChartPeriod, type ChartReading } from './JournalChart'
import { IncomeDateFilter, incomeDateParams, incomePreset, type IncomeDateSelection } from './IncomeDateFilter'

function ReportAmount({value,className}: {value:number|null|undefined; className?:string}) {
  return value == null ? <Money value={value}/> : <span className={cn('num',className)}>{money(value)}</span>
}

type Metric = 'sales' | 'knownNetIncome' | 'netReceipts'
type Breakdown = 'date' | 'channel' | 'sales'
const NO_CHANNEL = '__none__'
type Aggregate = IncomeReportMetrics & { id: string; name: string; avatar?: string; hue?: number; orderIds: string[] }
const groupChoices = [['sales', '销售额'], ['knownNetIncome', '老板净收入'], ['netReceipts', '实收'], ['orderCount', '接单数'], ['pendingCount', '工资未定']]
const defaultOrders = ['orderDate', 'receiptDates', 'channel', 'owner', 'netIncome', 'periodReceipts']

export function incomeReportUrl(selection: IncomeDateSelection, granularity: IncomeReportGranularity, channelId = '', ownerId = '') {
  const params = new URLSearchParams({ ...incomeDateParams(selection), granularity })
  if (channelId) params.set('channelId', channelId)
  if (ownerId) params.set('ownerId', ownerId)
  return `/api/reports/income?${params}`
}
export function reportNetCell(row: IncomeReportOrder) { return !row.incomeIncluded ? '—' : row.netIncome === null ? '工资未定' : money(row.netIncome) }
export function incomeBucketSelection(selection: IncomeDateSelection, bucket: Pick<IncomeReportBucket, 'start' | 'end'>): IncomeDateSelection {
  return selection.mode === 'dates'
    ? { ...selection, dates: selection.dates.filter(day => day >= bucket.start && day <= bucket.end) }
    : { mode: 'range', from: selection.from > bucket.start ? selection.from : bucket.start, to: selection.to < bucket.end ? selection.to : bucket.end, dates: [] }
}


export function RevenueOverview() {
  const { s, views } = useSession(), { openOrder } = useNav()
  const [dates, setDates] = useState<IncomeDateSelection>(() => incomePreset('month'))
  const [preferred, setGranularity] = useState<IncomeReportGranularity>('day')
  const [metric, setMetric] = useState<Metric>('sales')
  const [channelId, setChannelId] = useState(''), [ownerId, setOwnerId] = useState('')
  const [breakdown, setBreakdown] = useState<Breakdown>('date')
  const [detail, setDetail] = useState<{ name: string; ids: string[]; date?: boolean; channelId?: string; ownerId?: string } | null>(null)
  const [drillDate, setDrillDate] = useState<IncomeDateSelection | null>(null)
  const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [groupColumns] = usePref<string[]>('income-report-columns', groupChoices.map(x => x[0]))
  const [orderColumns] = usePref<string[]>('income-report-order-columns', defaultOrders)
  const selectedChannel = detail?.channelId ?? channelId, selectedOwner = detail?.ownerId ?? ownerId
  const grain = incomeGrains(drillDate ?? dates, preferred), granularity = grain.value
  const url = incomeReportUrl(drillDate ?? dates, granularity, selectedChannel, selectedOwner)
  const { report, error } = useIncomeReport<IncomeReport>(url, revision)
  function resetDetail() { setDetail(null); setDrillDate(null) }
  function chooseFilters(next: { dates?: IncomeDateSelection; channelId?: string; ownerId?: string }) {
    setDates(next.dates ?? drillDate ?? dates)
    setChannelId(next.channelId ?? selectedChannel)
    setOwnerId(next.ownerId ?? selectedOwner)
    resetDetail()
  }

  const range = drillDate ?? dates
  const hasData = !!report && (report.orders.length>0 || !!report.channelReceipts?.length || !!report.summary.receipts || !!report.summary.refunds)
  const filtered = !!(selectedChannel || selectedOwner)
  const clearFilters = () => chooseFilters({channelId:'',ownerId:''})
  const empty = <IncomeEmpty clear={filtered ? clearFilters : undefined}/>
  const filteredEmpty = (clear:()=>void) => <IncomeEmpty clear={clear}/>
  const groups = useMemo<Aggregate[]>(() => {
    if (!report || !hasData) return []
    if (breakdown === 'date') return report.series.flatMap(row => {
      const period = visiblePeriod(report.selection,row)
      return period ? [{...row,id:row.key,name:granularity==='week' ? period.short : period.label}] : []
    })
    return (breakdown === 'channel' ? report.channels : report.sales).map(row => ({ ...row, orderIds: report.orders.filter(order => (breakdown === 'channel' ? order.channelId || NO_CHANNEL : order.ownerId) === (breakdown === 'channel' ? row.id || NO_CHANNEL : row.id)).map(order => order.id) }))
      .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name))
  }, [report, hasData, breakdown, metric, granularity])
  const orders = detail ? report?.orders ?? [] : []
  const orderById = new Map(views.map(view => [view.id, view]))
  const ownersFor = (row: Aggregate) => report?.sales.filter(person => row.orderIds.some(id => report.orders.some(order => order.id === id && order.ownerId === person.id))) ?? []
  const ownNet = report ? sumMoney(report.sales.filter(row => s.users.some(user => user.id === row.id && user.isAdmin)).map(row => row.knownNetIncome)) : 0
  const salesNet = report ? sumMoney(report.sales.filter(row => !s.users.some(user => user.id === row.id && user.isAdmin)).map(row => row.knownNetIncome)) : 0
  const groupCols: Col<Aggregate>[] = [
    { id: 'name', header: breakdown === 'date' ? '日期' : breakdown === 'channel' ? '渠道' : '销售', size: breakdown === 'date' && granularity === 'week' ? 210 : 160, sort: row => row.name, cell: row => <span className="inline-flex min-w-0 max-w-full items-center gap-2">{breakdown === 'channel' ? <ChannelAvatar channel={{ id: row.id, name: row.name, avatar: row.avatar }} size={22}/> : breakdown === 'sales' ? <Avatar user={s.users.find(u => u.id === row.id) ?? { id: row.id, name: row.name, avatar: row.avatar, hue: row.hue ?? 155 }} size={22}/> : null}<span className="truncate" title={row.name}>{row.name}</span></span> },
    { id: 'sales', header: '销售额', size: 128, align: 'right', sort: row => row.sales, cell: row => <ReportAmount value={row.sales} className="text-gold"/> },
    { id: 'knownNetIncome', header: breakdown === 'sales' ? '给老板赚的净收入' : '老板净收入', size: breakdown === 'sales' ? 156 : 128, align: 'right', sort: row => row.knownNetIncome, cell: row => <span className="num">{money(row.knownNetIncome)}</span> },
    { id: 'netReceipts', header: '实收', size: 128, align: 'right', sort: row => row.netReceipts, cell: row => <span className="num">{money(row.netReceipts)}</span> },
    { id: 'orderCount', header: '接单数', size: 90, align: 'right', sort: row => row.orderCount, cell: row => <span className="num">{row.orderCount}</span> },
    { id: 'avatar', header: '销售头像', size: 150, cell: row => <span className="flex flex-wrap gap-1">{ownersFor(row).map(person => <Avatar key={person.id} user={{ ...person, hue: person.hue ?? 155 }} size={25}/>)}</span> },
    { id: 'people', header: '归属销售', size: 180, filterValue: row => ownersFor(row).map(person => person.name).join('、'), cell: row => ownersFor(row).map(person => person.name).join('、') || '—' },
    { id: 'average', header: '平均单价', size: 110, align: 'right', sort: row => row.orderCount ? row.sales / row.orderCount : 0, cell: row => row.orderCount ? money(Math.round(row.sales * 100 / row.orderCount) / 100) : '—' },
    { id: 'pendingCount', header: '工资未定', size: 100, align: 'right', sort: row => row.pendingCount, cell: row => row.pendingCount ? <span className="num text-warn">{row.pendingCount} 单</span> : <span className="text-muted-foreground">—</span> },
  ]
  const orderCols: Col<IncomeReportOrder>[] = [
    { id: 'title', header: '订单名称', size: 240, sort: row => row.title, cell: row => <span className="block truncate" title={row.title}>{row.deletedAt && <span className="mr-1 text-xs text-muted-foreground">已删除</span>}{row.title}</span> },
    { id: 'orderDate', header: '下单日期', size: 118, sort: row => row.orderDate, cell: row => <span className="num text-muted-foreground">{row.orderDate}</span> },
    { id: 'receiptDates', header: '收款日期', size: 158, sort: row => row.receiptDates.join(','), cell: row => <span className="block truncate num" title={row.receiptDates.join('、')}>{row.receiptDates.join('、') || '—'}</span> },
    { id: 'channel', header: '渠道', size: 125, sort: row => row.channelName, cell: row => <ChannelName channel={{ id: row.channelId, name: row.channelName, avatar: row.channelAvatar }} size={20}/> },
    { id: 'owner', header: '销售', size: 108, sort: row => row.ownerName, cell: row => <span className="inline-flex max-w-full items-center gap-1.5"><Avatar user={s.users.find(u => u.id === row.ownerId) ?? { id: row.ownerId, name: row.ownerName, avatar: row.ownerAvatar, hue: row.ownerHue }} size={20}/><span className="truncate">{row.ownerName}</span></span> },
    { id: 'netIncome', header: '老板净收入', size: 120, align: 'right', sort: row => row.incomeIncluded ? row.netIncome ?? -Infinity : -Infinity, filterValue: row => row.incomeIncluded ? row.netIncome : null, cell: row => <span className={cn('num', row.incomeIncluded && row.netIncome === null && 'text-warn')}>{reportNetCell(row)}</span> },
    { id: 'periodReceipts', header: '实收', size: 108, align: 'right', sort: row => row.periodReceipts, cell: row => <span className="num">{money(row.periodReceipts)}</span> },
    { id: 'sales', header: '销售额', size: 105, align: 'right', sort: row => row.sales, cell: row => <ReportAmount value={row.sales} className="text-gold"/> },
    { id: 'extraCostTotal', header: '额外成本', size: 110, align: 'right', sort: row => row.extraCostTotal, cell: row => <ReportAmount value={row.extraCostTotal}/> },
    { id: 'externalWriterCost', header: '写手成本', size: 110, align: 'right', sort: row => row.externalWriterCost ?? -Infinity, filterValue: row => row.externalWriterCost, cell: row => <ReportAmount value={row.externalWriterCost}/> },
    { id: 'commissionCost', header: '销售提成', size: 110, align: 'right', sort: row => row.commissionCost ?? -Infinity, filterValue: row => row.commissionCost, cell: row => <ReportAmount value={row.commissionCost}/> },
    { id: 'ownerAvatar', header: '销售头像', size: 75, cell: row => <Avatar user={s.users.find(user => user.id === row.ownerId) ?? { id: row.ownerId, name: row.ownerName, avatar: row.ownerAvatar, hue: row.ownerHue }} size={28}/> },
    { id: 'channelAvatar', header: '渠道头像', size: 75, cell: row => <ChannelAvatar channel={{ id: row.channelId, name: row.channelName, avatar: row.channelAvatar }} size={28}/> },
    { id: 'writers', header: '写手', size: 180, filterValue: row => orderById.get(row.id)?.assignees.map(person => s.users.find(user => user.id === person.userId)?.name ?? '').join('、') ?? '', cell: row => <span className="inline-flex flex-wrap gap-2">{orderById.get(row.id)?.assignees.map(person => { const user = s.users.find(user => user.id === person.userId); return <span key={person.userId} className="inline-flex items-center gap-1"><Avatar user={user} size={22}/>{user?.name}</span> })}</span> },
    { id: 'deadline', header: '截止日期', size: 120, sort: row => orderById.get(row.id)?.dueDate ?? '', cell: row => orderById.get(row.id)?.dueDate || '—' },
    { id: 'type', header: '订单类型', size: 130, filterValue: row => orderById.get(row.id)?.type ?? '', cell: row => orderById.get(row.id)?.type || '—' },
    { id: 'status', header: '状态', size: 108, sort: row => row.status, cell: row => <StatusPill status={row.status}/> },
  ]
  return <div data-income-scroll className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto overscroll-y-contain sm:[&>.order-grid-scroll]:min-h-[280px] max-sm:[&>.order-grid-scroll]:flex-none max-sm:[&>.order-grid-scroll]:overflow-visible">
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b px-3 py-2 sm:px-4">
      <IncomeDateFilter isoLabel value={drillDate ?? dates} onChange={value => chooseFilters({ dates: value })}/>
      <div className="flex min-w-0 max-w-full gap-2 max-sm:w-full">
        <IncomeFilterSelect aria-label="收入渠道筛选" value={selectedChannel} options={report?.options.channels.map(row => ({ ...row, id: row.id || NO_CHANNEL }))} onChange={id => chooseFilters({ channelId: id })}/>
        <IncomeFilterSelect aria-label="收入销售筛选" kind="sales" value={selectedOwner} options={report?.options.sales} onChange={id => chooseFilters({ ownerId: id })}/>
      </div>
    </div>
    {report ? <>
      <div className="grid shrink-0 grid-cols-1 border-b sm:grid-cols-3">
        <div className="min-w-0 border-b px-3 py-2 sm:border-b-0 sm:border-r sm:px-4"><div className="text-xs text-muted-foreground">销售额</div><div data-sales-total className="num mt-1 break-all text-xl font-semibold text-gold sm:text-2xl">{money(report.summary.sales)}</div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">按下单日 · {report.summary.orderCount} 单</p></div>
        <div className="min-w-0 border-r px-3 py-2 sm:px-4"><div className="text-xs text-muted-foreground">老板净收入</div><div className="num mt-1 break-all text-xl font-semibold sm:text-2xl">{money(report.summary.knownNetIncome)}</div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">按下单日 · 预计收入</p><div className="mt-1 flex flex-wrap gap-x-2 text-[11px] leading-4"><span className="text-muted-foreground">自营 {money(ownNet)}</span><button className="text-primary underline-offset-2 hover:underline" onClick={() => { chooseFilters({}); setBreakdown('sales') }}>销售贡献 {money(salesNet)}</button></div></div>
        <div className="min-w-0 px-3 py-2 sm:px-4"><div className="text-xs text-muted-foreground">实收</div><div className="num mt-1 break-all text-xl font-semibold sm:text-2xl">{money(report.summary.netReceipts)}</div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">按收款日 · 收款减退款</p>{!!report.summary.unallocatedReceipts && <p className="mt-1 text-[11px] leading-4 text-primary">含未分配预收 {money(report.summary.unallocatedReceipts)}</p>}</div>
      </div>
      {report.summary.pendingCount > 0 && <div className="shrink-0 border-b px-4 py-1.5 text-xs text-warn">{report.summary.pendingCount} 单工资未定，未计入净收入</div>}
      <div className="shrink-0 border-b px-3 py-1.5 sm:px-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-1"><div className="flex items-center gap-2 text-xs"><Segmented size="sm" label="趋势指标" value={metric} onChange={setMetric} items={[['sales', '销售额'], ['knownNetIncome', '净收入'], ['netReceipts', '实收']]} /></div>{grain.items.length===1 ? <span aria-label="统计粒度" className="text-xs text-muted-foreground">{grain.hourly?'按小时':'按日'}</span> : <Segmented size="sm" className="income-local-tabs" label="统计粒度" value={granularity} onChange={setGranularity} items={grain.items}/>}</div>
        {grain.hourly && report.hourly && <div className="mb-1 text-[11px] text-muted-foreground">{report.hourly.day} · 北京时间 · 按录单 / 记账时刻</div>}
        {!grain.hourly && <p className="text-xs text-muted-foreground">{incomeRangeCaption(range,granularity)} · {metric==='netReceipts'?'按收款日期':'按下单日期'}</p>}
        {hasData && <IncomeTrend granularity={granularity} rows={report.series} metric={metric} selection={drillDate ?? dates} hourly={grain.hourly ? report.hourly : undefined}/>}
        {grain.hourly && !!report.hourly?.unknownItems.length && <details className="mb-1 rounded border bg-muted/20 px-3 py-2 text-xs"><summary className="cursor-pointer"><span className="font-medium">时间未记录</span><span className="ml-3 text-muted-foreground">净收入 <span className="num">{money(report.hourly.unknown.knownNetIncome)}</span> · 实收 <span className="num">{money(report.hourly.unknown.netReceipts)}</span> · {report.hourly.unknownItems.length} 条</span></summary><div className="mt-2 max-h-40 overflow-auto border-t">{report.hourly.unknownItems.map(item => <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 border-b py-2 last:border-0"><span className="min-w-0"><span className="mr-2 text-muted-foreground">{item.kind}</span><span>{item.title}</span></span><span className="num shrink-0">{item.value === null ? '工资未定' : money(item.value)}</span></div>)}</div></details>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 sm:px-4"><div className="flex min-w-0 items-center gap-1">{detail ? <><button aria-label="返回收入汇总" className="shrink-0 rounded p-1 hover:bg-accent" onClick={resetDetail}><ArrowLeft size={16}/></button><span className="max-w-44 truncate text-sm font-medium">{detail.name}</span></> : <Segmented size="sm" label="明细维度" value={breakdown} onChange={setBreakdown} items={[['date', '按日期'], ['channel', '渠道排行'], ['sales', '销售贡献']]} />}</div>
      </div>
      {detail && !!report.channelReceipts?.length && <details open className="max-h-[35%] shrink-0 overflow-auto border-b">
        <summary className="cursor-pointer px-4 py-2 text-xs font-medium">渠道收款 · {report.channelReceipts.length} 笔 · {money(report.summary.channelReceiptTotal ?? 0)}</summary>
        <DataTable id="income-channel-receipts" rows={report.channelReceipts} rowId={receipt => receipt.id} maxHeight="30dvh" expandedRow={receipt => expandedReceipt === receipt.id && receipt.lines.length ? <ul className="space-y-2 p-2">{receipt.lines.map(line => <li key={line.paymentId} className="flex items-start justify-between gap-3"><button type="button" disabled={!views.some(view => view.id === line.orderId)} className="min-w-0 text-left text-primary disabled:text-muted-foreground" onClick={() => openOrder(line.orderId)}><span className="block break-words" title={line.title}>{line.title || line.no}</span></button><span className="num shrink-0">{money(line.amount)}</span></li>)}</ul> : null} cols={[
          { id: 'date', header: '收款日期', size: 120, sort: receipt => receipt.date, cell: receipt => <span className="num">{receipt.date}</span> },
          { id: 'no', header: '收款编号', size: 160, sort: receipt => receipt.no, filterValue: receipt => [receipt.no, ...receipt.lines.map(line => line.title)].join(' '), cell: receipt => receipt.lines.length ? <button type="button" aria-expanded={expandedReceipt === receipt.id} className="whitespace-nowrap text-primary" onClick={() => setExpandedReceipt(old => old === receipt.id ? null : receipt.id)}>{receipt.no} · {new Set(receipt.lines.map(line => line.orderId)).size} 单</button> : receipt.no },
          { id: 'channel', header: '渠道', size: 140, sort: receipt => receipt.channelName, cell: receipt => receipt.channelName },
          { id: 'owner', header: '销售', size: 110, sort: receipt => receipt.ownerName, cell: receipt => receipt.ownerName },
          { id: 'amount', header: '原收款', size: 110, align: 'right', sort: receipt => receipt.amount, cell: receipt => <ReportAmount value={receipt.amount}/> },
          { id: 'allocated', header: '已分配', size: 110, align: 'right', sort: receipt => receipt.allocated, cell: receipt => <ReportAmount value={receipt.allocated}/> },
          { id: 'unallocated', header: '未分配', size: 110, align: 'right', sort: receipt => receipt.unallocated, cell: receipt => <ReportAmount value={receipt.unallocated} className="font-medium"/> },
        ]}/>
      </details>}
      {detail ? <DataTable fill id="income-report-orders" rows={orders} rowId={row => row.id} freeze={1} cols={orderCols} defaultVisibility={Object.fromEntries(orderCols.map(col => [col.id, col.id === 'title' || orderColumns.includes(col.id)]))} onRowClick={row => { if (views.some(v => v.id === row.id)) openOrder(row.id, orders.filter(row => views.some(v => v.id === row.id)).map(row => row.id)) }} empty={empty} filteredEmpty={filteredEmpty}/> : <DataTable fill id={`income-report-${breakdown}`} rows={groups} rowId={row => row.id} freeze={1} cols={groupCols} defaultVisibility={Object.fromEntries(groupCols.map(col => [col.id, col.id === 'name' || groupColumns.includes(col.id)]))} onRowClick={row => { setDetail({ name: row.name, ids: row.orderIds, date: breakdown === 'date', ...(breakdown === 'channel' ? { channelId: row.id || NO_CHANNEL } : breakdown === 'sales' ? { ownerId: row.id } : {}) }); if (breakdown === 'date') { const bucket = report.series.find(bucket => bucket.key === row.id)!; setDrillDate(incomeBucketSelection(dates, bucket)) } }} empty={empty} filteredEmpty={filteredEmpty}/>}
      <TableFooter>{detail ? `${orders.length} 单${report.channelReceipts?.length ? ` · ${report.channelReceipts.length} 笔渠道收款` : ''}` : `${report.summary.orderCount} 单 · ${groups.length} ${breakdown === 'date' ? '个时段' : breakdown === 'channel' ? '个渠道' : '位销售'}`}</TableFooter>
    </> : <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">{error ? <div role="alert" className="space-y-3 text-center"><p>{error}</p><Button size="sm" variant="outline" onClick={() => setRevision(old => old + 1)}>重新加载</Button></div> : <div className="w-full self-start"><PageLoading page="income" /></div>}</div>}
  </div>
}

export function IncomeTrend({ rows, metric, selection, hourly, granularity }: { rows: IncomeReportBucket[]; metric: Metric; selection?: IncomeDateSelection; hourly?: IncomeHourly; granularity?:IncomeReportGranularity }) {
  const readings = (row: IncomeReportMetrics): ChartReading[] => [
    { label: '销售额', value: money(row.sales) }, { label: '净收入', value: money(row.knownNetIncome), tone: 'primary' }, { label: '实收', value: money(row.netReceipts) }, { label: '接单', value: `${row.orderCount} 单` },
    ...(row.refunds > 0 ? [{ label: '退款', value: money(row.refunds), tone: 'danger' } as ChartReading] : []),
    ...(row.pendingCount > 0 ? [{ label: `${row.pendingCount} 单工资未定`, tone: 'warn' } as ChartReading] : []),
  ]
  if (hourly) return <JournalTimeChart hourly kind="bar" axisFormat={incomeAxisMoney} label={`${metric === 'sales' ? '销售额' : metric === 'knownNetIncome' ? '净收入' : '实收'}日内趋势图，按小时统计`} xLabel="小时" formatValue={money} rows={hourly.hours.slice(0, hourly.throughHour + 1).map((row, index) => ({
    key: row.key, tick: row.key, label: `${hourly.day} ${row.key} — ${row.key.slice(0, 2)}:59`, at: Date.parse(`${hourly.day}T${row.key}:00+08:00`), value: row[metric], readings: readings(row),
    inProgress: index === hourly.throughHour && isCurrentChartPeriod(hourly.day, hourly.day),
  }))}/>
  const points = rows.flatMap(row=>{
    const period = selection ? visiblePeriod(selection,row) : {start:row.start,end:row.end,label:row.start===row.end?row.start:row.start+' — '+row.end,short:row.start.slice(5)}
    if (!period) return []
    return [{key:row.key,label:period.label,tick:!selection && rows.length===1 ? row.start : period.short,at:Date.parse(period.start+'T00:00:00Z'),
      value:row[metric],readings:readings(row),inProgress:isCurrentChartPeriod(period.start,period.end,selection)}]
  })
  return <JournalTimeChart kind={granularity==='week'?'bar':'auto'} axisFormat={incomeAxisMoney} label={`${metric === 'sales' ? '销售额' : metric === 'knownNetIncome' ? '净收入' : '实收'}趋势图，按日期统计`} formatValue={money} rows={points}/>
}
