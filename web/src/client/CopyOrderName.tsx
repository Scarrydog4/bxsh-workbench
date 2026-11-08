import { useEffect, useRef, useState } from 'react'
import { Check, CopySimple } from '@phosphor-icons/react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useCopyFeedback } from './copy-feedback'

/** 复制员工实际使用的订单名称；浏览器拒绝复制时保留可手动选取的全文。 */
export function CopyOrderName({ title, className, label, textLabel = '订单名称' }: { title: string; className?: string; label?: string; textLabel?: string }) {
  const feedback = useCopyFeedback(title)
  const copied = feedback.state === 'copied'
  const [fallback, setFallback] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => setFallback(false), [title])
  return <Popover open={fallback} onOpenChange={setFallback}>
    <PopoverAnchor asChild>
      <button type="button" title={copied ? `${textLabel}已复制` : `复制${textLabel}`} aria-label={copied ? `${textLabel}已复制` : `复制${textLabel}`}
        aria-busy={feedback.state === 'copying'}
        className={cn('inline-flex h-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30', label ? 'gap-1.5 px-2 text-sm' : 'w-7', className)}
        onPointerDown={event => event.stopPropagation()}
        onClick={async event => {
          event.preventDefault(); event.stopPropagation()
          const ok = await feedback.copy(() => navigator.clipboard.writeText(title))
          if (ok !== undefined) setFallback(!ok)
        }}>
        {copied ? <Check size={15} weight="bold" className="animate-in fade-in duration-150 text-ok motion-reduce:animate-none"/> : <CopySimple size={15}/>}
        {label && <span>{copied ? '已复制' : label}</span>}
        <span className="sr-only" role="status">{copied ? `${textLabel}已复制` : ''}</span>
      </button>
    </PopoverAnchor>
    <PopoverContent align="end" className="w-72 max-w-[calc(100vw-24px)] space-y-2 p-3" onClick={event => event.stopPropagation()}
      onOpenAutoFocus={event => { event.preventDefault(); field.current?.focus(); field.current?.select() }}>
      <p className="text-xs text-muted-foreground">按 ⌘C / Ctrl+C 复制{textLabel}</p>
      <input ref={field} aria-label={`${textLabel}，可手动复制`} value={title} readOnly
        onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()}
        className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"/>
    </PopoverContent>
  </Popover>
}
