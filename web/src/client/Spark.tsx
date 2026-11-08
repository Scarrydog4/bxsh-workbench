import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * 首页指标卡里的小趋势图：不画坐标轴和刻度，只表达走势。
 * 悬停/点按某一天时通过 onActive 把下标交给外层，读数显示在卡片里固定的位置，不弹浮层挡图。
 */
export function Spark({ values, compare, kind = 'bars', active, onActive, label, className, inProgress = false }: {
  values: number[]
  /** 对照序列（上月同期），画成浅色虚线 */
  compare?: number[]
  kind?: 'bars' | 'line'
  active: number | null
  onActive: (index: number | null) => void
  label: string
  className?: string
  /** 最后一个点仍在统计中，用虚线连接，保留实际金额。 */
  inProgress?: boolean
}) {
  const gradient = useId()
  const W = 240, H = 56, n = Math.max(values.length, compare?.length ?? 0, 1)
  const max = Math.max(1, ...values, ...(compare ?? []))
  const y = (v: number) => H - 2 - (v / max) * (H - 6)
  const step = W / n
  // Lines reach both edges; bars retain their existing equal-width buckets.
  const inset = 4
  const lineX = (index: number) => n === 1 ? W / 2 : inset + index / (n - 1) * (W - inset * 2)
  const pick = (clientX: number, rect: DOMRect) => {
    if (!values.length || !rect.width) return null
    const position = (clientX - rect.left) / rect.width * W
    const index = kind === 'bars' ? Math.floor(position / step) : n === 1 ? 0 : Math.round((position - inset) / (W - inset * 2) * (n - 1))
    return Math.min(values.length - 1, Math.max(0, index))
  }
  const path = (list: number[], offset = 0) => list.map((v, i) => `${i ? 'L' : 'M'}${lineX(i + offset)},${y(v)}`).join('')
  const last = values.length - 1
  const completed = inProgress ? values.slice(0, -1) : values
  return (
    <svg
      role="img"
      aria-label={`${label}${inProgress ? '，今日数据截至当前' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('block w-full touch-pan-y', className ?? 'h-14 wide:h-20')}
      onPointerMove={e => onActive(pick(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onPointerDown={e => onActive(pick(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onPointerLeave={e => { if (e.pointerType === 'mouse') onActive(null) }}
    >
      {kind === 'bars' ? <>
        <line x1={0} x2={W} y1={H - 1.5} y2={H - 1.5} stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" className="text-border" />
        {values.map((v, i) => !!v && (
        <rect
          key={i}
          x={i * step + step * 0.18}
          width={step * 0.64}
          y={y(v)}
          height={Math.max(2, H - 2 - y(v))}
          rx={1}
          className={cn('fill-primary transition-opacity', active === null ? (i === last ? 'opacity-100' : 'opacity-35') : i === active ? 'opacity-100' : 'opacity-20')}
        />
      ))}
      </> : <>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity=".18" />
            <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {compare && <path d={path(compare)} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" className="text-muted-foreground/50" />}
        {completed.length > 1 && <path d={`${path(completed)}L${lineX(completed.length - 1)},${H}L${lineX(0)},${H}Z`} fill={`url(#${gradient})`} />}
        <path data-chart-line="completed" d={path(completed)} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {inProgress && values.length > 0 && <>
          <path data-chart-line="current" d={path(values.slice(Math.max(0, last - 1)), Math.max(0, last - 1))} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.8" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <circle cx={lineX(last)} cy={y(values[last])} r={1.7} fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </>}
      </>}
      {active !== null && active >= 0 && active < values.length && kind === 'line' && <line x1={lineX(active)} x2={lineX(active)} y1={0} y2={H} stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" className="text-foreground/25" />}
    </svg>
  )
}
