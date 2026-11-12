import { PageLoading, TableSkeleton } from './PageLoading'
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, CheckCircle, CircleNotch, DownloadSimple, Wallet } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import filterFeedback from './filter-feedback.module.css'
import { migratePayrollDefaultColumns } from '@/shared/table-default-layouts'
import { sumMoney } from '@/shared/calc'
import { businessDate, money } from '@/shared/format'
import { payLedger, type PayKind, type PayLine } from '@/shared/income'
import { payrollPlanLabel, type PayrollExportRef } from '@/shared/payroll-export'
import type { Table } from '@tanstack/react-table'
import type { PublicUser } from '@/server/bootstrap'
import type { OrderView } from '@/shared/types'
import { DataTable, TablePageHeader, type Col } from './table-kit'
import { HeaderBar, PersonFilter, Segmented } from './controls'
import { Avatar, ChannelName, Empty, inputCls, Money, Person, StatusPill } from './ui'
import { loadIncome, useSession } from './store'
import { payIncomeBatchWithOutcome, type IncomeBatchInput } from './store-p2'
import { useNav } from './nav'
import { usePref } from './prefs'
import { SettlementRecords } from './SettlePage'
import { SettlementHistory } from './SettlementHistory'
import { OperationStatus, useOperationFeedback } from './operation-feedback'
import { SettlementNote } from './SettlementNote'
import { CustLight, defaultPay, PayButton } from './PayButton'
import { IncomeDateFilter, incomePreset, matchesIncomeDate, type IncomeDateSelection } from './IncomeDateFilter'
import { request } from './work-materials/data'
import { payable as rewardPayable, signedAmount, type QualityReview } from '@/shared/work-materials'

/** 两期规则满足时服务端给出建议额，有建议额才算现在可发。老板仍可手工发放。 */
const canPayNow = (l: PayLine) => l.due !== null && (l.suggest ?? 0) > 0
const canSelect = (l: PayLine) => l.due !== null && l.left > 0

type Row = PayLine & { payee: PublicUser; order?: OrderView; paidRecords: number; paidDate: string; undatedPayment: boolean }
const EXTRA_COLUMNS = ['orderDate', 'cust', 'status', 'dueDate', 'channel', 'owner', 'writers', 'creator', 'kind', 'available', 'over', 'paidRecords', 'paidDate', 'sales', 'received', 'unpaid', 'extraCostTotal', 'allocationBase', 'bossIncome', 'type', 'salesMode', 'writerPayPlan', 'draftAt', 'wechatGroup', 'channelNo', 'no', 'note', 'urgency']
const DEFAULT_VISIBILITY = Object.fromEntries(EXTRA_COLUMNS.map(id => [id, false]))
const textCell = (value?: string | null) => <span className="block truncate" title={value || undefined}>{value || '—'}</span>
const dateCell = (value?: string | null) => <span className="num text-muted-foreground">{value || '—'}</span>
const planLabel = payrollPlanLabel
type View = 'owe' | 'ready' | 'paid' | 'all'
const VIEWS: [View, string][] = [['owe', '待结清'], ['ready', '可结算'], ['paid', '有结算记录'], ['all', '全部']]
const inView = (r: Row, v: View) => v === 'all' || (v === 'paid' ? r.paid > 0 : v === 'ready' ? canPayNow(r) : r.due === null || r.left > 0)
const rowKey = (r: Row) => `${r.payee.id}:${r.key}`

