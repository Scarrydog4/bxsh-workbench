import { useEffect, useRef, useState, type ReactNode, type RefObject, type PointerEvent } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { businessDate } from '@/shared/format'
import styles from './chart-feedback.module.css'

export type ChartReading = { label: string; value?: string; tone?: 'primary' | 'danger' | 'warn' }
export type JournalPoint = { key: string; label: string; tick: string; at: number; value: number; readings: ChartReading[]; inProgress?: boolean }
export const chartNumber = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 })

/** Use the same business day as the report; a historical date selection is already complete. */
export function isCurrentChartPeriod(start: string, end: string, selection?: { from: string; to: string; dates?: string[] | null }, now = new Date()) {
  const today = businessDate(now)
  return start <= today && end >= today && (!selection || (selection.dates?.length ? selection.dates.includes(today) : selection.from <= today && selection.to >= today))
}

export function journalScale(values: number[], integer = false, divisions = 4, tight = false) {
  const dataMin = Math.min(0, ...values), dataMax = Math.max(0, ...values)
  const padding = tight ? 1 : 1.08
  const roughStep = ((dataMax - dataMin) * padding || 1) / divisions, magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const candidates = integer ? [1, 2, 5, 10] : tight ? [1, 1.25, 1.5, 2, 2.5, 4, 5, 10] : [1, 2, 2.5, 5, 10]
  const step = Math.max(integer ? 1 : .01, candidates.find(value => value * magnitude >= roughStep)! * magnitude)
  const min = Math.floor(dataMin * padding / step) * step
  const max = Math.ceil((dataMax * padding || (dataMin ? 0 : 1)) / step) * step
  return { min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => Number((min + i * step).toFixed(2))) }
}

export function chartReadout(title: string, readings: ChartReading[]) {
  return <><div className="mb-2 border-b pb-1.5 font-medium [overflow-wrap:anywhere]">{title}</div>{readings.map((reading, i) => reading.value === undefined
    ? <div key={i} className={cn('mt-1', reading.tone === 'primary' && 'text-primary', reading.tone === 'danger' && 'text-danger', reading.tone === 'warn' && 'text-warn')}>{reading.label}</div>
    : <div key={i} className="mt-1 flex justify-between gap-3"><span className="text-muted-foreground">{reading.label}</span><span className={cn('num font-medium', reading.tone === 'primary' && 'text-primary', reading.tone === 'danger' && 'text-danger', reading.tone === 'warn' && 'text-warn')}>{reading.value}</span></div>)}</>
}
const pointTitle = (row: Pick<JournalPoint, 'label' | 'inProgress'>) => `${row.label}${row.inProgress ? ' · 截至当前' : ''}`
const pointLabel = (row: Pick<JournalPoint, 'label' | 'readings' | 'inProgress'>) => `${pointTitle(row)}，${row.readings.map(reading => `${reading.label}${reading.value === undefined ? '' : ` ${reading.value}`}`).join('，')}`

// Touch taps keep a reading open; swiping over a chart remains native page scrolling.
function useChartSelection(host: RefObject<HTMLDivElement | null>) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const pointer = useRef('mouse'), pinned = useRef(false)
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const clear = () => { pinned.current = false; setActiveKey(null) }
  const hover = (key: string) => { if (pointer.current !== 'touch') { pinned.current = false; setActiveKey(key) } }
  const leave = () => { if (!pinned.current) setActiveKey(null) }
  const leaveRow = (key: string) => { if (!pinned.current) setActiveKey(current => current === key ? null : current) }
  const select = (key: string) => {
    if (pointer.current === 'touch' && gesture.current?.moved) return
    pinned.current = pointer.current === 'touch'; setActiveKey(key)
  }
  const keyboard = (key: string) => { pointer.current = 'keyboard'; pinned.current = false; setActiveKey(key) }
  const onPointerDown = (event: PointerEvent) => {
    pointer.current = event.pointerType
    gesture.current = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY, moved: false } : null
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      const start = gesture.current
      if (start && !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) { start.moved = true; clear() }
      return true
    }
    pointer.current = 'mouse'
    return false
  }
  const onPointerCancel = () => { if (gesture.current) gesture.current.moved = true; clear() }
  useEffect(() => {
    if (!activeKey || typeof document === 'undefined') return
    const outside = (event: globalThis.PointerEvent) => { if (!host.current?.contains(event.target as Node)) clear() }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [activeKey, host])
  return { activeKey, hover, leave, leaveRow, select, keyboard, clear, onPointerDown, onPointerMove, onPointerCancel }
}

