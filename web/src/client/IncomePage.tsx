import { WorkspaceHeading } from './WorkspaceHeading'
import { useEffect, useMemo, useState } from 'react'
import { HeaderBar, Segmented } from './controls'
import { Wallet } from '@phosphor-icons/react'
import { sumMoney } from '@/shared/calc'
import { payLedger, type PayLine } from '@/shared/income'
import { DataTable } from './table-kit'
import { ChannelName, Empty, Money, Person, StatusPill } from './ui'
import { PageLoading, SkeletonBlock } from './PageLoading'
import { loadIncome, useSession } from './store'
import { useNav } from './nav'
import { RevenueOverview } from './RevenueOverview'
import { SettlementRecords } from './SettlePage'
import { SettlementHistory } from './SettlementHistory'
import { CustLight } from './PayButton'
import { PersonalRevenueOverview } from './PersonalRevenueOverview'
import { WriterDeliveryHistory } from './WriterDeliveryHistory'

/** 收入：老板看经营收入；写手、销售看自己应得和剩余。发钱在「发工资」。 */
export function IncomePage() {
  const { role } = useSession()
  const [overview, setOverview] = useState<'business' | 'sales' | 'writer'>('business')
  if (!role.locked) return <MyIncome/>
  return <div data-income-page className="flex max-h-full min-h-0 min-w-0 flex-col bg-card" style={overview === 'business' ? undefined : {flex:'0 1 auto'}}>
    <WorkspaceHeading title="收入" data>
      <Segmented className="income-page-tabs" label="收入范围" value={overview} onChange={setOverview} items={[[ 'business', '经营收入' ], [ 'sales', '销售收入' ], [ 'writer', '写手收入' ]]}/>
    </WorkspaceHeading>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{overview !== 'business' ? <PersonalRevenueOverview key={overview} mode={overview}/> : <RevenueOverview/>}</div>
  </div>
}

function MyIncome() {
  const { s, me, views, channel, user, can } = useSession()
  const writerView = !can('order.create') && me.canWrite
  const { openOrder } = useNav()
  const [tab, setTab] = useState<'overview' | 'orders' | 'records'>('overview')
  const [history, setHistory] = useState<PayLine | null>(null)
  const [loadFailed, setLoadFailed] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => {
    if (tab === 'overview' || writerView && tab === 'orders') return
    let active = true
    setLoadFailed(false)
    void loadIncome(me.id).then(ok => { if (active) setLoadFailed(!ok) })
    return () => { active = false }
  }, [me.id, s.version, tab, revision, writerView])
  const ledger = useMemo(() => payLedger(s.income[me.id] ?? []), [s.income, me.id])
  const orders = useMemo(() => new Map(views.map(v => [v.id, v])), [views])
  const rows = useMemo(() => ledger.map(row => {
    const order = orders.get(row.id)
    return { ...row, custStage: row.custStage ?? order?.custStage, orderDate: order?.orderDate ?? '', dueDate: order?.dueDate ?? '', channel: order ? channel(order.channelId) : undefined, owner: order ? user(order.ownerId) : undefined }
  }), [ledger, orders, channel, user])
  const both = new Set(ledger.map(r => r.kind)).size > 1
  const left = sumMoney(ledger.map(r => r.left))
  return <div className="flex h-full min-h-0 flex-col bg-card">
    <WorkspaceHeading title="收入" data>{tab !== 'overview' && !(writerView && tab === 'orders') && (s.income[me.id] ? <span className="text-sm text-muted-foreground">待领 <Money value={left} className="text-lg font-semibold text-foreground"/></span> : <span aria-label="收入尚未加载"><SkeletonBlock className="h-5 w-24" /></span>)}</WorkspaceHeading>
    <HeaderBar>
      <Segmented label="收入视图" value={tab} onChange={setTab} items={[['overview', '收入总览'], ['orders', writerView ? '已交付订单' : '订单'], ['records', '领取记录']]} />
    </HeaderBar>
    {tab === 'overview' ? <div className="min-h-0 flex-1"><PersonalRevenueOverview/></div> : tab === 'records' ? <SettlementRecords payeeId={me.id}/> : writerView ? <WriterDeliveryHistory/> : !s.income[me.id] ?
      <div className="min-h-0 overflow-hidden p-3"><PageLoading page="orders" title="收入订单" error={loadFailed} onRetry={() => setRevision(value => value + 1)} /></div> :
      <DataTable fill id="my-income" rows={rows} rowId={r => r.key} onRowClick={r => { if (orders.has(r.id)) openOrder(r.id) }}
        defaultVisibility={{ kind: false, date: false, channel: false, owner: writerView, deadline: false, over: false }}
        empty={<Empty icon={<Wallet size={22}/>} title="还没有收入记录"/>}
        cols={[
          { id: 'title', header: '订单', hideable: false, size: 320, sort: r => r.title, cell: r => <span className="flex min-w-0 items-baseline gap-2"><span className="truncate font-medium" title={r.title}>{r.title}</span>{both && <span className="shrink-0 text-xs text-muted-foreground">{r.kind === '销售提成' ? '销售' : '写手'}</span>}</span> },
          { id: 'due', header: '收入', size: 96, align: 'right', sort: r => r.due ?? -1, filterValue: r => r.due, cell: r => <Money value={r.due}/> },
          { id: 'paid', header: '已发', size: 96, align: 'right', sort: r => r.paid, cell: r => r.paid > 0
            ? <button type="button" aria-label={`查看${r.title}的发放记录`} className="num text-primary underline-offset-2 hover:underline" onClick={e => { e.stopPropagation(); setHistory(r) }}><Money value={r.paid}/></button>
            : <Money value={0} className="text-muted-foreground"/> },
          { id: 'left', header: '剩余', size: 96, align: 'right', sort: r => r.left, filterValue: r => r.due === null ? null : r.left, cell: r => <Money value={r.due === null ? null : r.left} owed className={r.left > 0 ? 'font-medium' : 'text-muted-foreground'}/> },
          { id: 'cust', header: '收款', size: 100, filterValue: r => r.custStage ? ({ none: '未收款', deposit: '定金已到', paidUp: '已收齐' })[r.custStage] : null, cell: r => r.custStage ? <CustLight stage={r.custStage}/> : '—' },
          { id: 'status', header: '订单状态', size: 100, sort: r => r.status, cell: r => <StatusPill status={r.status}/> },
          { id: 'kind', header: '收入类型', size: 110, sort: r => r.kind, cell: r => r.kind },
          { id: 'date', header: '下单日期', size: 120, sort: r => r.orderDate, cell: r => r.orderDate || '—' },
          { id: 'channel', header: '渠道', size: 160, sort: r => r.channel?.name ?? '', cell: r => r.channel ? <ChannelName channel={r.channel}/> : '—' },
          { id: 'owner', header: '归属销售', size: 130, sort: r => r.owner?.name ?? '', cell: r => <Person user={r.owner}/> },
          { id: 'deadline', header: '截止日期', size: 120, sort: r => r.dueDate, cell: r => r.dueDate || '—' },
          { id: 'over', header: '超发差额', size: 110, align: 'right', sort: r => r.over, cell: r => <Money value={r.over} className={r.over > 0 ? 'text-danger' : 'text-muted-foreground'}/> },
        ]}/>}
    {history && <SettlementHistory orderId={history.id} kind={history.kind} title={history.title} payeeId={me.id} onClose={() => setHistory(null)}/>}
  </div>
}
