import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { parseMoneyInput } from '@/shared/money-input'
import { OperationStatus, useOperationFeedback, type ActionResult } from './operation-feedback'

const percentText = (value: number | null) => value === null ? '' : String(Number((value * 100).toFixed(2)))

export function PercentInput({ value, label, onSave, nullable = false }: { value: number | null; label: string; onSave: (rate: number | null, report?: (result: ActionResult) => void) => Promise<boolean>; nullable?: boolean }) {
  const [draft, setDraft] = useState(percentText(value))
  const [invalid, setInvalid] = useState(false)
  const dirty = useRef(false)
  const revision = useRef(0)
  const pending = useRef<{ revision: number; value: number | null } | null>(null)
  const feedback = useOperationFeedback()
  useEffect(() => { if (!dirty.current) { setDraft(percentText(value)); setInvalid(false) } }, [value])
  return <span className="inline-grid min-w-0 gap-0.5">
    <span className={cn('inline-flex h-8 items-center rounded-md border border-input bg-card pr-2 focus-within:ring-2 focus-within:ring-ring/30', invalid && 'border-danger')}>
      <input aria-label={label} aria-invalid={invalid || undefined} aria-busy={feedback.state.status === 'saving'} inputMode="decimal" value={draft} placeholder={nullable ? '按金额' : undefined}
        className="num h-full w-16 bg-transparent px-2 text-right text-sm outline-none"
        onChange={event => { dirty.current = true; revision.current++; feedback.reset(); setDraft(event.target.value); setInvalid(false) }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
        onBlur={async () => {
          const percent = parseMoneyInput(draft, 100)
          if (percent === undefined || percent === null && !nullable) { setInvalid(true); toast.error('比例请填写 0–100，最多两位小数'); return }
          const rate = percent === null ? null : percent / 100
          if (rate === value || pending.current?.value === rate) return
          const current = ++revision.current
          pending.current = { revision: current, value: rate }
          try {
            const saved = await feedback.run(report => onSave(rate, report))
            if (saved && revision.current === current) dirty.current = false
          } finally { if (pending.current?.revision === current) pending.current = null }
        }}/>
      <span className="text-xs text-muted-foreground">%</span>
    </span>
    <span className="min-h-5"><OperationStatus state={feedback.state} compact/></span>
  </span>
}