export function JournalTimeChart({ rows, label, unit = '金额 / 元', xLabel = '日期', integer = false, compact = false, kind = 'auto', hourly = false, axisFormat, formatValue = chartNumber }: {
  rows: JournalPoint[]; label: string; unit?: string; xLabel?: string; integer?: boolean; compact?: boolean; kind?: 'auto' | 'bar'; formatValue?: (value: number) => string; hourly?: boolean; axisFormat?: (value:number)=>string
}) {
  const host = useRef<HTMLDivElement>(null), [width, setWidth] = useState(680)
  const selection = useChartSelection(host), { activeKey } = selection
  useEffect(() => {
    const element = host.current
    if (!element) return
    const resize = () => setWidth(Math.max(160, element.clientWidth))
    const observer = new ResizeObserver(resize); observer.observe(element); resize()
    return () => observer.disconnect()
  }, [])
  const { min, max, ticks } = journalScale(rows.map(row => row.value), integer || !!axisFormat, compact ? 3 : 4, !!axisFormat)
  const axisLabel = axisFormat ?? chartNumber
  const height = compact ? 108 : width < 480 ? 176 : 216, left = compact ? 30 : Math.max(64,...ticks.map(t => axisLabel(t).length * 7.5 + 14)), right = compact ? 14 : 24, top = compact ? 20 : 30, bottom = compact ? 26 : 44
  const bars = kind === 'bar' || rows.length === 1
  const barWidth = hourly ? Math.max(2,Math.min(24,(width-left-right)/24*.65)) : rows.length < 2 ? 64 : Math.max(2, Math.min(22, (width - left - right) / rows.length * .65))
  const barInset = bars && rows.length > 1 ? barWidth / 2 : 0
  const duration = rows.at(-1)?.at! - rows[0]?.at!
  const hourWidth = (width-left-right)/24
  const x = (i: number) => hourly ? left + (i+.5)*hourWidth : kind === 'bar' ? left + (i+.5)*(width-left-right)/rows.length : left + (rows.length < 2 || !duration ? (width - left - right) / 2 : barInset + (rows[i].at - rows[0].at) / duration * (width - left - right - barInset * 2))
  const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom)
  const hasCurrent = rows.some(row => row.inProgress)
  const line = (inProgress: boolean) => rows.flatMap((row, i) => i > 0 && Boolean(row.inProgress || rows[i - 1].inProgress) === inProgress
    ? [`M${x(i - 1)},${y(rows[i - 1].value)} L${x(i)},${y(row.value)}`] : []).join(' ')
  const nearest = (position: number) => rows.reduce((best, _, i) => Math.abs(x(i) - position) < Math.abs(x(best) - position) ? i : best, 0)
  const labelCount = Math.max(2, Math.min(compact ? 3 : 7, Math.floor((width - left - right) / 90) + 1))
  // Reserve a box for each printed label, independently of its tick mark.
  // Date labels use tabular digits; allow a full em for wide punctuation.
  const labelBox = (i: number) => {
    const tick = rows[i].tick
    const fontSize = compact ? 10 : 12
    const half = Array.from(tick).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 127 ? fontSize : fontSize * .65), 0) / 2
    const center = Math.max(half + 2, Math.min(x(i), width - half - 2))
    return { i, center, left: center - half, right: center + half }
  }
  const candidates = !hourly && rows.length ? [...new Set(Array.from({ length: labelCount }, (_, i) =>
    nearest(left + i / (labelCount - 1) * (width - left - right))))].map(labelBox) : []
  const last = candidates.at(-1)
  const labels = []
  let previousEnd = -Infinity
  for (const label of candidates) {
    if (label !== last && (label.left < previousEnd + 8 || label.right + 8 > last!.left)) continue
    labels.push(label)
    previousEnd = label.right
  }
  const xTicks = hourly ? [0,3,6,9,12,15,18,21].map(i => ({ i, center: x(i) })) : labels
  const activeIndex = rows.findIndex(row => row.key === activeKey), active = rows[activeIndex]
  return <div ref={host} className="relative min-w-0" onPointerDown={selection.onPointerDown} onPointerCancel={selection.onPointerCancel} onPointerMove={event => {
    if (selection.onPointerMove(event) || !rows.length) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = (event.clientX - bounds.left) / bounds.width * width
    if (hourly && position > x(rows.length-1)+hourWidth/2) return selection.leave()
    if (bounds.width) selection.hover(rows[nearest(position)].key)
  }} onMouseLeave={selection.leave} onKeyDown={event => {
    if (event.key === 'Escape') selection.clear()
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && rows.length) {
      event.preventDefault()
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, (activeIndex < 0 ? 0 : activeIndex) + (event.key === 'ArrowLeft' ? -1 : 1)))
      selection.keyboard(rows[index].key)
    }
  }}><svg role="group" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="block w-full" style={{ height }}>
    <text x={left} y={compact ? 10 : 13} fill="currentColor" className="text-muted-foreground" fontSize={compact ? 10 : 12}>{unit}</text>
    {ticks.map(value => <g key={value}>
      <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="currentColor" strokeWidth=".6" className={value === 0 ? 'text-foreground/35' : 'text-border/70'}/>
      <line x1={left - 4} x2={left} y1={y(value)} y2={y(value)} stroke="currentColor" strokeWidth=".8" className="text-foreground/60"/>
      <text x={left - 9} y={y(value) + 4} textAnchor="end" fill="currentColor" className="num text-muted-foreground" fontSize={compact ? 10 : 12}>{axisLabel(value)}</text>
    </g>)}
    <path d={`M${left},${top} V${height - bottom} H${width - right}`} fill="none" stroke="currentColor" strokeWidth=".8" className="text-foreground/60"/>
    {hourly && rows.map((row,i)=>row.inProgress && <rect key={row.key} x={x(i)-hourWidth/2} y={top} width={hourWidth} height={height-bottom-top} fill="currentColor" opacity=".07" className="pointer-events-none text-primary"/>)}
    {bars ? <g aria-hidden="true">{rows.map((row, i) => <g key={row.key}>
      <rect x={x(i) - barWidth / 2} y={Math.min(y(0), y(row.value))} width={barWidth} height={Math.max(row.value === 0 ? 0 : 2, Math.abs(y(0) - y(row.value)))} rx="1" fill="currentColor" fillOpacity={row.inProgress ? .2 : 1} stroke={row.inProgress ? 'currentColor' : undefined} strokeDasharray={row.inProgress ? '3 3' : undefined} className={row.value < 0 ? 'text-danger' : 'text-primary'} opacity={activeKey === row.key ? .9 : .72}/>
      {rows.length === 1 && !hourly && <text x={x(i)} y={y(row.value) + (row.value < 0 ? 16 : -8)} textAnchor="middle" fontSize="12" fontWeight="500" fill="currentColor" className={row.value < 0 ? 'text-danger' : 'text-primary'}>{formatValue(row.value)}</text>}
    </g>)}</g> : <>
      <path data-chart-line="completed" d={line(false)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="pointer-events-none text-primary"/>
      {hasCurrent && <path data-chart-line="current" d={line(true)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" className="pointer-events-none text-primary"/>}
    </>}
    {active && <g className={cn(styles.appear, "pointer-events-none text-foreground/40")} stroke="currentColor" strokeWidth=".8" strokeDasharray="3 4"><line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={height - bottom}/><line x1={left} x2={width - right} y1={y(active.value)} y2={y(active.value)}/></g>}
    {rows.map((row, i) => <g key={row.key} role="button" tabIndex={0} aria-label={pointLabel(row)} aria-pressed={activeKey === row.key} className="cursor-pointer outline-none" onMouseEnter={() => selection.hover(row.key)} onFocus={() => selection.hover(row.key)} onBlur={selection.leave} onClick={() => selection.select(row.key)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selection.keyboard(row.key) } }}>
      <rect x={i === 0 ? left - 8 : (x(i - 1) + x(i)) / 2} y={0} width={(i === rows.length - 1 ? (hourly ? x(i)+hourWidth/2 : width - right + 8) : (x(i) + x(i + 1)) / 2) - (i === 0 ? left - 8 : (x(i - 1) + x(i)) / 2)} height={height - bottom + 4} fill="transparent"/>
      <circle cx={x(i)} cy={y(row.value)} r={activeKey === row.key ? 5 : bars || axisFormat && row.value===0 ? 0 : 2.75} className={cn(styles.marker, 'pointer-events-none', row.value < 0 ? 'text-danger' : 'text-primary')} fill={activeKey === row.key ? 'currentColor' : 'hsl(var(--card))'} stroke={activeKey === row.key ? 'hsl(var(--card))' : 'currentColor'} strokeWidth={activeKey === row.key ? 2 : 1.4}/>
    </g>)}
    {xTicks.map(({ i, center }) => <g key={i} className="pointer-events-none"><line x1={x(i)} x2={x(i)} y1={height - bottom} y2={height - bottom + 4} stroke="currentColor" strokeWidth=".8" className="text-foreground/60"/><text x={center} y={height - bottom + 19} textAnchor="middle" fill="currentColor" className="num text-muted-foreground" fontSize={compact ? 10 : 12}>{hourly ? String(i).padStart(2,'0') : rows[i].tick}</text></g>)}
    {!compact && <text x={width - right} y={height - 4} textAnchor="end" fill="currentColor" className="text-muted-foreground" fontSize="12">{xLabel}</text>}
  </svg>{hasCurrent && <p className="pb-1 text-right text-xs text-muted-foreground"><span aria-hidden="true" className={hourly || bars ? "mr-1.5 inline-block size-3 rounded-sm border border-primary/30 bg-primary/15 align-middle" : "mr-1.5 inline-block w-4 border-t border-dashed border-primary align-middle"}/>{hourly?'浅色区为当前小时，金额仍在累计':bars?'浅色柱为当前时段，金额仍在累计':'截至当前，当前时段尚未结束'}</p>}{active && <div role="tooltip" className={cn(styles.appear, "pointer-events-none absolute top-5 z-20 w-56 max-w-full rounded border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-md")} style={{ left: `${Math.max(0, Math.min(x(activeIndex) + (x(activeIndex) < width / 2 ? 14 : -238), width - Math.min(width, 224))) / width * 100}%` }}>{chartReadout(pointTitle(active), active.readings)}</div>}</div>
}

