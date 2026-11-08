import { useMemo, useState } from 'react'
import { ClipboardText } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { sumMoney } from '@/shared/calc'
import type { SettleStatus } from '@/shared/types'
import { writerDeliveryRows, type WriterDeliveryRow } from '@/shared/writer-delivery'
import { useSession } from './store'
import { useNav } from './nav'
import { IncomeDateFilter, incomePreset, matchesIncomeDate, type IncomeDateSelection } from './IncomeDateFilter'
import { Segmented } from './controls'
import { DataTable, TableFooter, type Col } from './table-kit'
import { Empty, Money, Pill } from './ui'
import { SettlementHistory } from './SettlementHistory'

/** 工作台和“我的收入”共用同一份个人交付账单。 */
export function WriterDeliveryHistory() {
  const { views, me, role } = useSession(), { openOrder } = useNav()
  const [dates, setDates] = useState<IncomeDateSelection>(() => incomePreset('today'))
  const [allDates, setAllDates] = useState(false)
  const [settlement, setSettlement] = useState<SettleStatus | 'all'>('all')
  const [history, setHistory] = useState<WriterDeliveryRow | null>(null)
  const showWages = role.locked || role.fields.writerPay !== 'none'
  const deliveries = useMemo(() => writerDeliveryRows(views, me.id), [views, me.id])
  const period = useMemo(() => deliveries.filter(row => matchesIncomeDate(row.day, allDates ? null : dates)), [deliveries, allDates, dates])
  const rows = useMemo(() => period.filter(row => !showWages || settlement === 'all' || row.settlement === settlement), [period, showWages, settlement])
  const ids = rows.map(row => row.id)
  const pending = rows.filter(row => row.wage === null).length
  const cols: Col<WriterDeliveryRow>[] = [
    { id: 'title', header: '订单', hideable: false, size: 300, sort: row => row.order.title, cell: row => <span className="block truncate font-medium" title={row.order.title}>{row.order.title}</span> },
    { id: 'deliveryDate', header: '交付日期', size: 125, sort: row => row.day ?? '', cell: row => row.day ?? <span className="text-muted-foreground">未记日期</span> },
    ...(showWages ? [
      { id: 'wage', header: '本人工资', size: 110, align: 'right' as const, sort: (row: WriterDeliveryRow) => row.wage ?? -1, cell: (row: WriterDeliveryRow) => <Money value={row.wage}/> },
      { id: 'settlement', header: '结算状态', size: 110, filterValue: (row: WriterDeliveryRow) => row.settlement, cell: (row: WriterDeliveryRow) => <Pill tone={row.settlement === '已结算' ? 'var(--ok)' : row.settlement === '部分结算' ? 'var(--gold)' : undefined}>{row.settlement}</Pill> },
      { id: 'paid', header: '已结算', size: 105, align: 'right' as const, sort: (row: WriterDeliveryRow) => row.paid, cell: (row: WriterDeliveryRow) => row.paid > 0 ? <button type="button" className="text-primary hover:underline" aria-label={`查看${row.order.title}的结算记录`} onClick={e => { e.stopPropagation(); setHistory(row) }}><Money value={row.paid}/></button> : <Money value={0}/> },
      { id: 'left', header: '未结算', size: 105, align: 'right' as const, sort: (row: WriterDeliveryRow) => row.left ?? -1, cell: (row: WriterDeliveryRow) => <Money value={row.left}/> },
    ] : []),
  ]
  return <div className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
      <IncomeDateFilter isoLabel compact label="交付日期" value={dates} all={allDates} onChange={value => { setDates(value); setAllDates(false) }}/>
      <Button size="sm" variant="ghost" aria-pressed={allDates} className={allDates ? 'text-primary' : 'text-muted-foreground'} onClick={() => setAllDates(value => !value)}>全部日期</Button>
      {showWages && <Segmented size="sm" label="工资结算状态" value={settlement} onChange={setSettlement} items={[[ 'all', '全部' ], [ '未结算', '未结算' ], [ '部分结算', '部分结算' ], [ '已结算', '已结算' ]]}/>}
    </div>
    <div className="flex shrink-0 flex-wrap items-baseline gap-x-5 gap-y-1 border-b px-4 py-2.5 text-sm" aria-live="polite">
      <span>交付 <b className="num">{rows.length}</b> 单</span>
      {showWages && <><span>工资 <Money value={sumMoney(rows.map(row => row.knownWage))} className="font-semibold"/></span><span className="text-muted-foreground">待结 <Money value={sumMoney(rows.map(row => row.left ?? 0))}/></span>{pending > 0 && <span className="text-xs text-warn">{pending} 单工资未定</span>}</>}
    </div>
    <DataTable fill id={`writer-deliveries:${me.id}`} rows={rows} cols={cols} rowId={row => row.id} freeze={1} onRowClick={row => openOrder(row.id, ids)}
      empty={<Empty icon={<ClipboardText size={22}/>} title="这个范围内没有已交付订单"/>}
      footer={table => <TableFooter>{table.getRowModel().rows.length} 单 · 按本人交付日期统计</TableFooter>}/>
    {history && <SettlementHistory orderId={history.id} kind="写手工资" title={history.order.title} payeeId={me.id} onClose={() => setHistory(null)}/>}
  </div>
}
