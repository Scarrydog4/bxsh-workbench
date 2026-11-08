import { SelectField } from './SelectField'
import { useState } from 'react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { money, shortDate } from '@/shared/format'
import { receiptMatches, type ReceiptFilter } from '@/shared/reconciliation'
import type { OrderView } from '@/shared/types'
import { useSession, checkPayment } from './store'
import { useNav } from './nav'
import { ChannelName, inputCls } from './ui'
import { DataTable } from './table-kit'

export function Reconciliation({ orders }: { orders: OrderView[] }) {
  const { channel, user } = useSession()
  const { openOrder } = useNav()
  const [receipt, setReceipt] = useState<ReceiptFilter>('all')
  const [review, setReview] = useState('pending')
  const [busy, setBusy] = useState<string | null>(null)
  const live = orders.filter(o => receiptMatches(o, 'all'))
  const rows = live.filter(o => receiptMatches(o, receipt) && (review === 'all' || (review === 'checked' ? !!o.paymentCheckedAt : !o.paymentCheckedAt)))
  function paymentSummary(o: OrderView) {
    const count = o.payments?.filter(p => !p.revoked).length ?? 0
    return count ? `${count} 笔 · ${o.payStatus}` : '无收款记录'
  }
  async function toggle(o: OrderView, checked: boolean) {
    if (busy) return
    setBusy(o.id)
    try {
      if (await checkPayment(o.id, checked, o.paymentCheckToken!)) toast.success(`${o.title} ${checked ? '已核对' : '已恢复待核对'}`)
    } finally { setBusy(null) }
  }
  return <section className="space-y-3">
    <p className="text-xs leading-5 text-muted-foreground">对照微信或银行流水后勾选「已核对」。无收款记录可能是没收，也可能是收了没记；点「记收款」补录。新增流水、退款或改价后会重新待核对。</p>
    <div className="overflow-hidden rounded-lg border bg-card">
    <DataTable id="payment-reconciliation" rows={rows} rowId={o => o.id} maxHeight="max(240px,calc(100dvh - 400px))" toolbarExtras={<>
      <label className="text-xs text-muted-foreground">收款情况<SelectField aria-label="对账收款筛选" value={receipt} onChange={e => setReceipt(e.target.value as ReceiptFilter)} className={`${inputCls} ml-2 h-8 w-auto text-sm`}>
        <option value="all">全部收款情况</option><option value="noRecord">无收款记录</option><option value="unreceived">未收到款／定金待核对</option><option value="partial">部分收款／尾款未齐</option><option value="paid">已收齐</option><option value="overpaid">多收待核对</option>
      </SelectField></label>
      <label className="text-xs text-muted-foreground">核对进度<SelectField aria-label="对账核对筛选" value={review} onChange={e => setReview(e.target.value)} className={`${inputCls} ml-2 h-8 w-auto text-sm`}><option value="pending">待核对</option><option value="checked">已核对</option><option value="all">全部</option></SelectField></label>
      <span className="text-xs text-muted-foreground">已核对 {live.filter(o => o.paymentCheckedAt).length} / {live.length} 单</span>
    </>} cols={[
      { id: 'checked', header: '已核对', size: 110, sort: o => o.paymentCheckedAt ? '已核对' : '待核对', cell: o => <span className="inline-flex items-center gap-1 whitespace-nowrap"><Checkbox aria-label={`核对收款 ${o.no}`} checked={!!o.paymentCheckedAt} disabled={!!busy} onCheckedChange={v => void toggle(o, !!v)} /><span className="text-xs text-muted-foreground">{o.paymentCheckedAt ? '已核对' : '待核对'}</span></span> },
      { id: 'order', header: '订单 / 渠道', size: 320, sort: o => o.title, filterValue: o => `${o.title} ${o.no} ${o.orderDate} ${channel(o.channelId)?.name ?? ''}`, cell: o => <div className="py-1.5"><div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">{shortDate(o.orderDate)}</span><ChannelName channel={channel(o.channelId)} /></div><button onClick={() => openOrder(o.id, undefined, 'payments')} className="mt-0.5 block w-full truncate text-left font-medium" title={o.title}>{o.title}</button></div> },
      { id: 'sales', header: '应收', size: 110, align: 'right', filterValue: o => o.sales, sort: o => o.sales ?? 0, cell: o => <span className="tabular-nums text-gold">{money(o.sales)}</span> },
      { id: 'received', header: '已收', size: 110, align: 'right', filterValue: o => o.received, sort: o => o.received ?? 0, cell: o => <span className="tabular-nums">{money(o.received)}</span> },
      { id: 'unpaid', header: '未收 / 多收', size: 125, align: 'right', filterValue: o => o.unpaid, sort: o => o.unpaid ?? 0, cell: o => <span className={`tabular-nums ${o.unpaid! < 0 ? 'text-danger' : 'text-foreground'}`}>{o.unpaid! < 0 ? `多收 ${money(-o.unpaid!)}` : money(o.unpaid)}</span> },
      { id: 'records', header: '记录', size: 180, sort: o => o.payments?.filter(p => !p.revoked).length ?? 0, filterValue: o => `${paymentSummary(o)} ${o.paymentCheckedAt ? `${user(o.paymentCheckedBy!)?.name ?? ''} ${o.paymentCheckedAt}` : ''}`, cell: o => <div className="py-1 text-xs text-muted-foreground"><span>{paymentSummary(o)}</span>{o.paymentCheckedAt && <span className="mt-1 block">{user(o.paymentCheckedBy!)?.name} · {shortDate(o.paymentCheckedAt)}</span>}</div> },
      { id: 'actions', header: '操作', size: 100, cell: o => <Button size="sm" variant="outline" className="h-7 whitespace-nowrap" onClick={() => openOrder(o.id, undefined, 'payments')}>记收款</Button> },
    ]} empty={<p className="p-8 text-center text-sm text-muted-foreground">当前条件下没有订单，可调整收款情况或核对进度。</p>}
    footer={table => { const current = table.getRowModel().rows.map(r => r.original); return <p className="border-t px-3 py-2 text-xs text-muted-foreground">当前 {current.length} 单 · 应收 {money(current.reduce((n,o) => n + (o.sales ?? 0),0))} · 已收 {money(current.reduce((n,o) => n + (o.received ?? 0),0))} · 未收 {money(current.reduce((n,o) => n + Math.max(o.unpaid ?? 0,0),0))}</p> }} />
    </div>
  </section>
}
