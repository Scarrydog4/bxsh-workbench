import { cn } from '@/lib/utils'
import { inputCls } from './ui'
import { cents } from '@/shared/calc'

export type IntakePaymentTag = '定金' | '全款'

export function validPaidAmount(value: string) {
  return value.trim() === '' || (/^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) <= 10_000_000)
}

export function IntakePayment({ id, amount, tag, total, onChange, invalid = false, label = '已付金额', stacked = false, quickPercentages = false }: {
  id: string; amount: string; tag: IntakePaymentTag; total: number | null
  onChange: (amount: string, tag: IntakePaymentTag) => void; invalid?: boolean; label?: string; stacked?: boolean; quickPercentages?: boolean
}) {
  const hasTotal = total !== null && Number.isFinite(total) && total >= 0
  return <div className={cn(stacked ? 'grid gap-1.5' : 'flex flex-wrap items-center gap-2')}>
    <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
    <div className={cn('relative', stacked ? 'w-full' : 'w-36')}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">¥</span>
      <input id={id} aria-label={label} aria-invalid={invalid || undefined} inputMode="decimal" autoComplete="off" value={amount} placeholder="未收款" className={cn(inputCls, 'num pl-7 text-right', !stacked && 'h-9', invalid && 'border-danger')} onChange={e => onChange(e.target.value, tag)} />
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
    <div className="flex w-fit max-w-full rounded-md border p-0.5" role="group" aria-label={`${label}类型`}>
      {(['定金', '全款'] as const).map(value => <button key={value} type="button" aria-pressed={tag === value} className={cn('rounded py-1 text-sm transition-colors', stacked ? 'px-2' : 'px-3', tag === value ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent')} onClick={() => onChange(value === '全款' && total !== null && Number.isFinite(total) && total >= 0 ? String(total) : amount, value)}>{value}</button>)}
    </div>
    {quickPercentages && <div className="flex gap-1" role="group" aria-label="定金快捷金额">{[30, 50].map(percent => <button key={percent} type="button" disabled={!hasTotal || total === 0} className="num rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground transition-colors enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40" onClick={() => { if (hasTotal && total > 0) onChange(String(Math.round(cents(total) * percent / 100) / 100), '定金') }}>{percent}%</button>)}</div>}
    </div>
    {invalid && <span className="text-xs text-danger">请填写有效金额，最多两位小数</span>}
  </div>
}
