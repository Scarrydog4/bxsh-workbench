import { useEffect, useState } from 'react'
import { ArrowCounterClockwise, CaretDown, Plus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { money, businessDate } from '@/shared/format'
import type { OrderView } from '@/shared/types'
import { FinancialNote, FinancialNoteView } from './FinancialNote'
import { addOrderCost, revokeOrderCost, useSession } from './store'
import { inputCls, Combobox } from './ui'

export function OrderCosts({ v }: { v: OrderView }) {
  const { role } = useSession()
  const [open, setOpen] = useState(false), [form, setForm] = useState(false)
  if (!v.extraCosts) return null
  return <section className="min-w-0">
    <div className="flex min-h-8 items-center justify-between gap-2">
      <button type="button" className="flex min-h-8 min-w-0 items-center gap-2 rounded-md text-left hover:text-primary" aria-label="额外成本明细" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="num font-medium">{money(v.extraCostTotal ?? 0)}</span><CaretDown size={12} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}/>
      </button>
      {role.locked && <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => { setOpen(true); setForm(!form) }}><Plus size={13}/>记成本</Button>}
    </div>
    {open && <div className="mt-1 space-y-3 border-t pt-3">
      {(v.extraCostTotal ?? 0) > 0 && <p className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>扣成本后分成基数</span><span className="num text-foreground">{money(v.sales ?? 0)} − {money(v.extraCostTotal ?? 0)} = {money((v.sales ?? 0) - (v.extraCostTotal ?? 0))}{(v.extraCostTotal ?? 0) > (v.sales ?? 0) && '（分成基数按 0）'}</span></p>}
      {form && <CostForm key={v.id} id={v.id} onClose={() => setForm(false)}/>}
      {v.extraCosts.length === 0 && !form && <p className="py-1 text-xs text-muted-foreground">暂无额外成本</p>}
      {[...v.extraCosts].reverse().map(line => <article key={line.id} className={cn('group border-t pt-2 first:border-0 first:pt-0', line.revoked && 'text-muted-foreground')}>
        <div className="flex items-center gap-2 text-sm"><span className={cn('min-w-0 flex-1 break-words', line.revoked && 'line-through')}>{line.name}{line.contractor && <span className="ml-2 text-xs text-muted-foreground">{line.contractor}</span>}</span><span className={cn('num shrink-0 font-medium', line.revoked && 'line-through')}>{money(line.amount)}</span>{role.locked && !line.revoked && <CostRevoke id={v.id} costId={line.id}/>}</div>
        <p className="mt-1 text-xs text-muted-foreground">{line.date}{line.revoked && <span className="ml-2">已撤销 · {line.revoked.reason}</span>}</p>
        <FinancialNoteView note={line.note} proof={line.proof}/>
      </article>)}
    </div>}
  </section>
}

function CostForm({ id, onClose }: { id: string; onClose: () => void }) {
  const [name, setName] = useState('实物外包'), [contractor, setContractor] = useState(''), [amount, setAmount] = useState(''), [date, setDate] = useState(businessDate(new Date()))
  const [note, setNote] = useState(''), [proof, setProof] = useState<string>(), [reading, setReading] = useState(false), [busy, setBusy] = useState(false)
  const [partners,setPartners] = useState<{id:string;name:string;active:boolean}[]>([]), [contractorId,setContractorId] = useState('')
  useEffect(()=>{ void fetch('/api/contractors').then(r=>r.ok?r.json():null).then(d=>{if(d)setPartners(d.rows.filter((p:{active:boolean})=>p.active))}).catch(()=>{}) },[])
  const [requestId] = useState(() => crypto.randomUUID())
  return <form className="grid gap-3 rounded-md bg-muted/30 p-3" onSubmit={async e => {
    e.preventDefault()
    if (busy || reading) return
    const value = Number(amount)
    if (!name.trim() || !Number.isFinite(value) || value <= 0 || !date) return toast.error('请填写项目、金额和日期')
    setBusy(true)
    try { if (await addOrderCost(id, { requestId, name, contractor, contractorId: contractorId || undefined, amount: value, date, note, proof })) { toast.success('成本已登记'); onClose() } }
    finally { setBusy(false) }
  }}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs text-muted-foreground">成本项目<input aria-label="成本项目" autoFocus maxLength={100} required value={name} onChange={e => setName(e.target.value)} className={inputCls} disabled={busy}/></label>
      <label className="grid gap-1 text-xs text-muted-foreground">外包方<Combobox value={contractorId} onChange={id=>{setContractorId(id);setContractor(partners.find(p=>p.id===id)?.name??'')}} options={[{value:'',label:'手动填写'},...partners.map(p=>({value:p.id,label:p.name}))]}/>{!contractorId&&<input aria-label="外包方" placeholder="工作室或姓名（可空）" maxLength={100} value={contractor} onChange={e => setContractor(e.target.value)} className={inputCls} disabled={busy}/>}</label>
      <label className="grid gap-1 text-xs text-muted-foreground">成本金额<div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2">¥</span><input aria-label="成本金额" inputMode="decimal" type="number" min="0.01" max="10000000" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} className={cn(inputCls, 'pl-7 num')} disabled={busy}/></div></label>
      <label className="grid gap-1 text-xs text-muted-foreground">成本日期<input aria-label="成本日期" type="date" required value={date} onChange={e => setDate(e.target.value)} className={cn(inputCls, 'min-w-0')} disabled={busy}/></label>
    </div>
    <FinancialNote note={note} proof={proof} onNote={setNote} onProof={setProof} onReading={setReading} disabled={busy}/>
    <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button size="sm" disabled={busy || reading}>{busy ? '保存中…' : '保存成本'}</Button></div>
  </form>
}

function CostRevoke({ id, costId }: { id: string; costId: string }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  return <Popover open={open} onOpenChange={value => { if (!busy) setOpen(value) }}><PopoverTrigger asChild><button type="button" title="撤销成本" aria-label="撤销成本" className="grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-accent hover:text-danger"><ArrowCounterClockwise size={14}/></button></PopoverTrigger><PopoverContent align="end" className="w-[min(280px,calc(100vw-32px))] p-3"><form className="grid gap-2" onSubmit={async e => {
    e.preventDefault(); if (busy || !reason.trim()) return
    setBusy(true)
    try { if (await revokeOrderCost(id, costId, reason)) { toast.success('成本已撤销'); setOpen(false) } }
    finally { setBusy(false) }
  }}><p className="text-sm font-medium">撤销成本</p><input autoFocus aria-label="撤销成本原因" placeholder="撤销原因" required maxLength={500} className={inputCls} value={reason} onChange={e => setReason(e.target.value)} disabled={busy}/><Button size="sm" variant="destructive" disabled={busy || !reason.trim()}>{busy ? '撤销中…' : '确认撤销'}</Button></form></PopoverContent></Popover>
}