type JournalBar = { key: string; name: string; label: ReactNode; value: number; valueLabel: string; readings: ChartReading[]; tone?: 'warn' }
export function JournalBars({ rows, label, compact = false, integer = false }: { rows: JournalBar[]; label: string; compact?: boolean; integer?: boolean }) {
  const host = useRef<HTMLDivElement>(null), selection = useChartSelection(host)
  const scale = journalScale(rows.map(row => row.value), integer)
  const gridTemplateColumns = compact ? '36px minmax(30px,1fr) 66px' : 'minmax(90px,1fr) minmax(50px,1.5fr) 110px'
  return <div ref={host} role="group" aria-label={label} className="flex min-h-0 flex-1 flex-col" onPointerDown={selection.onPointerDown} onPointerMove={selection.onPointerMove} onPointerCancel={selection.onPointerCancel} onKeyDown={event => { if (event.key === 'Escape') selection.clear() }}>
    <div className="mb-1 grid items-end gap-2 text-[10px] text-muted-foreground" style={{ gridTemplateColumns }}><span/>
      <div><div className="mb-1 text-right">{integer ? '单数 / 单' : '金额 / 元'}</div><div className="num flex justify-between border-b border-foreground/50 pb-1"><span>{chartNumber(scale.min)}</span>{!compact && <span>{chartNumber((scale.min + scale.max) / 2)}</span>}<span>{chartNumber(scale.max)}</span></div></div><span/>
    </div>
    <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={selection.clear}>
      {rows.map(row => <Tooltip key={row.key} delayDuration={0} open={selection.activeKey === row.key} onOpenChange={open => open ? selection.hover(row.key) : selection.leaveRow(row.key)}><TooltipTrigger asChild>
        <button type="button" aria-label={pointLabel({ label: row.name, readings: row.readings })} aria-pressed={selection.activeKey === row.key} onClick={() => selection.select(row.key)} onMouseEnter={() => selection.hover(row.key)} onMouseLeave={selection.leave} onFocus={() => selection.hover(row.key)} onBlur={selection.leave} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selection.keyboard(row.key) } }} className={cn(selection.activeKey === row.key && 'bg-accent/40', 'group/chart grid w-full items-center gap-2 rounded-sm text-left text-sm outline-none hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-primary', compact ? 'h-7' : 'h-10')} style={{ gridTemplateColumns }}>
          <span className="min-w-0 truncate">{row.label}</span>
          <span className="relative flex h-6 items-center">{[0, 50, 100].map(position => <span key={position} className="pointer-events-none absolute inset-y-0 border-l border-border/60" style={{ left: `${position}%` }}/>) }{scale.min < 0 && <span className="pointer-events-none absolute inset-y-0 border-l border-foreground/40" style={{ left: `${-scale.min / (scale.max - scale.min) * 100}%` }}/>}<span className={cn(styles.marker, selection.activeKey === row.key && '!opacity-100', 'absolute h-2 rounded-[1px] opacity-70 group-hover/chart:opacity-100 group-focus-visible/chart:opacity-100', row.value < 0 ? 'bg-danger' : row.tone === 'warn' ? 'bg-warn' : 'bg-primary')} style={{ left: `${(Math.min(0, row.value) - scale.min) / (scale.max - scale.min) * 100}%`, width: `${Math.abs(row.value) / (scale.max - scale.min) * 100}%` }}/></span>
          <span className="num truncate text-right text-xs text-muted-foreground">{row.valueLabel}</span>
        </button>
      </TooltipTrigger><TooltipContent side="top" onPointerDownOutside={selection.clear} onEscapeKeyDown={selection.clear} className={cn(styles.readout, "pointer-events-none w-56 rounded border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-md")}>{chartReadout(row.name, row.readings)}</TooltipContent></Tooltip>)}
    </div>
  </div>
}
