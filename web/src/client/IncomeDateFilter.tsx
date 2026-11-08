import { useState } from 'react'
import { Segmented } from './controls'
import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar, fromDay, toDay } from '@/components/ui/calendar'
import { businessDate } from '@/shared/format'
import { cn } from '@/lib/utils'

export type IncomeDateSelection = { mode: 'today' | 'week' | 'month' | 'range' | 'dates'; from: string; to: string; dates: string[] }
const isoDay = (date: Date) => date.toISOString().slice(0, 10)
export function incomePreset(mode: 'today' | 'week' | 'month', today = businessDate(new Date())): IncomeDateSelection {
  const start = new Date(`${today}T00:00:00Z`), end = new Date(start)
  if (mode === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
  if (mode === 'month') start.setUTCDate(1)
  return { mode, from: isoDay(start), to: isoDay(end), dates: [] }
}
export function validIncomeDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && isoDay(date) === value
}
export function incomeDateLabel(value: IncomeDateSelection) {
  return value.mode === 'dates' ? value.dates.join('、') : value.from === value.to ? value.from : `${value.from} — ${value.to}`
}
export function incomeDateParams(value: IncomeDateSelection): Record<string, string> {
  return value.mode === 'dates' ? { dates: [...new Set(value.dates)].sort().join(',') } : { from: value.from, to: value.to }
}
/** 全部日期保留未记日期的历史记录；选定范围后只纳入有真实日期的记录。 */
export function matchesIncomeDate(day: string | null | undefined, range: IncomeDateSelection | null) {
  if (!range) return true
  if (!day || !validIncomeDay(day)) return false
  return range.mode === 'dates' ? range.dates.includes(day) : day >= range.from && day <= range.to
}
const addDays = (day: string, n: number) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000))
const monthEnd = (month: string) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return isoDay(d) }
const addMonths = (month: string, n: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return isoDay(d).slice(0, 7) }
const range = (from: string, to: string): IncomeDateSelection => ({ mode: 'range', from, to, dates: [] })
const wholeMonth = (v: IncomeDateSelection) => v.from.endsWith('-01') && v.to === monthEnd(v.from.slice(0, 7))

/** ‹ › 平移一个周期：单日挪一天，整月挪一个月，其他区间按自身长度挪 */
export function shiftIncomeDates(v: IncomeDateSelection, dir: 1 | -1, today = businessDate(new Date())): IncomeDateSelection {
  const next = shiftRaw(v, dir, today)
  return next.to > today && next.from <= today ? { ...next, to: today } : next
}
function shiftRaw(v: IncomeDateSelection, dir: 1 | -1, today: string): IncomeDateSelection {
  if (v.mode === 'dates') return v
  if (v.mode === 'month' || wholeMonth(v)) { const m = addMonths(v.from.slice(0, 7), dir); return range(`${m}-01`, m === today.slice(0, 7) ? today : monthEnd(m)) }
  if (v.mode === 'week') { const from = addDays(v.from, dir * 7); return range(from, addDays(from, 6)) }
  const len = Math.round((Date.parse(v.to) - Date.parse(v.from)) / 86_400_000) + 1
  return range(addDays(v.from, dir * len), addDays(v.to, dir * len))
}

/** 给人看的日期：10月24日 周六 / 2026年10月 / 10月20日 – 26日 */
export function incomeDateText(v: IncomeDateSelection, today = businessDate(new Date())) {
  const year = today.slice(0, 4)
  const day = (d: string, withMonth = true) => `${d.slice(0, 4) === year ? '' : `${d.slice(0, 4)}年`}${withMonth ? `${Number(d.slice(5, 7))}月` : ''}${Number(d.slice(8))}日`
  if (v.mode === 'dates') return v.dates.length === 1 ? day(v.dates[0]) : `${v.dates.length} 天`
  if (v.from === v.to) return `${day(v.from)} 周${'日一二三四五六'[new Date(`${v.from}T00:00:00Z`).getUTCDay()]}`
  if (v.from.endsWith('-01') && (v.to === monthEnd(v.from.slice(0, 7)) || (v.to === today && v.from.slice(0, 7) === today.slice(0, 7)))) return `${v.from.slice(0, 4)}年${Number(v.from.slice(5, 7))}月${v.to === today ? '至今' : ''}`
  return `${day(v.from)} – ${day(v.to, v.from.slice(0, 7) !== v.to.slice(0, 7))}`
}

