import { useRef, useState } from 'react'
import { PencilSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { canAdjustDeadline } from '@/shared/perm'
import { shortDate } from '@/shared/format'
import type { OrderView } from '@/shared/types'
import { DatePicker } from './DatePicker'
import { updateOrder, useSession } from './store'
import { inputCls } from './ui'
import { cn } from '@/lib/utils'

export function OrderDeadline({ v }: { v: OrderView }) {
  const { s, me } = useSession()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(v.dueDate ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const editable = canAdjustDeadline(v, me, s.role)
  const writer = !s.role.locked && v.assignees.some(a => a.userId === me.id)

  if (!editable) return <span className={cn('num', !v.dueDate && 'text-muted-foreground')}>{v.dueDate ? shortDate(v.dueDate) : '—'}</span>
  if (!writer) return <DatePicker plain value={v.dueDate} label="修改日期" onChange={date => { if (date !== v.dueDate) void updateOrder(v.id, { dueDate: date }) }} />

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving.current || !date || date === v.dueDate || !reason.trim()) return
    saving.current = true
    setBusy(true)
    try {
      if (await updateOrder(v.id, { dueDate: date }, { reason: reason.trim() })) {
        setOpen(false)
        toast.success('交付日期已更新')
      }
    } finally { saving.current = false; setBusy(false) }
  }

  return <Popover open={open} onOpenChange={next => {
    if (saving.current) return
    if (next) { setDate(v.dueDate ?? ''); setReason('') }
    setOpen(next)
  }}>
    <PopoverTrigger asChild>
      <button type="button" aria-label="调整交付日期" className="group -mx-2 flex h-8 w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent data-[state=open]:bg-accent">
        <span className="num flex-1">{v.dueDate ? shortDate(v.dueDate) : '设置交付日期'}</span>
        <PencilSimple size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-80 p-4">
      <form onSubmit={save} className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">调整交付日期</span>
          <span className="text-xs text-muted-foreground">原定 {v.dueDate ? shortDate(v.dueDate) : '未设置'}</span>
        </div>
        <DatePicker value={date || null} label="新交付日期" onChange={setDate} disabled={busy} className="w-full" />
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          原因备注 <span className="sr-only">必填</span>
          <textarea required aria-label="交期调整备注" placeholder="说明为什么调整交付日期（必填）" maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} className={cn(inputCls, 'min-h-20 resize-y py-2 text-sm')} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
          <Button type="submit" size="sm" disabled={busy || !date || date === v.dueDate || !reason.trim()}>{busy ? '保存中…' : '保存交期'}</Button>
        </div>
      </form>
    </PopoverContent>
  </Popover>
}
