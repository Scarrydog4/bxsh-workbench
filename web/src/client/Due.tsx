import { daysUntil, shortDate } from '@/shared/format'
import { isInitialDeliveryPending } from '@/shared/order-deadline'
import { cn } from '@/lib/utils'

const dayMs = 86_400_000
/** 表格里的截止：逾期红、今天橙，其余灰。传了下单日期就在下面画一根随时间变短的条，逾期时条空掉、底色泛红。 */
export function Due({ date, status, start }: { date: string | null; status: string; start?: string }) {
  const d = daysUntil(date)
  if (d === null) return <span className="text-muted-foreground">—</span>
  const open = isInitialDeliveryPending({ status })
  const late = open && d < 0
  const today = open && d === 0
  const span = start && date ? Math.round((Date.parse(date) - Date.parse(start)) / dayMs) : 0
  const left = late ? 0 : span > 0 ? Math.min(1, Math.max(0.04, d / span)) : 1
  return (
    <span className="relative inline-flex" title={date ?? ''}>
      <span className={cn('num whitespace-nowrap', late ? 'font-medium text-danger' : today ? 'font-medium text-warn' : 'text-muted-foreground')}>
        {late ? `逾期 ${-d} 天` : today ? '今天' : open && d === 1 ? '明天' : shortDate(date)}
      </span>
      {open && start && (
        <span aria-hidden className={cn('absolute left-0 top-full mt-[3px] h-[3px] w-14 overflow-hidden rounded-full', late ? 'bg-danger/25' : 'bg-muted')}>
          <span className={cn('block h-full rounded-full transition-[width] duration-200', today ? 'bg-warn' : 'bg-foreground/30')} style={{ width: `${left * 100}%` }} />
        </span>
      )}
    </span>
  )
}
