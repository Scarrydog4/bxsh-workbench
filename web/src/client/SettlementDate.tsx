import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { businessDate } from '@/shared/format'
import { supplementSettlementDate } from './store-p2'
import { inputCls } from './ui'

export function SettlementDate({ id, disabled, onBusy }: { id: string; disabled?: boolean; onBusy: (busy: boolean) => void }) {
  const [editing, setEditing] = useState(false), [date, setDate] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  if (!editing) return <button type="button" className="text-xs text-primary hover:underline" disabled={disabled} onClick={() => setEditing(true)}>补记发放日期</button>
  return <form className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm" onSubmit={async e => {
    e.preventDefault()
    if (busy || disabled || !date || !reason.trim()) return
    setBusy(true); onBusy(true)
    try { if (await supplementSettlementDate(id, date, reason.trim())) { toast.success('发放日期已补记'); setEditing(false) } }
    finally { setBusy(false); onBusy(false) }
  }}>
    <label className="grid gap-1">实际发放日期<input type="date" required className={inputCls} value={date} max={businessDate(new Date())} disabled={busy || disabled} onChange={e => setDate(e.target.value)}/></label>
    <label className="grid gap-1">补记依据<input required className={inputCls} maxLength={500} placeholder="例如：已核对转账记录" value={reason} disabled={busy || disabled} onChange={e => setReason(e.target.value)}/></label>
    <p className="text-xs text-muted-foreground">请按转账记录填写，保存后计入对应日期的已结算金额。</p>
    <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>取消</Button><Button type="submit" size="sm" disabled={busy || disabled || !date || !reason.trim()}>{busy ? '保存中…' : '保存日期'}</Button></div>
  </form>
}