/** 复用订单页的表格和筛选，一行一单；同一收款人可多选后一起记发放。 */
export function PayrollPage() {
  const { s, me } = useSession()
  const people = s.users.filter(u => !u.isAdmin && (u.canWrite || u.isSales) && (u.active !== false || s.batches.some(b => b.payeeId === u.id)))
  const [saved, setWho] = usePref<string>('payroll-person', 'all')
  const who = people.some(u => u.id === saved) ? saved : 'all'
  const [tab, setTab] = useState<'pay' | 'records'>('pay')
  const [view, setView] = usePref<View>('payroll-view', 'owe')
  const [dateRange, setDateRange] = useState<IncomeDateSelection | null>(null)
  const [columns, setColumns] = usePref<string[]>('cols-order:payroll', [])
  const [loadFailed, setLoadFailed] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => {
    const next = migratePayrollDefaultColumns(columns)
    if (next !== columns) setColumns(next)
  }, [columns, setColumns])
  // 表里列出每个人的单，收入接口仍按当前账号权限返回。
  useEffect(() => {
    let active = true
    setLoadFailed(false)
    void Promise.all(people.map(u => loadIncome(u.id))).then(results => { if (active) setLoadFailed(results.some(ok => !ok)) })
    return () => { active = false }
  }, [people.map(u => u.id).join(), s.version, revision])
  const loaded = people.every(u => s.income[u.id])
  const all = useMemo<Row[]>(() => {
    const orders = new Map(s.orders.map(order => [order.id, order]))
    const records = new Map<string, { ids: Set<string>; date: string; undated: boolean }>()
    for (const batch of s.batches) {
      if (batch.status !== '已确认') continue
      for (const line of batch.lines) {
        const key = `${batch.payeeId}:${batch.kind}:${line.orderId}`
        const entry = records.get(key) ?? { ids: new Set<string>(), date: '', undated: false }
        entry.ids.add(batch.id)
        if (batch.confirmedAt) {
          const date = businessDate(batch.confirmedAt)
          if (date > entry.date) entry.date = date
        } else entry.undated = true
        records.set(key, entry)
      }
    }
    return people.flatMap(u => {
      const income = s.income[u.id] ?? []
      return payLedger(income).map(line => {
        const order = orders.get(line.id), record = records.get(`${u.id}:${line.kind}:${line.id}`)
        return { ...line, payee: u, order,
          // 追加工资的收入日期是跟进开始日，不能冒充原订单的下单日期。
          date: order?.orderDate ?? income.find(row => row.id === line.id && row.kind !== '追加工资')?.date ?? '',
          paidRecords: record?.ids.size ?? 0, paidDate: record?.date ?? '', undatedPayment: record?.undated ?? false,
        }
      })
    })
  }, [s.income, s.orders, s.batches, people.map(u => u.id).join()])
  const personRows = who === 'all' ? all : all.filter(r => r.payee.id === who)
  const kinds = [...new Set(personRows.map(r => r.kind))] as PayKind[]
  const [pickedKind, setKind] = useState<PayKind | null>(null)
  const kind = pickedKind && kinds.includes(pickedKind) ? pickedKind : kinds.includes('写手工资') ? '写手工资' : kinds[0] ?? '写手工资'
  const mine = personRows.filter(r => r.kind === kind && matchesIncomeDate(r.date, dateRange))
  const rows = mine.filter(r => inView(r, view)).sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no))
  const counts = Object.fromEntries(VIEWS.map(([v]) => [v, mine.filter(r => inView(r, v)).length])) as Record<View, number>
  const summary = loaded ? <span className="flex flex-wrap gap-x-2 text-xs">
    <span>{mine.length} 单</span>
    <span>可发 {money(sumMoney(mine.filter(canPayNow).map(defaultPay)))}</span>
    <span>已发 {money(sumMoney(mine.map(r => r.paid)))}</span>
    <span>剩余 <span className="font-medium text-foreground">{money(sumMoney(mine.map(r => r.left)))}</span></span>
  </span> : undefined

  return <div className="flex h-full min-h-0 flex-col bg-card">
    <TablePageHeader title="工资结算" summary={tab === 'pay' ? summary : undefined}>
      <Segmented label="发工资视图" value={tab} onChange={setTab} items={[['pay', '工资明细'], ['records', '结算记录']]}/>
    </TablePageHeader>
    {!people.length ? <Empty icon={<Wallet size={22}/>} title="还没有写手或销售"/> : <>
      <HeaderBar className="gap-x-2">
          <PersonFilter size="sm" className="min-w-0 max-w-full overflow-x-auto" label="收款人" allLabel="所有人" value={who} onChange={setWho} people={people.map(u => ({ id: u.id, user: u }))}/>
          {kinds.length > 1 && <Segmented size="sm" label="收入类型" value={kind} onChange={setKind} items={kinds.map(k => [k, k] as const)}/>}
          {tab === 'pay' && <Segmented size="sm" className="ml-auto" label="发放状态" value={view} onChange={setView} items={VIEWS.map(([v, l]) => [v, <>{l}<span className="num ml-1 text-[11px] text-muted-foreground">{loaded ? counts[v] : '—'}</span></>] as const)}/>}
      </HeaderBar>
      {tab === 'records' ? <SettlementRecords kind={kind} payeeId={who === 'all' ? undefined : who} tableId="payroll-records" hidePayeeFilter queryControls/> :
        !loaded ? loadFailed ? <div className="p-3"><PageLoading page="settle" error onRetry={() => setRevision(value => value + 1)}/></div> : <div role="status" aria-busy="true" className="min-h-0 overflow-hidden p-3"><span className="sr-only">正在加载工资明细…</span><div aria-hidden="true"><TableSkeleton /></div></div> : <PayrollGrid key={`${me.id}:${who}:${kind}`} rows={rows} view={view} dateFilter={<IncomeDateFilter compact label="下单日期" value={dateRange ?? incomePreset('month')} all={dateRange === null} onAll={() => setDateRange(null)} onChange={setDateRange}/>}/>}
    </>}
  </div>
}

