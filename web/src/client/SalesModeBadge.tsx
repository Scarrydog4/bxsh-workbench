import type { SalesMode } from '@/shared/types'
import { cn } from '@/lib/utils'

export const salesModeLabel = (mode?: SalesMode) => mode === 'cost' ? '底价' : '提成'

export function SalesModeBadge({ mode, className }: { mode?: SalesMode; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-normal leading-none', mode === 'cost' ? 'border-primary/20 bg-primary/5 text-primary' : 'border-border bg-background/70 text-muted-foreground', className)}>{salesModeLabel(mode)}</span>
}
