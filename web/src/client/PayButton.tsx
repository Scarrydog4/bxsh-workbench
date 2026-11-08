import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, CircleNotch, Wallet } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { CustomerStage } from '@/shared/calc'
import { businessDate, money } from '@/shared/format'
import { loadIncome, useSession } from './store'
import { payOrderWithOutcome, type Kind, type OrderSettlementInput } from './store-p2'
import { OperationStatus, useOperationFeedback } from './operation-feedback'
import { SettlementNote } from './SettlementNote'
import { Avatar, inputCls, Pill } from './ui'

const STAGE: Record<CustomerStage, { label: string; tone: string }> = {
  none: { label: '未收款', tone: 'var(--muted-foreground)' },
  deposit: { label: '定金已到', tone: 'var(--gold)' },
  paidUp: { label: '已收齐', tone: 'var(--ok)' },
}

/** 客户收款灯：灰未收、金定金、绿收齐。 */
export function CustLight({ stage }: { stage?: CustomerStage }) {
  if (!stage) return null
  return <Pill tone={STAGE[stage].tone}>{STAGE[stage].label}</Pill>
}

/** 默认填建议额，没有建议就填剩余；金额老板自己定。 */
export const defaultPay = (r: { suggest?: number; left?: number }) => (r.suggest ?? 0) > 0 ? r.suggest! : r.left ?? 0

type PayInput = OrderSettlementInput & { kind: Kind }
// 没拿到结果的请求沿用原编号重试，避免重复记款。
const unfinished = new Map<string, PayInput>()

export function PayButton({ orderId, kind, payeeId, payeeName, left, suggest, onPaid, className }: {
  orderId: string; kind: Kind; payeeId: string; payeeName: string; left: number; suggest?: number; onPaid?: () => void; className?: string
}) {
  const { s } = useSession()
  const key = `${s.me.id}:${orderId}:${kind}:${payeeId}`
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(businessDate(new Date()))
  const [note, setNote] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const feedback = useOperationFeedback()
  const working = useRef(false)
  const reading = useRef(false)
  const [, setReading] = useState(false)
  const today = businessDate(new Date())
  const retry = unfinished.get(key)
  const n = Number(amount)
  const valid = Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-7 && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today

  function reset(next: boolean) {
    if (working.current || reading.current) return
    if (next) {
      feedback.reset()
      const saved = unfinished.get(key)
      setAmount(saved ? String(saved.amount) : String(defaultPay({ suggest, left }) || ''))
      setDate(saved?.date ?? today); setNote(saved?.note ?? ''); setShots(saved?.shots ?? [])
    }
    setOpen(next)
  }

  async function submit() {
    if (working.current || reading.current || (!retry && !valid)) return
    working.current = true
    setBusy(true)
    const input = retry ?? { kind, requestId: crypto.randomUUID(), orderId, payeeId, amount: n, date, note, shots }
    unfinished.set(key, input)
    try {
      const saved = await feedback.run(async report => {
        const outcome = await payOrderWithOutcome(input, { onConfirmed: () => feedback.confirm('结算已记录') })
        if (outcome.status === 'rejected') unfinished.delete(key)
        if (outcome.status !== 'success') {
          report({ status: outcome.status === 'rejected' ? 'error' : 'uncertain', message: outcome.status === 'rejected' ? '未能结算，请检查后重试；填写内容已保留' : '结果尚未确认，请重试这笔核对，勿重复记款' })
          return false
        }
        unfinished.delete(key)
        toast.success(`结算已记录：${payeeName} ${money(outcome.result.amount)}`)
        return true
      }, { saving: '正在记录结算', success: '结算已记录' })
      if (saved) {
        setOpen(false)
        if (s.income[payeeId]) void loadIncome(payeeId)
        onPaid?.()
      }
    } finally { working.current = false; setBusy(false) }
  }

  return <Popover open={open} onOpenChange={reset}>
    <PopoverTrigger asChild>
      <Button size="sm" variant="ghost" aria-label={`结算 ${payeeName}`} className={cn('h-8 gap-1.5 px-2 text-primary hover:bg-primary/10', className)} onClick={e => e.stopPropagation()}><Wallet size={15}/>结算</Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(320px,calc(100vw-24px))] space-y-3 p-4" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2 font-medium"><Avatar user={s.users.find(u => u.id === payeeId)} size={24}/>{payeeName}</span><span className="text-xs text-muted-foreground">待结 <span className="num">{money(left)}</span></span></div>
      <div className="flex gap-2">
        <label className="grid min-w-0 flex-1 gap-1.5 text-xs text-muted-foreground">本次结算
          <span className="relative"><span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">¥</span><input autoFocus aria-label={`${payeeName}的结算金额`} inputMode="decimal" value={amount} disabled={busy || !!retry} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') void submit() }} className={cn(inputCls, 'num h-9 pl-6 text-base text-foreground')}/></span></label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">结算日期<input aria-label="结算日期" type="date" max={today} value={date} disabled={busy || !!retry} onChange={e => setDate(e.target.value)} className={cn(inputCls, 'h-9 w-[136px] text-xs text-foreground')}/></label>
      </div>
      <SettlementNote note={note} shots={shots} onNote={setNote} onShots={setShots} onReading={v => { reading.current = v; setReading(v) }} disabled={busy || !!retry} label="结算备注" placeholder="备注 / 转账截图"/>
      <OperationStatus state={feedback.state}/>
      <Button className="w-full" aria-busy={busy} disabled={busy || reading.current || (!retry && !valid)} onClick={() => void submit()}>{feedback.state.status === 'success' ? <><Check size={16}/>结算已记录</> : busy ? <><CircleNotch size={16} className="animate-spin motion-reduce:animate-none"/>正在保存…</> : retry ? '重试这笔' : valid ? `确认结算 ${money(n)}` : '确认结算'}</Button>
    </PopoverContent>
  </Popover>
}