function PayrollGrid({ rows, view, dateFilter }: { rows: Row[]; view: View; dateFilter: ReactNode }) {
  const { openOrder } = useNav()
  const { channel, user } = useSession()
  const [ticked, setTicked] = useState<string[]>([])
  const [history, setHistory] = useState<Row | null>(null)
  const [batch, setBatch] = useState<Row[] | null>(null)
  const selectedPerson = rows.find(r => ticked.includes(rowKey(r)))?.payee.id
  const filterChannels = useMemo(() => new Map(rows.flatMap(row => {
    const entry = row.order ? channel(row.order.channelId) : undefined
    return entry ? [[entry.name, entry] as const] : []
  })), [rows, channel])
  const cols = useMemo<Col<Row>[]>(() => [
    { id: 'title', header: '订单名称', hideable: false, size: 240, sort: r => r.title, cell: r => <span className="flex min-w-0 items-center gap-2.5">
      <Checkbox aria-label={`选择 ${r.payee.name} · ${r.title}`} checked={ticked.includes(rowKey(r))}
        disabled={!canSelect(r) || (!!selectedPerson && selectedPerson !== r.payee.id)}
        title={!canSelect(r) ? r.due === null ? '先确定应发金额' : '这单已发清' : selectedPerson && selectedPerson !== r.payee.id ? '一次发放选择同一收款人' : undefined}
        onClick={e => e.stopPropagation()} onCheckedChange={on => setTicked(current => on ? [...new Set([...current, rowKey(r)])] : current.filter(k => k !== rowKey(r)))}/>
      <span className="truncate font-medium" title={r.title}>{r.title}</span>
    </span> },
    { id: 'due', header: '应发', size: 88, align: 'right', sort: r => r.due ?? -1, filterValue: r => r.due, cell: r => <Money value={r.due}/> },
    { id: 'paid', header: '已发', size: 88, align: 'right', sort: r => r.paid, cell: r => r.paid > 0
      ? <button type="button" aria-label={`查看${r.payee.name}的${r.title}发放记录`} className="num text-primary underline-offset-2 hover:underline" onClick={e => { e.stopPropagation(); setHistory(r) }}>{money(r.paid)}</button>
      : <Money value={0} className="text-muted-foreground"/> },
    { id: 'left', header: '剩余', size: 88, align: 'right', sort: r => r.left, filterValue: r => r.due === null ? null : r.left, cell: r => <span className="inline-flex flex-col items-end"><Money value={r.due === null ? null : r.left} owed className={r.left > 0 ? undefined : 'text-muted-foreground'}/>{r.over > 0 && <span className="num text-xs text-warn">多发 {money(r.over)}</span>}</span> },
    { id: 'payee', header: '收款人', size: 120, sort: r => r.payee.name, cell: r => <Person user={r.payee} size={20}/> },
    { id: 'orderDate', header: '下单日期', size: 120, filterType: 'date', sort: r => r.date, cell: r => <span className="num text-muted-foreground">{r.date || '未记录'}</span> },
    { id: 'cust', header: '客户付款', size: 100, filterValue: r => r.custStage ? ({ none: '未收款', deposit: '定金已到', paidUp: '已收齐' })[r.custStage] : null, cell: r => <CustLight stage={r.custStage}/> },
    { id: 'status', header: '订单状态', size: 110, sort: r => r.status, cell: r => <StatusPill status={r.status}/> },
    { id: 'dueDate', header: '截止日期', size: 120, filterType: 'date', sort: r => r.order?.dueDate ?? '', cell: r => dateCell(r.order?.dueDate) },
    { id: 'channel', header: '渠道', size: 150, filterOptions: 'all', filterOptionContent: name => <ChannelName channel={filterChannels.get(name)}/>, sort: r => r.order ? channel(r.order.channelId)?.name ?? '' : '', cell: r => <ChannelName channel={r.order ? channel(r.order.channelId) : undefined}/> },
    { id: 'owner', header: '归属销售', size: 140, sort: r => r.order ? user(r.order.ownerId)?.name ?? '' : '', cell: r => <Person user={r.order ? user(r.order.ownerId) : undefined}/> },
    { id: 'writers', header: '协作写手', size: 220, sort: r => r.order?.assignees.map(a => user(a.userId)?.name ?? '').join('、') ?? '', cell: r => r.order?.assignees.length ? <span className="flex items-center gap-3">{r.order.assignees.map(a => <Person key={a.userId} user={user(a.userId)} size={20}/>)}</span> : '—' },
    { id: 'creator', header: '录单人', size: 130, sort: r => r.order ? user(r.order.creatorId)?.name ?? '' : '', cell: r => <Person user={r.order ? user(r.order.creatorId) : undefined}/> },
    { id: 'kind', header: '收入类型', size: 110, sort: r => r.kind, cell: r => r.kind },
    { id: 'available', header: '按条件可发', size: 120, align: 'right', sort: r => r.suggest ?? -1, filterValue: r => r.suggest ?? null, cell: r => <Money value={r.suggest}/> },
    { id: 'over', header: '多发差额', size: 110, align: 'right', sort: r => r.over, cell: r => <Money value={r.over} className={r.over > 0 ? 'text-danger' : 'text-muted-foreground'}/> },
    { id: 'paidRecords', header: '结算记录数', size: 120, align: 'right', sort: r => r.paidRecords, cell: r => r.paidRecords ? <button type="button" className="num text-primary hover:underline" title="含历史实发明细，点击查看" onClick={e => { e.stopPropagation(); setHistory(r) }}>{r.paidRecords} 条</button> : <span className="num text-muted-foreground">0</span> },
    { id: 'paidDate', header: '最近结算日期', size: 170, filterType: 'date', sort: r => r.paidDate, cell: r => <span className="inline-flex flex-col" title="按已知结算日期显示；日期未记录的历史款不参与排序">{dateCell(r.paidDate)}{r.undatedPayment && <span className="text-xs text-muted-foreground">{r.paidDate ? '另有' : '原'}日期未记录</span>}</span> },
    ...(['sales', 'received', 'unpaid', 'extraCostTotal', 'allocationBase', 'bossIncome'] as const).filter(id => rows.some(r => r.order?.[id] !== undefined)).map((id): Col<Row> => ({
      id, header: ({ sales: '订单销售额', received: '客户已收', unpaid: '客户未收', extraCostTotal: '额外成本', allocationBase: '分成基数', bossIncome: '老板预计收入' })[id],
      size: 130, align: 'right', sort: r => r.order?.[id] ?? -1, filterValue: r => id === 'bossIncome' && r.order?.payPending ? null : r.order?.[id] ?? null,
      cell: r => <Money value={r.order?.[id]} plain={id === 'sales' || id === 'unpaid'} className={id === 'sales' ? 'text-gold' : id === 'unpaid' ? (r.order?.unpaid ?? 0) < 0 ? 'text-danger' : 'text-foreground' : undefined} pending={id === 'bossIncome' && r.order?.payPending}/>,
    })),
    { id: 'type', header: '订单类型', size: 130, sort: r => r.order?.type ?? '', cell: r => textCell(r.order?.type) },
    { id: 'salesMode', header: '销售模式', size: 120, sort: r => r.order ? r.order.salesMode === 'cost' ? '底价订单' : '提成订单' : '', cell: r => r.order ? r.order.salesMode === 'cost' ? '底价订单' : '提成订单' : '—' },
    { id: 'writerPayPlan', header: '工资发放约定', size: 190, sort: r => planLabel(r.order), cell: r => textCell(planLabel(r.order)) },
    { id: 'draftAt', header: '初稿日期', size: 120, sort: r => r.order?.draftAt ? businessDate(r.order.draftAt) : '', cell: r => dateCell(r.order?.draftAt ? businessDate(r.order.draftAt) : '') },
    { id: 'wechatGroup', header: '微信群', size: 240, sort: r => r.order?.wechatGroup ?? '', cell: r => textCell(r.order?.wechatGroup) },
    { id: 'channelNo', header: '渠道单号', size: 160, sort: r => r.order?.channelNo ?? '', cell: r => textCell(r.order?.channelNo) },
    { id: 'no', header: '系统编号', size: 170, sort: r => r.no, cell: r => textCell(r.no) },
    { id: 'note', header: '订单备注', size: 260, sort: r => r.order?.note ?? '', cell: r => textCell(r.order?.note) },
    { id: 'urgency', header: '加急说明', size: 220, sort: r => r.order?.urgency?.note ?? '', cell: r => textCell(r.order?.urgency ? r.order.urgency.note || '加急' : '') },
    { id: 'actions', header: '操作', size: 112, minSize: 96, align: 'right', cell: r => r.due === null ? <span className="text-xs text-muted-foreground">金额待定</span>
      : r.left <= 0 ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle size={15}/>已结清</span>
      : <PayButton orderId={r.id} kind={r.kind} payeeId={r.payee.id} payeeName={r.payee.name} left={r.left} suggest={r.suggest}/> },
  ], [ticked, selectedPerson, channel, user, rows, filterChannels])

  return <>
    <DataTable fill id="payroll" cols={cols} rows={rows} rowId={rowKey} freeze={1} toolbarSort searchPlaceholder="订单名、收款人、渠道" preferredFilterFields={['cust', 'status', 'channel', 'paid', 'left', 'dueDate', 'paidDate']} toolbarExtras={table => <>{dateFilter}<PayrollExportButton table={table}/></>} defaultSorting={[{ id: 'orderDate', desc: true }]} defaultVisibility={DEFAULT_VISIBILITY}
      onRowClick={r => openOrder(r.id, [...new Set(rows.map(x => x.id))])}
      footer={table => <PayrollSelectionFooter rows={table.getRowModel().rows.map(r => r.original)} ticked={ticked} setTicked={setTicked} onPay={setBatch}/>}
      empty={<Empty icon={<Wallet size={22}/>} title={view === 'owe' ? '都发清了' : '没有符合条件的单'}/>}/>
    {history && <SettlementHistory orderId={history.id} kind={history.kind} title={history.title} payeeId={history.payee.id} onClose={() => setHistory(null)}/>}
    {batch?.length ? <BatchPay person={batch[0].payee} kind={batch[0].kind} lines={batch} onClose={() => setBatch(null)} onDone={() => { const id = batch[0].payee.id; setBatch(null); setTicked([]); void loadIncome(id) }}/> : null}
  </>
}

