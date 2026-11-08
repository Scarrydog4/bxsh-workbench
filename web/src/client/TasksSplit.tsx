import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowsHorizontal } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useDevicePref } from './prefs'
import { useSettledFeedback } from './drag-feedback'
import feedbackStyles from './drag-feedback.module.css'

const clamp = (value: number) => Math.min(70, Math.max(30, Number.isFinite(value) ? value : 60))

/** 桌面按个人设备记住分栏、两栏各自滚动；窄屏仍由原来的上下顺序展示。 */
export function TasksSplit({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [saved, save] = useDevicePref<number>('tasks-split', 60)
  const [preview, setPreview] = useState<number | null>(null)
  const feedback = useSettledFeedback()
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; startX: number; startRatio: number; value: number } | null>(null)
  const ratio = clamp(preview ?? saved)
  const reset = () => { drag.current = null; setPreview(null); save(60); if (ratio !== 60) feedback.show() }

  return <div ref={root} style={{ '--tasks-left': `${ratio}fr`, '--tasks-right': `${100 - ratio}fr` } as CSSProperties}
    className="grid min-w-0 grid-cols-[minmax(0,1fr)] lg:h-full lg:grid-cols-[minmax(0,var(--tasks-left))_9px_minmax(0,var(--tasks-right))] lg:grid-rows-[minmax(0,1fr)] [&>*]:min-w-0 lg:[&>*]:min-h-0">
    {left}
    <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label="调整待交付和跟进宽度"
      aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(ratio)} aria-valuetext={`待交付 ${Math.round(ratio)}%，跟进 ${Math.round(100 - ratio)}%`}
      title="拖动调整两栏宽度，双击恢复默认宽度；也可用左右方向键调整"
      className={cn('group relative hidden cursor-col-resize touch-none select-none self-stretch justify-center rounded-md outline-none lg:flex focus-visible:ring-2 focus-visible:ring-primary/40', preview !== null && 'bg-primary/5')}
      onDoubleClick={reset}
      onKeyDown={event => {
        let next: number
        if (event.key === 'ArrowLeft') next = ratio - (event.shiftKey ? 10 : 2)
        else if (event.key === 'ArrowRight') next = ratio + (event.shiftKey ? 10 : 2)
        else if (event.key === 'Home') next = 30
        else if (event.key === 'End') next = 70
        else if (event.key === 'Enter') next = 60
        else return
        event.preventDefault()
        save(clamp(next))
        if (clamp(next) !== ratio) feedback.show()
      }}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        feedback.clear()
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startRatio: ratio, value: ratio }
        setPreview(ratio)
      }}
      onPointerMove={event => {
        const active = drag.current
        if (!active || active.pointerId !== event.pointerId) return
        const width = (root.current?.getBoundingClientRect().width ?? 0) - 16
        if (width <= 0) return
        active.value = clamp(active.startRatio + (event.clientX - active.startX) / width * 100)
        setPreview(active.value)
      }}
      onPointerUp={event => {
        const active = drag.current
        if (!active || active.pointerId !== event.pointerId) return
        drag.current = null
        save(active.value)
        setPreview(null)
        if (active.value !== active.startRatio) feedback.show()
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => { drag.current = null; setPreview(null) }}
      onLostPointerCapture={() => { drag.current = null; setPreview(null) }}>
      <span aria-hidden="true" data-split-settled={feedback.settled || undefined} className={cn(feedbackStyles.splitMark, preview !== null ? feedbackStyles.splitDragging : feedback.settled && feedbackStyles.splitActive)}/>
      <span className={cn('pointer-events-none absolute inset-y-0 w-px bg-border transition-colors duration-200 motion-reduce:transition-none group-hover:bg-primary/40 group-focus-visible:bg-primary/40', (preview !== null || feedback.settled) && 'bg-primary/80')}/>
      <span className={cn('pointer-events-none absolute top-1/2 flex h-7 w-4 -translate-y-1/2 items-center justify-center rounded border bg-card text-muted-foreground/50 opacity-0 transition-opacity duration-200 motion-reduce:transition-none group-hover:text-primary group-hover:opacity-100 group-focus-visible:opacity-100', (preview !== null || feedback.settled) && 'text-primary opacity-100')}>
        <ArrowsHorizontal size={14} aria-hidden="true" />
      </span>
    </div>
    {right}
  </div>
}
