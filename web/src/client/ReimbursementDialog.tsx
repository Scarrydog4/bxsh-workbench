import { SelectField } from './SelectField'
import { useEffect, useRef, useState } from 'react'
import { CaretDown, MagnifyingGlass, Receipt } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader, useAppDialogDismiss } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { businessDate, money } from '@/shared/format'
import { REIMBURSEMENT_CATEGORIES, REIMBURSEMENT_STATUSES, type Reimbursement, type ReimbursementCategory, type ReimbursementList } from '@/shared/reimbursement'
import { useSession } from './store'
import { useNav } from './nav'
import { Combobox, Field, inputCls, Person, Pill, SkeletonRows } from './ui'
import { SettlementNote, SettlementNoteView } from './SettlementNote'
import { fetchReimbursements, sendReimbursement, type ReimbursementAction, type ReimbursementRequest, type SubmissionRequest } from './reimbursement-client'

const currentDay = () => businessDate(new Date())
const blank = () => ({ category: '图纸' as ReimbursementCategory, amount: '', expenseDate: currentDay(), orderId: '', note: '', proofs: [] as string[] })
type Draft = ReturnType<typeof blank>
type Pending = { action: ReimbursementAction; input: ReimbursementRequest; no: string; amount: number }
const tone = (status: string) => status === '已报销' ? 'var(--ok)' : status === '待处理' ? 'var(--warn)' : status === '已退回' ? 'var(--danger)' : 'var(--muted-foreground)'
export function validReimbursementDate(date: string) {
  const n = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === date && date <= currentDay()
}
export function validReimbursementDraft(draft: Draft) {
  return /^\d+(?:\.\d{1,2})?$/.test(draft.amount) && Number(draft.amount) > 0 && Number(draft.amount) <= 1_000_000 && validReimbursementDate(draft.expenseDate) && draft.proofs.length > 0 && draft.proofs.length <= 9
}

function ProofNote({ note, proofs, onNote, onProofs, onReading, disabled, required = false, label }: { note: string; proofs: string[]; onNote: (value: string) => void; onProofs: (value: string[]) => void; onReading: (value: boolean) => void; disabled?: boolean; required?: boolean; label: string }) {
  return <div className="space-y-1.5">
    <div className="text-xs font-medium text-muted-foreground">{label}{required && <span className="ml-1 text-danger">*</span>}</div>
    <SettlementNote note={note} shots={proofs} onNote={onNote} onShots={onProofs} onReading={onReading} disabled={disabled} label={label} placeholder="备注（可选）"/>
  </div>
}

