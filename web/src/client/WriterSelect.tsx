import { useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { SpinnerGap } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Person, type Who } from './ui'

export type WriterSelectProps = {
  selected: Who[]
  people: Who[]
  onToggle: (id: string) => void | boolean | Promise<void | boolean>
  disabled?: boolean
  renderPay?: (person: Who) => ReactNode
}

export function WriterSelect({ selected, people, onToggle, disabled, renderPay }: WriterSelectProps) {
  const [pending, setPending] = useState<string | null>(null)
  const working = useRef(false)
  const reduceMotion = useReducedMotion()
  const selectedIds = new Set(selected.map(p => p.id))
  // 停用的已选写手仍可取消，但不会成为新增候选人。
  const candidates = [...people, ...selected.filter(p => !people.some(candidate => candidate.id === p.id))]
  const chosen = candidates.filter(p => selectedIds.has(p.id))
  const shown = [...chosen, ...candidates.filter(p => !selectedIds.has(p.id))]

  async function toggle(id: string) {
    if (disabled || working.current) return
    working.current = true; setPending(id)
    try { await onToggle(id) }
    catch { toast.error('更新写手失败，请重试') }
    finally { working.current = false; setPending(null) }
  }

  return <div role="group" aria-label="选择写手" aria-busy={pending !== null} className="flex min-w-0 flex-wrap items-start gap-2">
    {shown.map((p, index) => <motion.div key={p.id} layout={reduceMotion ? false : 'position'} transition={{ layout: { duration: .22, ease: [.2, .8, .2, 1] } }} className="relative grid min-w-0 gap-1.5 pt-3">
      {selectedIds.has(p.id) && chosen.length > 1 && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1">
        <span className="absolute top-0 h-px bg-primary/60" style={{ left: index === 0 ? '50%' : -8, right: index === chosen.length - 1 ? '50%' : 0 }}/>
        <span className="absolute left-1/2 top-0 h-2 w-px bg-primary/60"/>
      </span>}
      <button type="button" aria-pressed={selectedIds.has(p.id)} disabled={disabled || pending !== null}
        className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60', selectedIds.has(p.id) ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/40 hover:bg-accent')}
        onClick={event => { event.stopPropagation(); void toggle(p.id) }}>
        <Person user={p} size={20}/>
        {pending === p.id && <SpinnerGap size={13} className="animate-spin" aria-label="正在保存写手"/>}
      </button>
      {selectedIds.has(p.id) && renderPay?.(p)}
    </motion.div>)}
    {!shown.length && <span className="text-sm text-muted-foreground">暂无可选写手</span>}
  </div>
}