function PayrollExportButton({ table }: { table: Table<Row> }) {
  const [busy, setBusy] = useState(false)
  const rows = table.getRowModel().rows
  return <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy || !rows.length} title={`导出当前筛选的 ${rows.length} 条，按当前排序和可见列；补齐订单、收款人和核心金额`} onClick={async () => {
    setBusy(true)
    try {
      const refs: PayrollExportRef[] = rows.map(({ original: row }) => ({ payeeId: row.payee.id, orderId: row.id, kind: row.kind }))
      const response = await fetch('/api/export/payroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: refs, columns: table.getVisibleLeafColumns().map(column => column.id) }) })
      if (!response.ok) throw new Error((await response.json()).error || '导出失败，请重试')
      // 与渠道导出共用浏览器下载入口；安卓客户端会接管 blob 并打开原生保存窗口。
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `工资明细-${businessDate(new Date())}.xlsx`
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      toast.success(`已生成 ${refs.length} 条工资明细`)
    } catch (error) { toast.error(error instanceof Error ? error.message : '导出失败，请重试') }
    finally { setBusy(false) }
  }}><DownloadSimple size={15}/>{busy ? '导出中…' : '导出'}</Button>
}

function PayrollSelectionFooter({ rows, ticked, setTicked, onPay }: { rows: Row[]; ticked: string[]; setTicked: Dispatch<SetStateAction<string[]>>; onPay: (rows: Row[]) => void }) {
  const eligible = rows.filter(canSelect)
  const visibleKeys = eligible.map(rowKey).join('\n')
  // 搜索/表格筛选后只保留仍可见的待发项，底部金额和提交也始终从当前表格行计算。
  useEffect(() => {
    const visible = new Set(visibleKeys.split('\n'))
    setTicked(current => { const next = current.filter(key => visible.has(key)); return next.length === current.length ? current : next })
  }, [visibleKeys, setTicked])
  const picked = eligible.filter(r => ticked.includes(rowKey(r)))
  const personId = picked[0]?.payee.id ?? (new Set(eligible.map(r => r.payee.id)).size === 1 ? eligible[0]?.payee.id : undefined)
  const selectable = eligible.filter(r => r.payee.id === personId)
  const samePayee = picked.every(r => r.payee.id === personId && r.kind === picked[0]?.kind)
  const allPicked = selectable.length > 0 && selectable.every(r => ticked.includes(rowKey(r)))
  return <div data-selected={picked.length > 0} className={cn("flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t bg-card px-4 py-2.5 text-sm", filterFeedback.selection)}>
    <label className="flex items-center gap-2 text-muted-foreground"><Checkbox aria-label="选择当前收款人的全部订单" disabled={!selectable.length} checked={allPicked ? true : picked.length ? 'indeterminate' : false} onCheckedChange={on => setTicked(on ? selectable.map(rowKey) : [])}/><span aria-live="polite" aria-atomic="true">{picked.length ? `${picked[0].payee.name} · ` : ''}已选 <span className="num text-foreground">{picked.length}</span> 单</span></label>
    {!!picked.length && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setTicked([])}>清空</button>}
    {!picked.length && <span className="text-xs text-muted-foreground">{rows.length} 条记录</span>}
    <Button className="ml-auto h-8 gap-2" disabled={!picked.length || !samePayee} onClick={() => onPay(picked)}><Wallet size={16}/>合并结算 {!!picked.length && <span className="num" aria-live="polite" aria-atomic="true">{money(sumMoney(picked.map(defaultPay)))}</span>}</Button>
  </div>
}

