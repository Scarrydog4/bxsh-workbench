import { useId, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { Avatar, type Who } from './ui'

/**
 * 全站唯一的切换：选中项是浅绿底，切换时这块底从旧位置滑到新位置。
 * 视图、指标、页签、按人筛选都用它。
 */
export function Segmented<T extends string>({ value, onChange, items, label, size = 'md', className }: {
  value: T
  onChange: (value: T) => void
  items: readonly (readonly [T, ReactNode])[]
  label: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const layout = useId()
  const reducedMotion = useReducedMotion()
  return (
    <div role="tablist" aria-label={label} className={cn('scroll-hidden flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto', className)} onKeyDown={e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const i = items.findIndex(([id]) => id === value), next = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length][0]
      const list = e.currentTarget
      e.preventDefault()
      onChange(next)
      requestAnimationFrame(() => list.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus())
    }}>
      {items.map(([id, text], i) => {
        const on = value === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on || (i === 0 && !items.some(([x]) => x === value)) ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn('relative inline-flex shrink-0 items-center whitespace-nowrap rounded-md transition-colors', size === 'sm' ? 'h-7 gap-1 px-2.5 text-xs' : 'h-8 gap-1.5 px-3 text-sm',
              on ? 'font-medium text-primary' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
          >
            {on && (reducedMotion ? <span className="absolute inset-0 rounded-md bg-primary/10" /> : <motion.span layoutId={layout} initial={false} className="absolute inset-0 rounded-md bg-primary/10" transition={{ duration: .18, ease: [.2, .8, .2, 1] }} />)}
            <span className="relative inline-flex items-center gap-1.5">{text}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 按人筛选：头像 + 名字，「全部」在最后 */
export function PersonFilter({ value, onChange, people, label, allLabel = '全部', size, className }: {
  className?: string
  value: string
  onChange: (id: string) => void
  people: { user?: Who; id: string }[]
  label: string
  allLabel?: string
  size?: 'sm' | 'md'
}) {
  // 横向滚动会连带裁掉竖直方向，上下留白给头像框的蝴蝶结、皇冠
  return <Segmented label={label} value={value} onChange={onChange} size={size} className={cn('-my-1.5 py-1.5', className)}
    items={[...people.map(p => [p.id, <><Avatar user={p.user} size={size === 'sm' ? 18 : 22} />{p.user?.name ?? '—'}</>] as const), ['all', allLabel] as const]} />
}

/** 标题下面那一行：放切换和筛选 */
export function HeaderBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2', className)}>{children}</div>
}