export function ReimbursementDialog({ open, onOpenChange, initialId, requestKey }: { open: boolean; onOpenChange: (open: boolean) => void; initialId?: string; requestKey?: number }) {
  const { s, me, role, views, user, channel } = useSession()
  const { openOrder } = useNav()
  const manage = role.locked
  const [applyOpen, setApplyOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(blank)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [pendingSubmit, setPendingSubmit] = useState<SubmissionRequest | null>(null)
  const [reading, setReading] = useState(false), [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(''), [applicant, setApplicant] = useState(''), [query, setQuery] = useState('')
  const [focusId, setFocusId] = useState<string | null>(initialId ?? null), [expanded, setExpanded] = useState<string | null>(initialId ?? null)
  const [list, setList] = useState<ReimbursementList | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [review, setReview] = useState<{ id: string; version: number; amount: number; action: 'confirm' | 'reject' | 'undo'; date: string; note: string; proofs: string[] } | null>(null)
  const [reviewReading, setReviewReading] = useState(false), [pendingAction, setPendingAction] = useState<Pending | null>(null)
  const [revision, setRevision] = useState(0)
  const working = useRef(false), readRequest = useRef(0), readingRef = useRef(false), reviewReadingRef = useRef(false)
  const onReading = (value: boolean) => { readingRef.current = value; setReading(value) }
  const onReviewReading = (value: boolean) => { reviewReadingRef.current = value; setReviewReading(value) }
  const dirty = !!(draft.amount || draft.note || draft.proofs.length || draft.orderId || draft.category !== '图纸' || draft.expenseDate !== currentDay())
  const locked = busy || !!pendingSubmit
  const valid = validReimbursementDraft(draft)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(old => ({ ...old, [key]: value }))

  useEffect(() => {
    if (!open) return
    setApplyOpen(false)
    setFocusId(initialId ?? null); setExpanded(initialId ?? null)
    if (!initialId && manage) { setApplicant(''); setStatus(''); setQuery('') }
  }, [open, initialId, requestKey, manage])

  async function load(offset = 0, targetId = focusId) {
    const request = ++readRequest.current
    setLoading(true); setError('')
    try {
      const result = await fetchReimbursements(targetId ? { id: targetId } : { status, applicant: manage ? applicant : undefined, q: query.trim(), offset })
      if (request !== readRequest.current) return
      setList(old => offset && old ? { ...result, rows: [...new Map([...old.rows, ...result.rows].map(r => [r.id, r])).values()] } : result)
    } catch (e) { if (request === readRequest.current) setError((e as Error).message) }
    finally { if (request === readRequest.current) setLoading(false) }
  }
  useEffect(() => {
    if (!open) return
    setList(null)
    const timer = setTimeout(() => void load(), query ? 200 : 0)
    return () => { clearTimeout(timer); readRequest.current++ }
  }, [open, focusId, status, applicant, query, revision, s.version, me.id])

  async function submit() {
    if (working.current || readingRef.current) return
    if (!pendingSubmit && !valid) return toast.error('请填写有效金额、付款日期并附付款账单')
    const input = pendingSubmit ?? { requestId: crypto.randomUUID(), ...(editingId ? { id: editingId, expectedVersion: editingVersion! } : {}), category: draft.category, amount: Number(draft.amount), expenseDate: draft.expenseDate, note: draft.note.trim(), proofs: draft.proofs, orderId: draft.orderId || null }
    working.current = true; setBusy(true); setPendingSubmit(input)
    try {
      const outcome = await sendReimbursement('submit', input)
      if (outcome.status === 'rejected') { setPendingSubmit(null); return }
      if (outcome.status !== 'success') return
      setPendingSubmit(null); setDraft(blank()); setEditingId(null); setEditingVersion(null)
      setFocusId(outcome.id); setExpanded(outcome.id); setApplyOpen(false); setRevision(n => n + 1)
      toast.success('报销申请已提交')
    } finally { working.current = false; setBusy(false) }
  }
  async function perform(action: ReimbursementAction, id: string) {
    if (working.current || reviewReadingRef.current) return
    if (pendingAction && (pendingAction.action !== action || pendingAction.input.id !== id)) return toast.error('请先重试上一笔操作')
    if (!pendingAction && action === 'confirm' && (!review || !validReimbursementDate(review.date))) return toast.error('请选择不晚于今天的有效日期')
    if (!pendingAction && (action === 'reject' || action === 'undo') && !review?.note.trim()) return toast.error('请填写原因')
    const input = pendingAction?.input ?? { requestId: crypto.randomUUID(), id, expectedVersion: action === 'withdraw' ? list!.rows.find(row => row.id === id)!.version : review!.version, ...(action === 'confirm' ? { paidDate: review!.date, note: review!.note.trim(), proofs: review!.proofs } : action === 'reject' || action === 'undo' ? { reason: review!.note.trim() } : {}) }
    const row = list?.rows.find(row => row.id === id)
    working.current = true; setBusy(true); setPendingAction(pendingAction ?? { action, input, no: row?.no ?? id, amount: action === 'withdraw' ? row!.amount : review!.amount })
    try {
      const outcome = await sendReimbursement(action, input)
      if (outcome.status === 'rejected') { setPendingAction(null); setRevision(n => n + 1); return }
      if (outcome.status !== 'success') return
      setPendingAction(null); setReview(null); setRevision(n => n + 1)
      toast.success(action === 'confirm' ? '已报销' : action === 'withdraw' ? '已撤回' : action === 'reject' ? '已退回' : '已撤销报销')
    } finally { working.current = false; setBusy(false) }
  }
  function edit(row: Reimbursement) {
    if (busy || pendingSubmit || pendingAction) return
    setDraft({ category: row.category, amount: String(row.amount), expenseDate: row.expenseDate, orderId: row.orderId ?? '', note: row.note, proofs: row.proofs })
    setEditingId(row.id); setEditingVersion(row.version); setApplyOpen(true)
  }
  function startReview(id: string, action: 'confirm' | 'reject' | 'undo') {
    if (pendingAction || busy || reviewReading) return
    const row = list?.rows.find(row => row.id === id)
    if (!row) return
    setReview(old => old?.id === id && old.action === action && old.version === row.version ? old : { id, version: row.version, amount: row.amount, action, date: currentDay(), note: '', proofs: [] })
  }
  const orderOptions = [{ value: '', label: '不关联订单' }, ...views.map(v => ({ value: v.id, label: v.title, hint: channel(v.channelId)?.name }))]
  const showOrder = (id: string) => { if (views.some(v => v.id === id)) { onOpenChange(false); openOrder(id) } }
  const resetDraft = () => { setDraft(blank()); setEditingId(null); setEditingVersion(null) }
  const closeApply = (value: boolean) => { setApplyOpen(value); if (!value) resetDraft() }
  const applyDismiss = useAppDialogDismiss({ dirty, blocked: locked || reading, onOpenChange: value => {
    if (!working.current && !readingRef.current) closeApply(value)
  } })
  const recordsDismiss = useAppDialogDismiss({
    dirty: !!(review?.note || review?.proofs.length), blocked: busy || !!pendingAction || !!pendingSubmit || reading || reviewReading,
    onOpenChange: value => { if (!working.current && !readingRef.current && !reviewReadingRef.current) { if (!value) { setApplyOpen(false); setReview(null) }; onOpenChange(value) } },
  })
  return <>
  <Dialog open={open} onOpenChange={recordsDismiss.requestOpenChange}>
    <AppDialogContent size="lg" data-reimbursement-dialog>
      <AppDialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base"><Receipt size={18} className="text-primary"/>{manage ? '报销记录' : '我的报销'}</DialogTitle>
        <DialogDescription className="sr-only">查看申请与报销进度，使用底部按钮申请报销</DialogDescription>
      </AppDialogHeader>
      <AppDialogBody className="scroll-thin">
        <div className="space-y-3 border-b px-5 py-3">
          {manage && <div className="flex items-center gap-2"><button className={cn('rounded-md border px-3 py-1 text-xs', !applicant && 'border-primary text-primary')} onClick={() => { setFocusId(null); setApplicant('') }}>全部</button><button className={cn('rounded-md border px-3 py-1 text-xs', applicant === me.id && 'border-primary text-primary')} onClick={() => { setFocusId(null); setApplicant(me.id) }}>我的</button><SelectField aria-label="筛选申请人" value={applicant} onChange={e => { setFocusId(null); setApplicant(e.target.value) }} className={cn(inputCls, 'ml-auto h-8 w-36 text-xs')}><option value="">所有申请人</option>{s.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</SelectField></div>}
          {focusId ? <button className="text-xs text-primary" onClick={() => setFocusId(null)}>查看全部记录</button> : <div className="flex gap-2"><div className="relative min-w-0 flex-1"><MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted-foreground"/><input aria-label="搜索报销记录" value={query} onChange={e => setQuery(e.target.value)} className={cn(inputCls, 'h-8 pl-8 text-xs')} placeholder="搜索用途、备注、编号"/></div><SelectField aria-label="筛选报销状态" value={status} onChange={e => setStatus(e.target.value)} className={cn(inputCls, 'h-8 w-28 text-xs')}><option value="">全部状态</option>{REIMBURSEMENT_STATUSES.map(x => <option key={x}>{x}</option>)}</SelectField></div>}
          {list && <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>待处理 <strong className="font-medium text-foreground">{money(list.summary.pendingAmount)}</strong> · {list.summary.pendingCount} 笔</span><span>已报销 <strong className="font-medium text-primary">{money(list.summary.paidAmount)}</strong> · {list.summary.paidCount} 笔</span></div>}
        </div>
        {error && <div role="alert" className="flex items-center justify-between p-5 text-sm text-danger">{error}<button className="text-primary" onClick={() => void load()}>重新加载</button></div>}
        {!error && !list && <SkeletonRows rows={4}/>}
        {list && <div className="divide-y">{list.rows.map(row => <section key={row.id}>
          <button className={cn('flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/40', expanded === row.id && 'bg-primary/[0.03]')} aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sm"><Person user={user(row.applicantId)} size={22}/><span>{row.category}</span></div><div className="mt-1 truncate text-xs text-muted-foreground">{row.expenseDate} · {row.note}</div></div><strong className="num shrink-0 text-sm">{money(row.amount)}</strong><Pill tone={tone(row.status)}>{row.status}</Pill><CaretDown size={13} className={cn('shrink-0 text-muted-foreground transition-transform', expanded === row.id && 'rotate-180')}/>
          </button>
          {expanded === row.id && <div className="space-y-4 border-t border-dashed px-5 py-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{row.no}</span>{row.orderId && <button className="max-w-full truncate text-primary" disabled={!views.some(v => v.id === row.orderId)} onClick={() => showOrder(row.orderId!)}>{views.find(v => v.id === row.orderId)?.title ?? '关联订单不在当前查看范围'}</button>}</div>
            <SettlementNoteView note={row.note} shots={row.proofs} label="付款账单"/>
            {!!row.reason && <p className="border-l-2 border-warn pl-3 text-sm">{row.reason}</p>}
            {row.status === '已报销' && <section className="space-y-2 border-t pt-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{row.paidDate} 已报销</span><Person user={user(row.paidBy ?? '')} size={18}/></div><SettlementNoteView note={row.paymentNote} shots={row.paymentProofs} label="报销截图"/></section>}
            <div className="flex flex-wrap gap-2">
              {manage && row.status === '待处理' && <><Button size="sm" disabled={busy || !!pendingAction || reviewReading} onClick={() => startReview(row.id, 'confirm')}>确认已报销</Button><Button size="sm" variant="outline" disabled={busy || !!pendingAction || reviewReading} onClick={() => startReview(row.id, 'reject')}>退回</Button></>}
              {manage && row.status === '已报销' && <Button size="sm" variant="outline" disabled={busy || !!pendingAction || reviewReading} onClick={() => startReview(row.id, 'undo')}>撤销报销</Button>}
              {row.applicantId === me.id && row.status === '待处理' && <Button size="sm" variant="outline" disabled={busy || !!pendingAction} onClick={() => void perform('withdraw', row.id)}>撤回申请</Button>}
              {row.applicantId === me.id && ['已退回', '已撤回'].includes(row.status) && <Button size="sm" disabled={busy || !!pendingSubmit || !!pendingAction} onClick={() => edit(row)}>修改后重提</Button>}
            </div>
            {review?.id === row.id && <div className="space-y-3 border-t pt-3">
              {review.action === 'confirm' ? <><div className="flex items-center justify-between"><strong className="text-sm">本次报销 {money(review.amount)}</strong><label className="flex items-center gap-2 text-xs text-muted-foreground">报销日期<input type="date" aria-label="报销日期" value={review.date} max={currentDay()} disabled={busy || !!pendingAction} className={cn(inputCls, 'w-36')} onChange={e => setReview({ ...review, date: e.target.value })}/></label></div><ProofNote label="报销备注 / 转账截图（可选）" note={review.note} proofs={review.proofs} onNote={note => setReview({ ...review, note })} onProofs={proofs => setReview({ ...review, proofs })} onReading={onReviewReading} disabled={busy || !!pendingAction || reviewReading}/></> : <textarea aria-label={review.action === 'reject' ? '退回原因' : '撤销报销原因'} maxLength={2000} rows={2} className={cn(inputCls, 'h-auto py-2')} value={review.note} disabled={busy || !!pendingAction} onChange={e => setReview({ ...review, note: e.target.value })} placeholder={review.action === 'reject' ? '填写退回原因' : '填写撤销原因'}/>}
              {!pendingAction && <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy || reviewReading} onClick={() => setReview(null)}>取消</Button><Button size="sm" disabled={busy || reviewReading || (review.action === 'confirm' ? !validReimbursementDate(review.date) : !review.note.trim())} onClick={() => void perform(review.action, row.id)}>{busy ? '处理中…' : review.action === 'confirm' ? '确认报销' : review.action === 'reject' ? '确认退回' : '确认撤销'}</Button></div>}
            </div>}
            {!!row.history.length && <details className="border-t pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">记录 · {row.history.length} 条</summary><div className="mt-2 space-y-3">{row.history.map(event => <div key={event.id} className="space-y-1 border-l pl-3 text-xs"><div className="flex flex-wrap items-center gap-2"><span>{businessDate(event.at)}</span><Person user={user(event.by)} size={16}/><strong className="font-medium">{event.action}</strong></div>{event.submission && <p className="text-muted-foreground">{event.submission.category} · {money(event.submission.amount)} · 付款 {event.submission.expenseDate}</p>}<SettlementNoteView note={event.submission?.note ?? event.note} shots={event.submission?.proofs ?? event.proofs} label={event.submission ? '付款账单' : '报销截图'}/></div>)}</div></details>}
          </div>}
        </section>)}{!list.rows.length && <p className="p-8 text-center text-sm text-muted-foreground">暂无报销记录</p>}</div>}
        {list?.next !== null && list?.next !== undefined && <div className="border-t p-3 text-center"><Button size="sm" variant="ghost" disabled={loading} onClick={() => void load(list.next!)}>{loading ? '加载中…' : '加载更多'}</Button></div>}
      </AppDialogBody>
      {pendingAction && <div role="status" className="flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3"><div className="min-w-0 text-xs"><p className="truncate font-medium">{pendingAction.no} · {money(pendingAction.amount)}</p><p className="mt-1 text-muted-foreground">{pendingAction.action === 'confirm' ? '报销' : pendingAction.action === 'withdraw' ? '撤回' : pendingAction.action === 'reject' ? '退回' : '撤销报销'}尚未收到确认</p></div><Button size="sm" disabled={busy} onClick={() => void perform(pendingAction.action, pendingAction.input.id!)}>{busy ? '正在处理…' : '重试本次操作'}</Button></div>}
      <AppDialogFooter>
        <span className="text-xs text-muted-foreground">{list ? `${list.total} 条记录` : '正在读取记录…'}</span>
        <Button size="sm" disabled={busy || !!pendingAction || reviewReading} onClick={() => setApplyOpen(true)}>申请报销</Button>
      </AppDialogFooter>
    </AppDialogContent>
  </Dialog>
  <Dialog open={open && applyOpen} onOpenChange={applyDismiss.requestOpenChange}>
    <AppDialogContent size="md" data-reimbursement-application onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit() }
    }}>
      <AppDialogHeader>
        <DialogTitle className="text-base">{editingId ? '修改报销申请' : '申请报销'}</DialogTitle>
        <DialogDescription className="mt-1">填写实际支出，附上付款账单后提交。</DialogDescription>
      </AppDialogHeader>
      <AppDialogBody className="scroll-thin px-5 py-4">
        <fieldset disabled={locked || reading} className="grid grid-cols-2 gap-x-3 gap-y-4">
          <Field label="用途" required className="col-span-2"><div className="flex gap-2">{REIMBURSEMENT_CATEGORIES.map(category => <button key={category} type="button" aria-pressed={draft.category === category} onClick={() => set('category', category)} className={cn('flex-1 rounded-md border px-3 py-2 text-sm transition-colors', draft.category === category ? 'border-primary bg-primary/5 text-primary' : 'hover:border-primary')}>{category}</button>)}</div></Field>
          <Field label="报销金额" required htmlFor="reim-amount"><div className="relative"><span className="absolute left-3 top-2 text-sm text-muted-foreground">¥</span><input id="reim-amount" aria-label="报销金额" inputMode="decimal" autoComplete="off" value={draft.amount} placeholder="0.00" onChange={e => set('amount', e.target.value)} className={cn(inputCls, 'num pl-7')}/></div></Field>
          <Field label="付款日期" required htmlFor="reim-date"><input id="reim-date" aria-label="付款日期" type="date" max={currentDay()} value={draft.expenseDate} onChange={e => set('expenseDate', e.target.value)} className={inputCls}/></Field>
          <Field label="关联订单（可选）" htmlFor="reim-order" className="col-span-2"><Combobox id="reim-order" value={draft.orderId} options={orderOptions} onChange={id => set('orderId', id)} placeholder="搜索订单号或名称"/></Field>
          <div className="col-span-2"><ProofNote label="付款账单 / 备注" required note={draft.note} proofs={draft.proofs} onNote={v => set('note', v)} onProofs={v => set('proofs', v)} onReading={onReading} disabled={locked || reading}/></div>
        </fieldset>
      </AppDialogBody>
      <AppDialogFooter>
        <span className="text-xs text-muted-foreground">{reading ? '正在读取图片…' : pendingSubmit ? '未收到确认，重试不会重复提交' : `${draft.proofs.length} 张付款账单`}</span>
        <Button size="sm" disabled={busy || reading || !pendingSubmit && !valid} onClick={() => void submit()}>{busy ? '提交中…' : pendingSubmit ? '重试本次申请' : editingId ? '重新提交' : '提交申请'}<span className="ml-2 hidden text-xs opacity-70 sm:inline">⌘↵</span></Button>
      </AppDialogFooter>
    </AppDialogContent>
  </Dialog>
  {recordsDismiss.confirmation}
  {applyDismiss.confirmation}
  </>
}
