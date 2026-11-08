'use client'

import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A local expanding region. Contents stay mounted so inputs survive closing/reopening. */
export function Disclosure({ summary, children, className, triggerClassName, defaultOpen = false }: {
  summary: ReactNode
  children: ReactNode
  className?: string
  triggerClassName?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return <div className={cn('disclosure', className)} data-open={open}>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className={cn('disclosure-trigger flex items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', triggerClassName)}>{summary}</button>
    <div id={id} className="disclosure-content" inert={!open} aria-hidden={!open}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  </div>
}
