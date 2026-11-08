import { useRef, useState } from 'react'
import { PencilSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { canAdjustDeadline } from '@/shared/perm'
import type { OrderView } from '@/shared/types'
import { cn } from '@/lib/utils'
import { DatePicker } from './DatePicker'
import { updateOrder, useSession } from './store'
import { inputCls } from './ui'

/** 复用订单编辑和交期留痕，填写进度时也能调整本单截止日期。 */
export function OrderProgress({ v, compact = false }: { v: OrderView; compact?: boolean }) {
  const { me, role } = useSession()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(v.progressNote ?? '')
  const [date, setDate] = useState(v.dueDate ?? '')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const editable = canAdjustDeadline(v, me, role)
  if (!editable) return v.progressNote ? <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{v.progressNote}</span> : null
  const dateChanged = date !== (v.dueDate ?? '')
  const changed = note.trim() !== (v.progressNote ?? '') || dateChanged

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving.current || !note.trim() || !changed || dateChanged && !date) return
    saving.current = true
    setBusy(true)
    try {
      const patch = { progressNote: note.trim(), ...(dateChanged ? { dueDate: date } : {}) }
      if (await updateOrder(v.id, patch, { reason: note.trim() })) {
        setOpen(false)
        toast.success(dateChanged ? '进度和截止日期已更新' : '进度已更新')
      }
    } finally { saving.current = false; setBusy(false) }
  }

  return <Popover open={open} onOpenChange={next => {
    if (saving.current) return
    if (next) { setNote(v.progressNote ?? ''); setDate(v.dueDate ?? '') }
    setOpen(next)
  }}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`更新进度：${v.title}`} title={v.progressNote || '填写当前进度，可同时调整截止日期'}
        onClick={e => e.stopPropagation()}
        className={cn('inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-primary', !compact && 'w-full')}>
        <PencilSimple size={14} className="shrink-0"/>
        <span className={cn('truncate', compact && 'max-sm:sr-only')}>{compact ? '更新进度' : v.progressNote || '填写进度'}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-80 max-w-[calc(100vw-24px)] p-4" onClick={e => e.stopPropagation()}>
      <form onSubmit={save} className="grid gap-3">
        <div><p className="text-sm font-medium">更新订单进度</p><p className="mt-1 break-words text-xs text-muted-foreground">{v.title}</p></div>
        <label className="grid gap-1.5 text-xs text-muted-foreground">当前进度
          <textarea aria-label="当前进度" required maxLength={500} rows={3} value={note} disabled={busy} onChange={e => setNote(e.target.value)}
            placeholder="例如：开题已交，等导师意见；因补充资料，交期调整到周五" className={cn(inputCls, 'h-auto resize-y py-2 text-sm')}/>
        </label>
        <div className="grid gap-1.5"><span className="text-xs text-muted-foreground">订单截止日期</span><DatePicker value={date || null} label="订单截止日期" onChange={setDate} disabled={busy} className="w-full"/></div>
        {dateChanged && <p className="text-xs text-muted-foreground">请在进度中说明改期原因，销售会收到提醒。</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
          <Button type="submit" size="sm" disabled={busy || !note.trim() || !changed || dateChanged && !date}>{busy ? '保存中…' : '保存'}</Button>
        </div>
      </form>
    </PopoverContent>
  </Popover>
}