const QUICK: [string, (t: string) => IncomeDateSelection][] = [
  ['昨天', t => range(addDays(t, -1), addDays(t, -1))],
  ['近 7 天', t => range(addDays(t, -6), t)],
  ['近 30 天', t => range(addDays(t, -29), t)],
  ['上月', t => { const m = addMonths(t.slice(0, 7), -1); return range(`${m}-01`, monthEnd(m)) }],
  ['本季度', t => { const m = Number(t.slice(5, 7)), q = String(m - (m - 1) % 3).padStart(2, '0'); return range(`${t.slice(0, 4)}-${q}-01`, t) }],
  ['今年', t => range(`${t.slice(0, 4)}-01-01`, t)],
]

export function IncomeDateFilter({ value, onChange, all = false, onAll, compact = false, isoLabel = false, label = '日期' }: { value: IncomeDateSelection; onChange: (value: IncomeDateSelection) => void; all?: boolean; onAll?: () => void; compact?: boolean; isoLabel?: boolean; label?: string }) {
  const today = businessDate(new Date())
  const displayDate = isoLabel && (value.mode !== 'dates' || value.dates.length < 2) ? incomeDateLabel(value) : incomeDateText(value, today)
  const [open, setOpen] = useState(false)
  const [multi, setMulti] = useState(false)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [dates, setDates] = useState<string[]>([])
  const [month, setMonth] = useState(value.from.slice(0, 7))
  function show(next: boolean) {
    if (next) { setMulti(value.mode === 'dates'); setDates(value.dates); setAnchor(null); setMonth((value.dates[0] ?? value.to).slice(0, 7)) }
    setOpen(next)
  }
  const apply = (v: IncomeDateSelection) => { onChange(v); setOpen(false) }
  // 区间：第一下定起点，第二下定终点并立即生效
  function pick(day: string) {
    if (multi) return setDates(old => old.includes(day) ? old.filter(x => x !== day) : [...old, day].sort())
    if (!anchor) return setAnchor(day)
    apply(anchor <= day ? range(anchor, day) : range(day, anchor))
  }
  const lo = anchor && hover ? (anchor < hover ? anchor : hover) : anchor ?? (all || value.mode === 'dates' ? null : value.from)
  const hi = anchor && hover ? (anchor < hover ? hover : anchor) : anchor ?? (all || value.mode === 'dates' ? null : value.to)
  const inRange = (d: string) => !multi && !!lo && !!hi && d >= lo && d <= hi
  const canStep = !all && value.mode !== 'dates'
  const stepNext = shiftIncomeDates(value, 1)
  const stepPeriod = (period: IncomeDateSelection) => {
    onChange(period)
    if (compact) { setMonth(period.to.slice(0, 7)); setAnchor(null); setHover(null) }
  }
  const previous = <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="往前一段" disabled={!canStep} onClick={() => stepPeriod(shiftIncomeDates(value, -1))}><CaretLeft size={14} /></Button>
  const next = <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="往后一段" disabled={!canStep || stepNext.from > today} onClick={() => stepPeriod(stepNext)}><CaretRight size={14} /></Button>
  return <div className={cn('flex min-w-0 items-center', !compact && 'flex-wrap gap-x-3 gap-y-2')}>
    {!compact && <>
      {onAll && <button type="button" aria-pressed={all} onClick={onAll} className={cn('h-8 rounded-md px-2.5 text-sm', all ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent')}>全部日期</button>}
      <Segmented label="常用范围" value={!all && (value.mode === 'today' || value.mode === 'week' || value.mode === 'month') ? value.mode : ('' as 'today')} onChange={mode => onChange(incomePreset(mode))} items={[['today', '今日'], ['week', '本周'], ['month', '本月']]} />
    </>}
    <div className="flex items-center">
      {!compact && previous}
      <Popover open={open} onOpenChange={show}>
        <PopoverTrigger asChild>
          {compact ? <Button type="button" variant="outline" size="sm" aria-label={`选择${label}`} title={`${label} · ${all ? '全部日期' : incomeDateLabel(value)}`} className={cn('h-8 max-w-[min(240px,calc(100vw-48px))] gap-1.5 px-2.5 text-sm font-normal', !all && 'border-primary/40 text-primary')}>
            <CalendarBlank size={15} className="shrink-0"/><span className="truncate">日期</span>
          </Button> : <button type="button" aria-label="选择日期" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium tabular-nums hover:bg-accent data-[state=open]:bg-accent">
            <CalendarBlank size={14} className="text-muted-foreground" />{all ? '自定义日期' : displayDate}
          </button>}
        </PopoverTrigger>
        <PopoverContent align="start" className="scroll-thin flex max-h-[85dvh] w-auto max-w-[calc(100vw-24px)] gap-0 overflow-y-auto p-0 max-sm:flex-col">
          <div className={cn('flex gap-1 border-b p-2 sm:w-28 sm:flex-col sm:border-b-0 sm:border-r', compact ? 'flex-wrap sm:flex-nowrap' : 'overflow-x-auto')}>
            {compact && <>
              {onAll && <button type="button" aria-pressed={all} onClick={() => { onAll(); setOpen(false) }} className={cn('shrink-0 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent', all && 'bg-primary/10 text-primary')}>全部日期</button>}
              {([['today', '今日'], ['week', '本周'], ['month', '本月']] as const).map(([mode, title]) => <button key={mode} type="button" aria-pressed={!all && value.mode === mode} onClick={() => apply(incomePreset(mode))} className={cn('shrink-0 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent', !all && value.mode === mode && 'bg-primary/10 text-primary')}>{title}</button>)}
            </>}
            {QUICK.map(([label, make]) => <button key={label} type="button" onClick={() => apply(make(today))} className="shrink-0 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent">{label}</button>)}
          </div>
          <div className="w-[280px] p-3">
            {compact && <div className="mb-2 flex items-center justify-between gap-1 border-b pb-2">{previous}<span className="min-w-0 text-center text-xs tabular-nums text-muted-foreground">{all ? '全部日期' : displayDate}</span>{next}</div>}
            <div onPointerLeave={() => setHover(null)}>
              <Calendar
                month={toDay(`${month}-01`)} onMonthChange={d => setMonth(fromDay(d).slice(0, 7))}
                endMonth={toDay(today)} disabled={{ after: toDay(today) }} today={toDay(today)}
                modifiers={{ edge: d => !multi && (fromDay(d) === lo || fromDay(d) === hi), within: d => inRange(fromDay(d)), on: d => multi && dates.includes(fromDay(d)) }}
                modifiersClassNames={{ within: '[&>button]:bg-primary/10', edge: '[&>button]:!bg-primary [&>button]:!text-primary-foreground', on: '[&>button]:!bg-primary [&>button]:!text-primary-foreground' }}
                onDayClick={(d, m) => { if (!m.disabled) pick(fromDay(d)) }}
                onDayMouseEnter={d => setHover(fromDay(d))}
                components={{
                  MonthCaption: ({ calendarMonth }) => {
                    const m = fromDay(calendarMonth.date).slice(0, 7)
                    return <div className="flex h-8 items-center justify-center"><button type="button" className="relative z-10 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent" title="选整月" onClick={() => apply(range(`${m}-01`, m === today.slice(0, 7) ? today : monthEnd(m)))}>{Number(m.slice(0, 4))}年{Number(m.slice(5))}月</button></div>
                  },
                }}
              />
            </div>
            <div className="mt-2 flex h-8 items-center justify-between border-t pt-2 text-xs text-muted-foreground">
              {multi
                ? <><span>已选 {dates.length} 天</span><span className="flex gap-1"><Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setMulti(false); setDates([]) }}>取消多选</Button><Button size="sm" className="h-7 px-2.5" disabled={!dates.length} onClick={() => apply({ mode: 'dates', from: dates[0], to: dates.at(-1)!, dates })}>确定</Button></span></>
                : <><span>{anchor ? '再点一下选结束日' : '点两下选范围'}</span><button type="button" className="hover:text-foreground" onClick={() => { setMulti(true); setAnchor(null) }}>挑几天</button></>}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {!compact && next}
    </div>
    {!compact && !all && value.mode === 'dates' && value.dates.length > 1 && <p className="break-words text-xs text-muted-foreground" aria-label="统计日期">{incomeDateLabel(value)}</p>}
  </div>
}
