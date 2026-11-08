import { businessDate } from '@/shared/format'
import type { IncomeReportGranularity } from '@/shared/income-report'
import type { IncomeDateSelection } from './IncomeDateFilter'

const amount = new Intl.NumberFormat('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2})
export const incomeMoney = (value:number) => '¥'+amount.format(value)
export const incomeAxisMoney = (value:number) => value.toLocaleString('zh-CN',{maximumFractionDigits:0})
const labels = {day:'按日',week:'按周',month:'按月'} as const

export function incomeGrains(range:IncomeDateSelection, preferred:IncomeReportGranularity) {
  const span = (Date.parse(range.to)-Date.parse(range.from))/86_400_000 + 1
  const hourly = range.mode !== 'week' && range.mode !== 'month' && (range.mode==='dates' ? range.dates.length===1 : span===1)
  const allowed:IncomeReportGranularity[] = hourly || range.mode==='week' ? ['day']
    : range.mode==='month' || span<=31 ? ['day','week'] : ['day','week','month']
  const value = allowed.includes(preferred) ? preferred : 'day'
  return {hourly, value, items: allowed.map(grain=>[grain,labels[grain]] as const)}
}

// Natural-week keys remain stable for lookup; labels and drilldowns use the actual selected days.
export function visiblePeriod(range:{from:string;to:string;dates?:string[]|null}, bucket:{start:string;end:string}, today=businessDate(new Date())) {
  const from = [range.from,bucket.start].sort()[1], to = [range.to,bucket.end,today].sort()[0]
  if (from>to) return null
  const days = range.dates?.length ? range.dates.filter(day=>day>=from && day<=to).sort() : null
  if (days && !days.length) return null
  const start = days?.[0] ?? from, end = days?.at(-1) ?? to
  const label = days ? days.join('、') : start===end ? start : start+' — '+end
  const short = days ? days.map(day=>day.slice(5)).join('、') : start===end ? start.slice(5) : start.slice(5)+' — '+end.slice(5)
  return {start,end,label,short}
}

export function incomeRangeCaption(selection:IncomeDateSelection, grain:IncomeReportGranularity) {
  const dates = selection.mode==='dates' ? selection.dates.join('、') : selection.from+' — '+selection.to
  return dates+' · '+labels[grain]+'汇总'
}
