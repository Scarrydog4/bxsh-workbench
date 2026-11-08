import { fuzzyMatch } from '@/shared/search'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CaretDown, Receipt } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Channel, OrderView } from '@/shared/types'
import type { ChannelReceipt, ChannelReceiptTag } from '@/shared/channel-receipts'
import { businessDate, money } from '@/shared/format'
import { distributeByPrice, moneyCents, receiptCandidate } from '@/shared/receipt-allocation'
import { FinancialNote, FinancialNoteView } from './FinancialNote'
import { ChannelAvatar, inputCls, Money } from './ui'
import { act, refresh, useSession } from './store'
import { saveChannelReceipt, type ReceiptCreateInput, type ReceiptAllocateInput } from './store-channel-receipts'
import { useNav } from './nav'

const receiptTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

export function ChannelReceiptDialog({ channel, orders, initialIds = [], receipt, onClose, onDone }: {
  channel: Channel; orders: OrderView[]; initialIds?: string[]; receipt?: ChannelReceipt; onClose: () => void; onDone: (id: string) => void
}) {
  const { role } = useSession()
  const [mode, setMode] = useState<'allocate' | 'advance'>('allocate')
  const [ids, setIds] = useState(initialIds)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [total, setTotal] = useState(receipt ? String(receipt.unallocated) : '')
  const [date, setDate] = useState(() => businessDate(new Date()))
  const [tag, setTag] = useState<ChannelReceiptTag>('定金')
  const [note, setNote] = useState(''), [proof, setProof] = useState<string>()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [reading, setReading] = useState(false)
  const sending = useRef(false), readingRef = useRef(false)
  const attempt = useRef<ReceiptCreateInput | ReceiptAllocateInput | null>(null)
  const frozenOrders = useRef<OrderView[] | null>(null)
  const locked = busy || unknown
  const candidates = (frozenOrders.current ?? orders).filter(receiptCandidate)
  const picked = candidates.filter(o => ids.includes(o.id))
  const shown = candidates.filter(o => fuzzyMatch([o.no, o.title], search))
  const totalCents = moneyCents(total)
  const allocated = picked.reduce((n, o) => n + (moneyCents(amounts[o.id] ?? '') ?? 0), 0)
  const validLines = picked.length > 0 && picked.every(o => {
    const n = moneyCents(amounts[o.id] ?? '')
    return n !== null && n <= Math.round((o.unpaid ?? 0) * 100)
  })
  const valid = receipt ? validLines && allocated <= Math.round(receipt.unallocated * 100)
    : totalCents !== null && !!date && (role.locked || !!note.trim() || !!proof) && (mode === 'advance' || validLines && allocated === totalCents)
  const priceOf = (o: OrderView) => o.sales ?? (o.unpaid ?? 0) + (o.received ?? 0)
  const pickedPrice = picked.reduce((n, o) => n + Math.round(priceOf(o) * 100), 0)
  const percent = pickedPrice > 0 && allocated > 0 ? Math.round(allocated / pickedPrice * 1000) / 10 : null
  function split() {
    const target = receipt ? Math.round(receipt.unallocated * 100) : totalCents
    const values = target && distributeByPrice(target, picked.map(o => ({ id: o.id, sales: priceOf(o), unpaid: o.unpaid })))
    if (!values) return toast.error(!picked.length ? '先选择订单' : '金额超出所选订单待收，或不足以分到每单')
    setAmounts(values)
  }
  async function submit() {
    if (sending.current || readingRef.current || (!attempt.current && !valid)) return
    sending.current = true; frozenOrders.current ??= orders.map(o => ({ ...o })); setBusy(true)
    const lines = !receipt && mode === 'advance' ? [] : picked.map(o => ({ orderId: o.id, amount: moneyCents(amounts[o.id] ?? '')! / 100 }))
    const payload = attempt.current ??= receipt
      ? { requestId: crypto.randomUUID(), id: receipt.id, revision: receipt.revision, lines }
      : { requestId: crypto.randomUUID(), channelId: channel.id, amount: totalCents! / 100, date, tag, note, proof, mode, lines: mode === 'advance' ? [] : lines }
    try {
      const result = await saveChannelReceipt(receipt ? 'channelReceipt.allocate' : 'channelReceipt.create', payload)
      if (result.status === 'success') {
        attempt.current = null; frozenOrders.current = null; setUnknown(false)
        toast.success(`${receipt ? '已分配' : '已记收款'} ${money(result.result.amount)}`)
        onDone(result.result.id)
      } else if (result.status === 'rejected') { attempt.current = null; frozenOrders.current = null; setUnknown(false) }
      else setUnknown(true)
    } finally { sending.current = false; setBusy(false) }
  }
  return <Dialog open onOpenChange={open => !open && !sending.current && !readingRef.current && !attempt.current && onClose()}>
    <DialogContent className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-2xl flex-col gap-0 overflow-hidden p-0" onEscapeKeyDown={e => { if (locked || reading) e.preventDefault() }} onPointerDownOutside={e => { if (locked || reading) e.preventDefault() }}>
      <header className="shrink-0 border-b px-5 py-4"><DialogTitle className="flex items-center gap-2 text-base"><ChannelAvatar channel={channel} size={24}/>{channel.name} · {receipt ? '分配预收款' : '记收款'}</DialogTitle><DialogDescription className="sr-only">一笔收款关联多张订单，共用备注和转账截图</DialogDescription></header>
      <div className="scroll-thin min-h-0 space-y-4 overflow-y-auto px-5 py-4">
        {receipt ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-accent/50 px-3 py-2 text-sm"><span>{receipt.no} · {receipt.date}</span><span>待分配 <Money value={receipt.unallocated}/></span></div> : <>
          <div className="flex items-center gap-2">{(['allocate', 'advance'] as const).map(m => <button type="button" key={m} disabled={locked} aria-pressed={mode === m} className={cn('rounded-md px-3 py-1.5 text-sm transition-colors', mode === m ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent')} onClick={() => setMode(m)}>{m === 'allocate' ? '分配到订单' : '暂存预收款'}</button>)}</div>
          <div className="grid grid-cols-2 items-end gap-3"><label className="grid gap-1.5 text-sm">收款总额<div className="relative"><span className="absolute left-3 top-2 text-muted-foreground">¥</span><input autoFocus aria-label="收款总额" inputMode="decimal" className={cn(inputCls, 'pl-7 tabular-nums')} placeholder="0.00" value={total} disabled={locked} onChange={e => setTotal(e.target.value)}/></div></label><label className="grid gap-1.5 text-sm">收款日期<input aria-label="渠道收款日期" type="date" max={businessDate(new Date())} className={inputCls} disabled={locked} value={date} onChange={e => setDate(e.target.value)}/></label></div>
          <div className="flex gap-2">{(['定金', '尾款', '全款'] as const).map(t => <button type="button" key={t} disabled={locked} aria-pressed={tag === t} onClick={() => setTag(t)} className={cn('rounded-full border px-3 py-1 text-sm', tag === t ? 'border-primary bg-primary/10 text-primary' : 'border-input')}>{t}</button>)}</div>
        </>}
        {(receipt || mode === 'allocate') && <div className="space-y-2">
          <div className="flex items-center gap-2"><input aria-label="搜索待收订单" className={cn(inputCls, 'h-8 min-w-0 flex-1')} value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索订单" disabled={locked}/><Button variant="outline" size="sm" disabled={locked || !picked.length || !(receipt || totalCents)} onClick={split}>按价格比例分</Button></div>
          <div className="overflow-hidden rounded-lg border"><div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><Checkbox aria-label="全选待收订单" checked={shown.length > 0 && shown.every(o => ids.includes(o.id)) ? true : shown.some(o => ids.includes(o.id)) ? 'indeterminate' : false} disabled={locked || !shown.length} onCheckedChange={on => setIds(old => on ? [...new Set([...old, ...shown.map(o => o.id)])] : old.filter(id => !shown.some(o => o.id === id)))}/><span className="flex-1">订单 / 待收</span><span className="w-28 text-right">本次分配</span></div>
            <div className="scroll-thin max-h-64 overflow-y-auto">{shown.map(o => {
              const selected = ids.includes(o.id), n = moneyCents(amounts[o.id] ?? '')
              const invalid = selected && !!amounts[o.id] && (n === null || n > Math.round((o.unpaid ?? 0) * 100))
              return <div key={o.id} className={cn('flex items-center gap-3 border-b px-3 py-2 last:border-0', selected && 'bg-primary/[.035]')}>
                <Checkbox aria-label={`选择收款 ${o.no}`} checked={selected} disabled={locked} onCheckedChange={on => setIds(old => on ? [...new Set([...old, o.id])] : old.filter(id => id !== o.id))}/>
                <label htmlFor={`receipt-amount-${o.id}`} className="min-w-0 flex-1 text-sm"><span className="block truncate" title={o.title}>{o.title}</span><span className="block text-xs text-muted-foreground">待收 {money(o.unpaid ?? 0)}</span></label>
                <input id={`receipt-amount-${o.id}`} aria-label={`${o.no} 本次分配`} aria-invalid={invalid} inputMode="decimal" placeholder="0.00" value={amounts[o.id] ?? ''} disabled={locked || !selected} onChange={e => setAmounts(old => ({ ...old, [o.id]: e.target.value }))} className={cn(inputCls, 'h-8 w-28 text-right tabular-nums', invalid && 'border-danger text-danger')}/>
              </div>
            })}{!shown.length && <p className="py-8 text-center text-sm text-muted-foreground">没有可分配的待收订单</p>}</div>
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>已选 {picked.length} 单 · 已分配 {money(allocated / 100)}{percent !== null && <> · 约每单 <strong className="text-foreground">{percent}%</strong></>}</span><span className={totalCents && allocated > totalCents ? 'text-danger' : ''}>{receipt ? '分配后剩余' : '未分配'} {money(((totalCents ?? 0) - allocated) / 100)}</span></div>
        </div>}
        {!receipt && <FinancialNote note={note} proof={proof} onNote={setNote} onProof={setProof} required={!role.locked} disabled={locked} onReading={value => { readingRef.current = value; setReading(value) }}/>}
        {unknown && <p role="status" className="text-sm text-warn">尚未收到确认。重试会核对同一笔收款，不会重复记账。</p>}
      </div>
      <footer className="flex shrink-0 items-center gap-3 border-t px-5 py-3"><span className="text-sm">{receipt ? '本次分配' : '实收'} <strong className="text-primary">{money((receipt ? allocated : totalCents ?? 0) / 100)}</strong></span><div className="ml-auto flex gap-2"><Button size="sm" variant="ghost" disabled={locked || reading} onClick={onClose}>取消</Button><Button size="sm" disabled={busy || reading || (!unknown && !valid)} onClick={() => void submit()}>{busy ? '正在保存…' : unknown ? '核对并重试' : receipt ? '确认分配' : '确认收款'}</Button></div></footer>
    </DialogContent>
  </Dialog>
}

export function ChannelReceiptHistory({ channelId, receiptId, onClose }: { channelId?: string; receiptId?: string; onClose: () => void }) {
  const { s, role, can, views, user } = useSession()
  const { openOrder } = useNav()
  const [rows, setRows] = useState<ChannelReceipt[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [expanded, setExpanded] = useState(receiptId ?? ''), [allocating, setAllocating] = useState<ChannelReceipt | null>(null)
  const [revoke, setRevoke] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const sending = useRef(false), [reload, setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('')
    const query = receiptId ? `id=${encodeURIComponent(receiptId)}` : `channelId=${encodeURIComponent(channelId ?? '')}`
    void fetch(`/api/channel-receipts?${query}`, { cache: 'no-store', signal: abort.signal }).then(async r => { if (!r.ok) throw new Error('收款记录读取失败'); return r.json() }).then(data => { setRows(data.receipts); setLoading(false) }).catch(e => { if (!abort.signal.aborted) { setError(e.message); setLoading(false) } })
    return () => abort.abort()
  }, [channelId, receiptId, s.version, reload])
  const channel = s.channels.find(c => c.id === (allocating?.channelId ?? channelId ?? rows[0]?.channelId))
  if (allocating && channel) return <ChannelReceiptDialog channel={channel} orders={views.filter(o => o.channelId === channel.id)} receipt={allocating} onClose={() => setAllocating(null)} onDone={id => { setAllocating(null); setExpanded(id); setReload(n => n + 1) }}/>
  return <Dialog open onOpenChange={open => !open && !sending.current && onClose()}><DialogContent className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-2xl flex-col gap-0 overflow-hidden p-0" onEscapeKeyDown={e => { if (busy) e.preventDefault() }} onPointerDownOutside={e => { if (busy) e.preventDefault() }}>
    <header className="shrink-0 border-b px-5 py-4"><DialogTitle className="text-base">{channel?.name ? `${channel.name} · ` : ''}收款记录</DialogTitle><DialogDescription className="sr-only">按每笔收款查看订单分配、备注和凭证</DialogDescription></header>
    <div className="scroll-thin min-h-0 space-y-3 overflow-y-auto p-5">
      {error ? <div role="alert" className="py-5 text-center text-sm">{error}<Button variant="ghost" onClick={() => setReload(n => n + 1)}>重试</Button></div> : loading ? <p role="status" className="py-5 text-center text-sm text-muted-foreground">读取中…</p> : !rows.length ? <p className="py-5 text-center text-sm text-muted-foreground">暂无合并收款或预收款</p> : rows.map(r => <div key={r.id} className={cn('overflow-hidden rounded-lg border', r.revoked && 'opacity-60')}>
        <button className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-accent/40" aria-expanded={expanded === r.id} onClick={() => setExpanded(expanded === r.id ? '' : r.id)}><Receipt size={20} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><span className="block font-medium">{r.date} · {r.tag} {r.revoked && <span className="text-danger">· 已撤销</span>}</span><span className="text-xs text-muted-foreground">{r.no} · {new Set(r.lines.map(l => l.orderId)).size} 单{r.unallocated > 0 && ` · 待分配 ${money(r.unallocated)}`}</span></span><Money value={r.amount}/><CaretDown size={14} className={expanded === r.id ? 'rotate-180' : ''}/></button>
        {expanded === r.id && <div className="space-y-3 border-t px-3 py-3 text-sm">
          {r.lines.length > 0 && <div className="divide-y">{r.lines.map(l => <button key={l.paymentId} className="flex w-full items-center gap-3 py-2 text-left hover:text-primary" onClick={() => { onClose(); openOrder(l.orderId) }}><span className="min-w-0 flex-1 truncate">{l.title}</span><Money value={l.amount}/></button>)}</div>}
          <FinancialNoteView note={r.note} proof={r.proof}/>
          <p className="text-xs text-muted-foreground">{user(r.createdBy)?.name} · {receiptTime.format(new Date(r.createdAt))}{r.revoked && ` · 撤销原因：${r.revoked.reason}`}</p>
          {!r.revoked && <div className="flex items-center gap-2">{r.unallocated > 0 && channel && can('payment.create') && <Button size="sm" onClick={() => setAllocating(r)}>分配到订单</Button>}{role.locked && <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => { setRevoke(r.id); setReason('') }}>撤销整笔</Button>}</div>}
          {revoke === r.id && !r.revoked && <div className="space-y-2 rounded-md border border-danger/20 bg-danger/5 p-3"><p className="text-xs">撤销 {money(r.amount)}，同时撤销这笔款在各订单中的分配。</p><input aria-label="撤销渠道收款原因" className={inputCls} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="撤销原因"/><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setRevoke('')}>取消</Button><Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={async () => {
            if (sending.current) return; sending.current = true; setBusy(true)
            try { if (await act('channelReceipt.revoke', { id: r.id, reason: reason.trim() })) { await refresh(true); setRevoke(''); setReload(n => n + 1); toast.success('整笔收款已撤销') } } finally { sending.current = false; setBusy(false) }
          }}>{busy ? '正在撤销…' : '确认撤销'}</Button></div></div>}
        </div>}
      </div>)}
    </div>
  </DialogContent></Dialog>
}

export function ChannelReceiptLink({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className="shrink-0 text-xs text-primary hover:underline" onClick={() => setOpen(true)}>合并收款</button>{open && <ChannelReceiptHistory receiptId={id} onClose={() => setOpen(false)}/>}</>
}