// 没拿到结果的批次沿用原编号重试，避免重复记款。
const unfinished = new Map<string, IncomeBatchInput>()

function BatchPay({ person, kind, lines, onClose, onDone }: { person: PublicUser; kind: PayKind; lines: PayLine[]; onClose: () => void; onDone: () => void }) {
  const { me } = useSession()
  // 写手没结的奖惩：默认跟这次工资一起结，奖励加、罚款扣；取不到就当没有，不影响发工资
  const [allRewards, setAllRewards] = useState<QualityReview[]>([])
  useEffect(() => {
    if (kind !== '写手工资') return
    let alive = true
    request<QualityReview[]>('/api/reviews').then(list => { if (alive && Array.isArray(list)) setAllRewards(list) }, () => {})
    return () => { alive = false }
  }, [kind, person.id])
  const pendingRewards = allRewards.filter(r => r.writerId === person.id && rewardPayable(r))
  // 罚款写手还没回复或你还没确认的，这次先不扣
  const waitingFines = allRewards.filter(r => r.writerId === person.id && r.kind === 'penalty' && !!r.amount && !r.revokedAt && !r.settledAt && r.status !== 'done').length
  const [withRewards, setWithRewards] = useState(true)
  const rewardNet = sumMoney(pendingRewards.map(signedAmount))
  const [includeRewards, setIncludeRewards] = useState(false)
  const key = `${me.id}:${person.id}:${kind}:${lines.map(l => l.id).sort().join(',')}`
  const saved = unfinished.get(key)
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(lines.map(l => [l.id, String(saved?.lines.find(x => x.orderId === l.id)?.amount ?? defaultPay(l))])))
  const today = businessDate(new Date())
  const [date, setDate] = useState(saved?.date ?? today)
  const [note, setNote] = useState(saved?.note ?? '')
  const [shots, setShots] = useState<string[]>(saved?.shots ?? [])
  const [busy, setBusy] = useState(false)
  const feedback = useOperationFeedback()
  const working = useRef(false)
  const reading = useRef(false)
  const [, setReading] = useState(false)
  const parsed = lines.map(l => ({ orderId: l.id, amount: Number(amounts[l.id]) }))
  const payable = parsed.filter(l => l.amount > 0)
  const valid = parsed.every(l => amounts[l.orderId] === '' || amounts[l.orderId] === '0' || (Number.isFinite(l.amount) && l.amount >= 0 && Math.abs(l.amount * 100 - Math.round(l.amount * 100)) < 1e-7)) && payable.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today
  const total = sumMoney(payable.map(l => l.amount))
  // 罚款比这次工资还多时不一起结，留到下次
  const rewardsFit = pendingRewards.length > 0 && sumMoney([total, rewardNet]) >= 0
  useEffect(() => setIncludeRewards(withRewards && rewardsFit), [withRewards, rewardsFit])
  const transfer = includeRewards ? sumMoney([total, rewardNet]) : total

  async function submit() {
    if (working.current || reading.current || (!saved && !valid)) return
    working.current = true
    setBusy(true)
    const rewardNote = includeRewards ? `奖惩一起结：${pendingRewards.map(r => `${r.category || (r.kind === 'reward' ? '奖励' : '罚款')} ${r.kind === 'reward' ? '+' : '−'}${money(r.amount ?? 0)}`).join('，')}；合计 ${rewardNet >= 0 ? '+' : '−'}${money(Math.abs(rewardNet))}，实际转账 ${money(transfer)}` : ''
    const input = saved ?? { requestId: crypto.randomUUID(), kind, payeeId: person.id, lines: payable, date, note: [note.trim(), rewardNote].filter(Boolean).join('\n'), shots }
    unfinished.set(key, input)
    try {
      const ok = await feedback.run(async report => {
        const outcome = await payIncomeBatchWithOutcome(input, { onConfirmed: () => feedback.confirm('合并结算已记录') })
        if (outcome.status === 'rejected') unfinished.delete(key)
        if (outcome.status !== 'success') {
          report({ status: outcome.status === 'rejected' ? 'error' : 'uncertain', message: outcome.status === 'rejected' ? '未能结算，请检查后重试；填写内容已保留' : '结果尚未确认，请重试这笔核对，勿重复记款' })
          return false
        }
        unfinished.delete(key)
        toast.success(`结算已记录：${person.name} ${money(outcome.result.amount)} · ${outcome.result.count} 单`)
        if (includeRewards) {
          try {
            await request('/api/reviews/settle', 'POST', { writerId: person.id, ids: pendingRewards.map(r => r.id) })
            toast.success(`奖惩已一起结清：${rewardNet >= 0 ? '+' : '−'}${money(Math.abs(rewardNet))}，实际转账 ${money(transfer)}`)
          } catch (err) { toast.error(`工资已记，奖惩没结上：${(err as Error).message}，请到奖惩页核对`) }
        }
        return true
      }, { saving: '正在记录合并结算', success: '合并结算已记录' })
      if (ok) onDone()
    } finally { working.current = false; setBusy(false) }
  }

  return <Dialog open onOpenChange={o => !o && !busy && !reading.current && onClose()}>
    <DialogContent className="flex max-h-[calc(100dvh-24px)] max-w-lg flex-col gap-3 p-4">
      <DialogTitle className="flex items-center gap-2 text-base"><Avatar user={person} size={24}/>{person.name} · 合并结算</DialogTitle>
      <div className="scroll-thin -mx-1 min-h-0 flex-1 divide-y overflow-y-auto px-1">
        {lines.map(l => <label key={l.id} className="flex items-center gap-3 py-1.5 text-sm">
          <span className="min-w-0 flex-1 break-words">{l.title}</span>
          <span className="num w-20 text-right text-xs text-muted-foreground">剩 {money(l.left)}</span>
          <span className="relative w-28"><span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">¥</span>
            <input aria-label={`${l.title} 金额`} inputMode="decimal" value={amounts[l.id]} disabled={busy || !!saved} onChange={e => setAmounts(a => ({ ...a, [l.id]: e.target.value.replace(/[^\d.]/g, '') }))} className={cn(inputCls, 'num h-8 pl-5 text-right')}/></span>
        </label>)}
      </div>
      <div className="flex items-center gap-2">
        <input aria-label="结算日期" type="date" max={today} value={date} disabled={busy || !!saved} onChange={e => setDate(e.target.value)} className={cn(inputCls, 'h-8 w-36 text-xs')}/>
        <span className="ml-auto text-sm">{includeRewards ? '工资' : '合计'} <strong className="num font-medium">{money(total)}</strong></span>
      </div>
      {pendingRewards.length > 0 && <div className="rounded-md border px-3 py-2 text-sm">
        <label className="flex items-center gap-2"><Checkbox checked={withRewards} disabled={busy || !!saved} onCheckedChange={on => setWithRewards(on === true)}/>
          <span>一起结清 {pendingRewards.length} 条奖惩</span>
          <span className={cn('num ml-auto font-medium', rewardNet < 0 ? 'text-danger' : 'text-gold')}>{rewardNet >= 0 ? '+' : '−'}{money(Math.abs(rewardNet))}</span></label>
        {withRewards && <ul className="mt-1.5 space-y-0.5 pl-6 text-xs text-muted-foreground">{pendingRewards.map(r => <li key={r.id} className="flex gap-2"><span className="min-w-0 flex-1 truncate" title={r.issue}>{[r.category, r.issue.split('\n')[0]].filter(Boolean).join(' · ')}</span><span className="num">{r.kind === 'reward' ? '+' : '−'}{money(r.amount ?? 0)}</span></li>)}</ul>}
        {includeRewards && <p className="mt-1.5 text-right">实际转账 <strong className="num font-medium">{money(transfer)}</strong></p>}
        {withRewards && !rewardsFit && <p className="mt-1.5 text-xs text-warn">罚款比这次工资多，留到下次</p>}
      </div>}
      {waitingFines > 0 && <p className="text-xs text-muted-foreground">另有 {waitingFines} 条罚款还没确认，这次不扣</p>}
      <SettlementNote note={note} shots={shots} onNote={setNote} onShots={setShots} onReading={v => { reading.current = v; setReading(v) }} disabled={busy || !!saved} label="结算备注" placeholder="备注（可选，可粘贴转账截图）"/>
      <OperationStatus state={feedback.state}/>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
        <Button aria-busy={busy} disabled={busy || reading.current || (!saved && !valid)} onClick={() => void submit()}>{feedback.state.status === 'success' ? <><Check size={16}/>结算已记录</> : busy ? <><CircleNotch size={16} className="animate-spin motion-reduce:animate-none"/>正在保存…</> : saved ? '重试这笔' : includeRewards ? `确认结算，转 ${money(transfer)}` : `确认结算 ${money(total)}`}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
