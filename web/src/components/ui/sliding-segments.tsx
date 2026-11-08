'use client'

import { useRef, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Equal-width choices share one moving indicator; the form underneath never remounts. */
export function SlidingSegments<T extends string>({ value, onValueChange, options, label, disabled, className, buttonClassName }: {
  value: T
  onValueChange: (value: T) => void
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[]
  label: string
  disabled?: boolean
  className?: string
  buttonClassName?: string
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const selected = Math.max(0, options.findIndex(option => option.value === value))
  return <div role="radiogroup" aria-label={label} className={cn('sliding-segments relative isolate grid rounded-xl bg-muted/65 p-1', className)}
    style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, '--segment-count': options.length, '--segment-index': selected } as CSSProperties}>
    <span aria-hidden="true" className="sliding-segments-indicator pointer-events-none absolute bottom-1 left-1 top-1 -z-10 rounded-lg bg-card shadow-sm" />
    {options.map((option, index) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
      ref={node => { buttons.current[index] = node }} tabIndex={selected === index ? 0 : -1} disabled={disabled || option.disabled}
      onClick={() => { if (value !== option.value) onValueChange(option.value) }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const enabled = options.flatMap((item, i) => item.disabled ? [] : [i])
        const position = enabled.indexOf(index)
        const target = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[(position + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length]
        if (target === undefined) return
        buttons.current[target]?.focus()
        if (options[target].value !== value) onValueChange(options[target].value)
      }}
      className={cn('min-w-0 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60', value === option.value ? 'font-semibold text-primary' : 'text-muted-foreground hover:text-foreground', buttonClassName)}>{option.label}</button>)}
  </div>
}
