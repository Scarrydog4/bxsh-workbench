import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { IncomeEmpty } from './IncomeEmpty'
import { useIncomeReport } from './useIncomeReport'
import { PageLoading } from './PageLoading'
import { useMemo, useState } from 'react'
import { Segmented } from './controls'
import { ArrowLeft, WarningCircle } from '@phosphor-icons/react'
import { incomeMoney as money, incomeAxisMoney, incomeGrains, visiblePeriod, incomeRangeCaption } from './income-display'
import type { IncomeReportGranularity } from '@/shared/income-report'
import type { PersonalIncomeMetrics, PersonalIncomeReport, PersonalIncomeOrder } from '@/shared/personal-income-report'
import type { SalesIncomeReport } from '@/shared/sales-income-report'
import { IncomeDateFilter, incomeDateParams, incomePreset, type IncomeDateSelection } from './IncomeDateFilter'
import { incomeBucketSelection } from './RevenueOverview'
import { JournalTimeChart, isCurrentChartPeriod, type ChartReading } from './JournalChart'
import { DataTable, type Col } from './table-kit'
import { Avatar, ChannelAvatar, Person, StatusPill } from './ui'
import { IncomeFilterSelect } from './IncomeFilterSelect'
import { useSession } from './store'
import { useNav } from './nav'

export function personalIncomeReportUrl(dates: IncomeDateSelection, granularity: IncomeReportGranularity, channelId = '') {
  const params = new URLSearchParams({ ...incomeDateParams(dates), granularity })
  if (channelId) params.set('channelId', channelId)
  return `/api/reports/personal-income?${params}`
}
export function salesIncomeReportUrl(dates: IncomeDateSelection, granularity: IncomeReportGranularity, channelId = '', payeeId = '') {
  const params = new URLSearchParams({ ...incomeDateParams(dates), granularity })
  if (channelId) params.set('channelId', channelId)
  if (payeeId) params.set('payeeId', payeeId)
  return `/api/reports/sales-income?${params}`
}
const readings = (row: PersonalIncomeMetrics, showCommission: boolean, showWages: boolean, paidLabel = '已领取', earnedLabel = '应得收入'): ChartReading[] => [
  { label: earnedLabel, value: money(row.earned), tone: 'primary' },
  ...(showCommission ? [{ label: '销售提成', value: money(row.commission) }] : []),
  ...(showWages ? [{ label: '写手工资', value: money(row.wages) }] : []), { label: paidLabel, value: money(row.paid) },
  ...(row.pendingCount ? [{ label: `${row.pendingCount} 项金额未定`, tone: 'warn' } as ChartReading] : []),
]

function remainingCell(row:{remaining:number;undatedDeducted?:number}) {
  if (!row.undatedDeducted) return money(row.remaining)
  return <span className="inline-flex flex-col"><span>{money(row.remaining)}</span><small className="whitespace-normal text-xs text-muted-foreground">已扣未记日期款 {money(row.undatedDeducted)}</small></span>
}

