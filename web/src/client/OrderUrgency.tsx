import { useEffect, useState } from 'react'
import { Lightning, Star } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { OrderView } from '@/shared/types'
import { cn } from '@/lib/utils'
import { inputCls } from './ui'
import { setOrderImportance, setOrderUrgency, useSession } from './store'
import { usePref } from './prefs'

type FlagOrder = Pick<OrderView, 'urgency' | 'importance'> & Partial<Pick<OrderView, 'id' | 'assignees' | 'afterSales'>>

export function UrgencyBadge({ v }: { v: FlagOrder }) { return v.urgency ? <OrderFlag v={v} kind="urgency" compact/> : null }
export function ImportanceBadge({ v }: { v: FlagOrder }) { return v.importance ? <OrderFlag v={v} kind="importance" compact/> : null }

export function OrderBadges({ v }: { v: FlagOrder }) {
  return <><ImportanceBadge v={v}/><UrgencyBadge v={v}/></>
}

export function OrderUrgency({ v }: { v: OrderView }) { return <OrderFlag v={v} kind="urgency"/> }
export function OrderImportance({ v }: { v: OrderView }) { return <OrderFlag v={v} kind="importance"/> }

function OrderFlag({ v, kind, compact = false }: { v: FlagOrder; kind: 'urgency' | 'importance'; compact?: boolean }) {
  const flag = v[kind], label = kind === 'importance' ? '重要' : '加急'
  const Icon = kind === 'importance' ? Star : Lightning
  const update = kind === 'importance' ? setOrderImportance : setOrderUrgency
  const { can, me } = useSession()
  const editable = !compact && can('order.create') && can('order.edit')
  const [open, setOpen] = useState(false), [note, setNote] = useState(''), [busy, setBusy] = useState(false)
  const [hintOpen, setHintOpen] = useState(false)
  const [readAt, setReadAt] = usePref<string | null>(`order-flag-read:${me.id}:${v.id}:${kind}`, null)
  const assigned = v.assignees?.some(a => a.userId === me.id) || v.afterSales?.some(a => a.writerId === me.id && !a.doneAt && !a.cancelledAt)
  const unread = Boolean(v.id && flag && assigned && flag.by !== me.id && readAt !== flag.at)
  useEffect(() => { if (open) setNote(flag?.note ?? '') }, [open, v.id, flag?.note])
  // 只有说明真正展开才算看过；列表出现、滚动经过都不清掉未读。
  useEffect(() => { if ((open || hintOpen) && unread && flag) setReadAt(flag.at) }, [open, hintOpen, unread, flag, setReadAt])
  if (!flag && !editable) return null
  const content = <span className="relative inline-flex"><Icon size={compact ? 16 : 18} weight={flag ? 'fill' : 'regular'} aria-hidden="true" className={cn(unread && 'order-flag-unread')}/>{unread && <span aria-hidden="true" className="pointer-events-none absolute -right-0.5 -top-0.5 size-1 rounded-full bg-warn"/>}</span>
  const title = flag ? `${label}订单${flag.note ? `：${flag.note}` : ''}` : `标记${label}`
  const style = cn('inline-flex shrink-0 items-center justify-center rounded text-warn hover:bg-warn/10 outline-none focus-visible:ring-2 focus-visible:ring-ring', compact ? 'size-5' : 'size-8', !flag && 'opacity-50 hover:opacity-100')
  async function save(urgent: boolean) {
    if (busy || !v.id) return
    setBusy(true)
    try { if (await update(v.id, urgent, note)) { toast.success(urgent ? `已标记${label}` : `已取消${label}`); setOpen(false) } }
    finally { setBusy(false) }
  }
  return <Popover open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (value) setHintOpen(false) } }}>
    <Tooltip open={hintOpen && !open} onOpenChange={setHintOpen}>
      <TooltipTrigger asChild><PopoverTrigger asChild><button type="button" aria-label={`${editable ? flag ? '修改' : '标记' : '查看'}${label}${unread ? '（未读）' : ''}`} className={style} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}>{content}</button></PopoverTrigger></TooltipTrigger>
      <TooltipContent className="max-w-72 whitespace-pre-wrap break-words">{title}</TooltipContent>
    </Tooltip>
    <PopoverContent align="start" className="w-[min(320px,calc(100vw-40px))] space-y-3 p-3" onClick={e => e.stopPropagation()}>
      <p className="text-sm font-medium">订单{label}</p>
      {editable ? <>
      <textarea aria-label={`${label}说明`} autoFocus value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={3} disabled={busy} placeholder={kind === 'importance' ? '例如：同班同学订单，注意质量和沟通（可选）' : '加急说明（可选）'} className={cn(inputCls, 'h-auto resize-y py-2')}/>
      <div className="flex items-center justify-end gap-2">{flag && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save(false)}>取消{label}</Button>}<Button size="sm" disabled={busy} onClick={() => void save(true)}>{busy ? '保存中…' : flag ? '保存' : `标记${label}`}</Button></div>
      </> : <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{flag?.note || `${label}订单`}</p>}
    </PopoverContent>
  </Popover>
}