export function PersonalRevenueOverview({ mode = 'self' }: { mode?: 'self' | 'sales' | 'writer' } = {}) {
  const { s, views, role, user, can, me } = useSession(), { openOrder } = useNav()
  const salesView = mode === 'sales', teamView = mode !== 'self', staffLabel = salesView ? '销售' : '写手'
  const paidLabel = teamView ? '已结算' : '已领取'
  const tableId = teamView ? `${mode}-income` : 'personal-income'
  const writerView = !teamView && !can('order.create') && me.canWrite
  const earnedLabel = teamView ? (salesView ? '应得提成' : '应得工资') : writerView ? '交付应得' : '应得收入'
  const orderById = new Map(views.map(view => [view.id, view]))
  const ownerOf = (orderId: string) => user(orderById.get(orderId)?.ownerId ?? '')
  const showCommission = !teamView && role.fields.commission !== 'none', showWages = !teamView && role.fields.writerPay !== 'none'
  const [dates, setDates] = useState<IncomeDateSelection>(() => incomePreset(teamView ? 'today' : 'month'))
  const [preferred, setGranularity] = useState<IncomeReportGranularity>('day'), [metric, setMetric] = useState<'earned' | 'paid'>('earned')
  const [channelId, setChannelId] = useState(''), [payeeId, setPayeeId] = useState(''), [breakdownChoice, setBreakdown] = useState<'date' | 'channel' | 'sales' | null>(null)
  const [detail, setDetail] = useState<{ name: string; dates?: IncomeDateSelection; channelId?: string; payeeId?: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const selectedDates = detail?.dates ?? dates, selectedChannel = detail?.channelId ?? channelId, selectedPayee = detail?.payeeId ?? payeeId
  const grain = incomeGrains(selectedDates,preferred), granularity = grain.value
  const breakdown = breakdownChoice ?? (teamView && grain.hourly ? 'sales' : 'date')
  const url = teamView ? salesIncomeReportUrl(selectedDates, granularity, selectedChannel, selectedPayee).replace('/sales-income?', `/${mode}-income?`) : personalIncomeReportUrl(selectedDates, granularity, selectedChannel)
  const { report, error } = useIncomeReport<PersonalIncomeReport | SalesIncomeReport>(url, revision)
  const hourly = grain.hourly ? report?.hourly : undefined
  const salesReport = report && 'sales' in report ? report : null

  const series = useMemo(() => (report?.series ?? []).flatMap(row => {
    const period = visiblePeriod(report!.selection,row)
    return period ? [{...row,period}] : []
  }), [report])
  const hasData = !!report?.orders.length
  const filtered = !!(selectedChannel || selectedPayee)
  function clearFilters() {
    setChannelId(''); setPayeeId(''); setDetail(null)
    setDates(selectedDates)
  }
  const empty = <IncomeEmpty clear={filtered ? clearFilters : undefined}/>
  const filteredEmpty = (clear:()=>void) => <IncomeEmpty clear={clear}/>
  const groups = useMemo<(PersonalIncomeMetrics & { id: string; name: string; avatar?: string })[]>(() => !hasData || !report ? [] : breakdown === 'date'
    ? series.map(row => ({ ...row, id: row.key, name: granularity === 'week' ? row.period.short : row.period.label }))
    : [...(breakdown === 'sales' ? salesReport?.sales ?? [] : report.channels)].sort((a, b) => b[metric] - a[metric]), [hasData, report, series, granularity, salesReport, breakdown, metric])
  type IncomeOrder = PersonalIncomeOrder & { payeeId?: string; payeeName?: string; payeeAvatar?: string }
  const orderColumns: Col<IncomeOrder>[] = [
    { id: 'title', header: '订单', size: 280, sort: row => row.title, cell: row => <span className="block truncate font-medium" title={row.title}>{row.title}</span> },
    ...(teamView ? [{ id: 'payee', header: '收入人', size: 140, filterValue: (row: IncomeOrder) => row.payeeName ?? '', cell: (row: IncomeOrder) => <span title={row.payeeName}><Person user={{ id: row.payeeId ?? '', name: row.payeeName ?? '', avatar: row.payeeAvatar, hue: 155 }}/></span> }] : []),
    { id: 'kind', header: '类别', size: 100, filterValue: row => row.kind, cell: row => row.kind },
    { id: 'earned', header: '本期应得', size: 110, align: 'right', filterValue: row => row.included ? row.earned : null, cell: row => row.included ? row.earned === null ? <span className="text-warn">金额未定</span> : money(row.earned) : '—' },
    { id: 'paid', header: '本期'+paidLabel, size: 110, align: 'right', sort: row => row.paid, cell: row => money(row.paid) },
    { id: 'remaining', header: teamView ? '整单剩余' : '整单待领', size: 110, align: 'right', sort: row => row.remaining, cell: row => remainingCell(row) },
    { id: 'channel', header: '渠道', size: 160, filterValue: row => row.channelName, cell: row => <span className="inline-flex max-w-full items-center gap-2"><ChannelAvatar channel={{ id: row.channelId, name: row.channelName, avatar: row.channelAvatar }}/><span className="truncate">{row.channelName}</span></span> },
    ...(writerView ? [{ id: 'owner', header: '归属销售', size: 130, filterValue: (row: PersonalIncomeOrder) => ownerOf(row.id)?.name ?? '', cell: (row: PersonalIncomeOrder) => <Person user={ownerOf(row.id)}/> }] : []),
    { id: 'status', header: '订单状态', size: 100, filterValue: row => row.status, cell: row => <StatusPill status={row.status}/> },
    { id: 'date', header: writerView ? '交付日期' : '下单日期', size: 120, sort: row => writerView ? row.deliveryDate ?? '' : row.orderDate, cell: row => writerView ? row.deliveryDate ?? '未记日期' : row.orderDate },
  ]
  function settlementOf(row: IncomeOrder) {
    if (row.earned === null) return '金额未定'
    if (row.remaining <= 0) return '已结清'
    const payee = row.payeeId ?? me.id
    const paid = orderById.get(row.id)?.settlements?.some(line => line.payeeId === payee && line.kind === row.kind && line.status === '已确认' && line.amount > 0)
    return paid ? '部分结算' : '待结算'
  }
  orderColumns.push(
    { id: 'type', header: '订单类型', size: 140, filterValue: row => orderById.get(row.id)?.type ?? '', cell: row => orderById.get(row.id)?.type || '—' },
    { id: 'wechatGroup', header: '微信群', size: 240, filterValue: row => orderById.get(row.id)?.wechatGroup ?? '', cell: row => <span className="block truncate">{orderById.get(row.id)?.wechatGroup || '—'}</span> },
    { id: 'avatar', header: '人员头像', size: 72, cell: row => <Avatar user={row.payeeId ? user(row.payeeId) ?? { id: row.payeeId, name: row.payeeName ?? '', avatar: row.payeeAvatar, hue: 155 } : me} size={28}/> },
    { id: 'channelAvatar', header: '渠道头像', size: 72, cell: row => <ChannelAvatar channel={{ id: row.channelId, name: row.channelName, avatar: row.channelAvatar }} size={28}/> },
    { id: 'ownerAvatar', header: '销售头像', size: 72, cell: row => <Avatar user={ownerOf(row.id)} size={28}/> },
    { id: 'deadline', header: '截止日期', size: 120, sort: row => orderById.get(row.id)?.dueDate ?? '', cell: row => orderById.get(row.id)?.dueDate ?? '—' },
    { id: 'settlement', header: '结算状态', size: 110, filterValue: row => settlementOf(row), cell: row => settlementOf(row) },
  )
  if (writerView) orderColumns.push({ id: 'orderDate', header: '下单日期', size: 120, sort: row => row.orderDate, cell: row => row.orderDate })
  else orderColumns.push({ id: 'deliveryDate', header: '交付日期', size: 120, sort: row => row.deliveryDate ?? '', cell: row => row.deliveryDate ?? '—' })
  if (mode === 'writer') orderColumns.push({ id: 'rate', header: '写手比例', size: 105, filterValue: row => orderById.get(row.id)?.assignees.find(person => person.userId === row.payeeId)?.rate ?? null, cell: row => {
    const rate = orderById.get(row.id)?.assignees.find(person => person.userId === row.payeeId)?.rate
    return rate == null ? '按金额' : `${Number((rate * 100).toFixed(2))}%`
  } })
  if (!writerView) orderColumns.push({ id: 'owner', header: '归属销售', size: 130, filterValue: row => ownerOf(row.id)?.name ?? '', cell: row => <Person user={ownerOf(row.id)}/> })
  function peopleFor(row: { id: string; name: string; avatar?: string }) {
    if (breakdown === 'sales') return [row]
    return (breakdown === 'date' ? salesReport?.peopleByPeriod?.[row.id] : salesReport?.peopleByChannel?.[row.id]) ?? []
  }
  function change(next: IncomeDateSelection) { setBreakdown(null); setDates(next); setChannelId(selectedChannel); setPayeeId(selectedPayee); setDetail(null) }
  return <div data-income-scroll className="income-report flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-y-contain [&>.order-grid-scroll]:flex-none">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
      <IncomeDateFilter isoLabel value={selectedDates} onChange={change}/>
      <div className="flex min-w-0 flex-wrap gap-2 max-sm:w-full">
        <IncomeFilterSelect aria-label="个人收入渠道筛选" value={selectedChannel} options={report?.options.channels} onChange={id => { setDates(selectedDates); setPayeeId(selectedPayee); setChannelId(id); setDetail(null) }}/>
        {teamView && <IncomeFilterSelect aria-label={`${staffLabel}收入人员筛选`} kind={salesView ? 'sales' : 'writer'} value={selectedPayee} options={salesReport?.options.sales} onChange={id => { setDates(selectedDates); setPayeeId(id); setChannelId(selectedChannel); setDetail(null) }}/>}
      </div>
    </div>
    {report ? <>
      <div className="income-kpis flex shrink-0 flex-wrap divide-x border-b">
        {writerView ? <>
          <div role="group" aria-label="总工资" className="min-w-0 px-3 py-3 sm:px-4"><div className="text-xs text-muted-foreground">总工资</div><div className="num mt-1 whitespace-nowrap text-xl font-semibold">{report.wageSummary ? money(report.wageSummary.total) : '—'}</div><div className="mt-1 text-xs leading-4 text-muted-foreground">含未交付 · 全部日期</div></div>
          <div role="group" aria-label="交付应得" className="min-w-0 px-3 py-3 sm:px-4"><div className="text-xs text-muted-foreground">交付应得</div><div className="num mt-1 whitespace-nowrap text-xl font-semibold">{money(report.summary.wages)}</div><div className="mt-1 text-xs leading-4 text-muted-foreground">按所选交付日期 · 待领 {money(report.summary.remaining)}</div></div>
          <div role="group" aria-label="已领取" className="min-w-0 px-3 py-3 sm:px-4"><div className="text-xs text-muted-foreground">已领取</div><div className="num mt-1 whitespace-nowrap text-xl font-semibold">{money(report.summary.paid)}</div><div className="mt-1 text-xs leading-4 text-muted-foreground">按实际发放日期</div></div>
        </> : <>
        <div className="min-w-0 px-3 py-3 sm:px-4"><div className="text-xs text-muted-foreground">{earnedLabel}</div><div className="num mt-1 whitespace-nowrap text-xl font-semibold">{money(report.summary.earned)}</div><div className="mt-1 text-xs leading-4 text-muted-foreground">{teamView ? (salesView ? '按下单日 · 原约定提成' : '按下单日／追加日 · 约定工资') : writerView ? '按本人交付日期' : [showCommission && `提成 ${money(report.summary.commission)}`, showWages && `工资 ${money(report.summary.wages)}`].filter(Boolean).join(' · ')}</div></div>
        <div className="min-w-0 px-3 py-3 sm:px-4"><div className="text-xs text-muted-foreground">{paidLabel}</div><div className="num mt-1 whitespace-nowrap text-xl font-semibold">{money(report.summary.paid)}</div><div className="mt-1 text-xs text-muted-foreground">{teamView ? '按实际结算日' : '按实际发放日'}</div></div>
        <div className="min-w-0 px-3 py-3 sm:px-4" title={writerView ? '所选交付日期关联订单的当前剩余，已扣历次结算' : '所选接单或追加日期关联订单的当前剩余，已扣除这些订单历次结算'}><div className="flex items-center gap-1 text-xs text-muted-foreground">{teamView ? '待结算' : '关联订单待领'}
          <Popover><PopoverTrigger asChild><button type="button" aria-label="待结算计算说明" className="grid size-6 place-items-center rounded-full font-semibold hover:bg-accent">?</button></PopoverTrigger><PopoverContent align="end" className="w-56 p-3 text-xs">所选日期产生应得的订单，按当前余额汇总，已扣除历次结算。只在本期发钱的旧订单不计入这项余额。</PopoverContent></Popover></div><div className="num mt-1 whitespace-nowrap text-xl font-semibold">{money(report.summary.remaining)}</div><div className="mt-1 text-xs text-muted-foreground">{report.summary.orderCount} 单 · {teamView ? '已扣历次结算' : writerView ? '按交付日期 · 已扣历次结算' : '按下单／追加日期'}</div></div>
        </>}
      </div>
      {(writerView ? report.wageSummary?.pendingCount : report.summary.pendingCount) ? <div className="shrink-0 px-4 py-2 text-xs text-warn">{writerView ? report.wageSummary?.pendingCount+' 单工资未定，暂未计入总工资' : report.summary.pendingCount+' 项金额未定，暂未计入应得'}</div> : null}
      {report.undatedCount>0 && <div className="income-warning mx-4 my-2 flex shrink-0 items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm"><WarningCircle size={18} weight="duotone" className="shrink-0 text-warn"/><span><strong className="font-medium">历史{paidLabel} <span className="num">{money(report.undatedPaid)}</span> 未记日期</strong><span className="ml-2 text-xs">共 {report.undatedCount} 笔，不计入本期{paidLabel}。</span></span>{role.locked && <a className="ml-auto shrink-0 text-sm text-primary hover:underline" href="/settlements">查看发放记录</a>}</div>}
      {!detail && <div className="shrink-0 border-b px-3 py-2 sm:px-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs"><Segmented className="income-local-tabs" size="sm" label="趋势指标" value={metric} onChange={setMetric} items={[['earned', earnedLabel], ['paid', paidLabel]]} />{grain.items.length===1 ? <span aria-label="统计粒度" className="text-xs text-muted-foreground">{grain.hourly?'按小时':'按日'}</span> : <Segmented className="income-local-tabs" size="sm" label="统计粒度" value={granularity} onChange={setGranularity} items={grain.items}/> }</div>
        {hourly && <div className="text-xs text-muted-foreground">{hourly.day} · 北京时间 · {metric==='paid' ? '按实际确认时刻' : writerView ? '按可核实的交付时刻' : '按可核实的录单时刻'}</div>}
        {!hourly && <p className="text-xs text-muted-foreground">{incomeRangeCaption(selectedDates,granularity)} · {metric==='paid'?'按实际确认日期':writerView?'按本人交付日期':salesView?'按下单日期':'按下单／追加日期'}</p>}
        {hasData && <JournalTimeChart hourly={!!hourly} kind={hourly || granularity==='week'?'bar':'auto'} axisFormat={incomeAxisMoney} label={`${teamView ? staffLabel : '个人'}${metric === 'earned' ? earnedLabel : paidLabel}趋势图`} formatValue={money} xLabel={hourly ? '小时' : '日期'} rows={hourly ? hourly.hours.slice(0, hourly.throughHour + 1).map((row, index) => ({ key: row.key, tick: row.key, label: `${hourly!.day} ${row.key}`, at: Date.parse(`${hourly!.day}T${row.key}:00+08:00`), value: row[metric], readings: readings(row, showCommission, showWages && !writerView, paidLabel, earnedLabel), inProgress: index === hourly!.throughHour && isCurrentChartPeriod(hourly!.day, hourly!.day) })) : series.map(row => ({ key: row.key, tick: row.period.short, label: row.period.label, at: Date.parse(`${row.period.start}T00:00:00Z`), value: row[metric], readings: readings(row, showCommission, showWages && !writerView, paidLabel, earnedLabel), inProgress: isCurrentChartPeriod(row.start, row.end, selectedDates) }))}/>}
        {hourly && (hourly.unknown.earned !== 0 || hourly.unknown.paid !== 0 || hourly.unknown.pendingCount > 0) && <div className="py-1 text-xs text-muted-foreground">时间未记录 · 应得 {money(hourly.unknown.earned)} · {paidLabel} {money(hourly.unknown.paid)}</div>}
      </div>}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2 sm:px-4">{detail ? <><button aria-label="返回个人收入汇总" className="rounded p-1 hover:bg-accent" onClick={() => setDetail(null)}><ArrowLeft size={16}/></button><span className="text-sm font-medium">{detail.name}</span></> : <Segmented className="income-local-tabs" size="sm" label="明细维度" value={breakdown} onChange={setBreakdown} items={teamView ? [['date', '按日期'], ['sales', `按${staffLabel}`], ['channel', '按渠道']] : [['date', '按日期'], ['channel', '渠道排行']]} />}</div>
      {detail ? <DataTable fill id={`${tableId}-orders`} empty={empty} filteredEmpty={filteredEmpty} defaultVisibility={{ kind: false, status: false, date: false, avatar: false, channelAvatar: false, owner: false, ownerAvatar: false, type: false, wechatGroup: false, rate: false, orderDate: false, deliveryDate: false, deadline: false, settlement: false }} rows={report.orders} rowId={row => row.key} cols={orderColumns} onRowClick={row => { if (row.accessible && views.some(view => view.id === row.id)) openOrder(row.id) }}/>
        : <DataTable fill id={`${tableId}-${breakdown}`} countLabel={(matching,total)=>`${report.summary.orderCount} 单 · ${matching===total?total:matching+'/'+total} ${breakdown==='date'?'个时段':breakdown==='sales'?'位'+staffLabel:'个渠道'}`} defaultVisibility={{ avatar: false, people: false, average: false, pending: false }} rows={groups} rowId={row => row.id} empty={empty} filteredEmpty={filteredEmpty} onRowClick={row => { if (breakdown === 'date') { const bucket = report.series.find(bucket => bucket.key === row.id)!; setDetail({ name: row.name, dates: incomeBucketSelection(selectedDates, bucket) }) } else if (breakdown === 'sales') setDetail({ name: row.name, payeeId: row.id }); else setDetail({ name: row.name, channelId: row.id }) }} cols={[
          { id: 'name', header: breakdown === 'date' ? '日期' : breakdown === 'sales' ? staffLabel : '渠道', size: breakdown === 'date' && granularity!=='week' ? 116 : 160, sort: row => row.name, cell: row => breakdown === 'date' ? row.name : <span className="inline-flex min-w-0 max-w-full items-center gap-2">{breakdown === 'sales' ? <Avatar user={{ id: row.id, name: row.name, avatar: row.avatar, hue: 155 }} size={22}/> : <ChannelAvatar channel={{ id: row.id, name: row.name, avatar: row.avatar }} size={22}/>}<span className="truncate" title={row.name}>{row.name}</span></span> },
          ...(teamView ? [
            { id: 'avatar', header: '人员头像', size: 150, cell: (row: PersonalIncomeMetrics & { id: string; name: string; avatar?: string }) => <span className="flex flex-wrap gap-1">{peopleFor(row).map(person => <Avatar key={person.id} user={{ ...person, hue: 155 }} size={25}/>)}</span> },
            { id: 'people', header: `${staffLabel}姓名`, size: 180, filterValue: (row: PersonalIncomeMetrics & { id: string; name: string; avatar?: string }) => peopleFor(row).map(person => person.name).join('、'), cell: (row: PersonalIncomeMetrics & { id: string; name: string; avatar?: string }) => peopleFor(row).map(person => person.name).join('、') || '—' },
          ] : []),
          { id: 'earned', header: earnedLabel, size: 130, align: 'right', sort: row => row.earned, cell: row => money(row.earned) },
          ...(showCommission ? [{ id: 'commission', header: '销售提成', size: 130, align: 'right' as const, filterValue: (row: PersonalIncomeMetrics) => row.commission, cell: (row: PersonalIncomeMetrics) => money(row.commission) }] : []),
          ...(showWages && !writerView ? [{ id: 'wages', header: '写手工资', size: 130, align: 'right' as const, filterValue: (row: PersonalIncomeMetrics) => row.wages, cell: (row: PersonalIncomeMetrics) => money(row.wages) }] : []),
          { id: 'paid', header: paidLabel, size: 130, align: 'right', sort: row => row.paid, cell: row => money(row.paid) },
          ...(teamView ? [{ id: 'remaining', header: '待结算', size: 150, align: 'right' as const, sort: (row: PersonalIncomeMetrics) => row.remaining, cell: (row: PersonalIncomeMetrics) => remainingCell(row) }] : []),
          { id: 'average', header: '平均单收入', size: 120, align: 'right', sort: row => row.orderCount ? row.earned / row.orderCount : 0, cell: row => row.orderCount ? money(Math.round(row.earned * 100 / row.orderCount) / 100) : '—' },
          { id: 'pending', header: '金额未定项', size: 110, align: 'right', sort: row => row.pendingCount, cell: row => row.pendingCount || '—' },
          { id: 'orders', header: '订单数', size: 90, align: 'right', sort: row => row.orderCount, cell: row => row.orderCount },
        ]}/>}

    </> : <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">{error ? <div role="alert" className="text-center"><p>{error}</p><button className="mt-2 text-primary" onClick={() => setRevision(old => old + 1)}>重新加载</button></div> : <div className="w-full self-start"><PageLoading page="income" /></div>}</div>}
    </div>
}
