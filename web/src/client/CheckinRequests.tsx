'use client'

import { fuzzyMatch } from '@/shared/search'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, CaretLeft, CaretRight, Check, MagnifyingGlass, Plus, SpinnerGap, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { businessDate } from '@/shared/format'
import { CHECKIN_REQUEST_KINDS, CHECKIN_REQUEST_LABELS, CHECKIN_REQUEST_STATUS_LABELS } from '@/shared/checkin-requests'
import type { CheckinRequestKind, CheckinRequestList, CheckinRequestRecord, CheckinRequestResult } from '@/shared/checkin-requests'
import { Segmented } from './controls'
import { useSession } from './store'
import { DataTable, type Col } from './table-kit'
import { Avatar, inputCls } from './ui'

type View = 'pending' | 'team' | 'mine'
type Draft = { kind: CheckinRequestKind; start: string; end: string; reason: string }
const dateTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
const hour = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
const monthLabel = (value: string) => `${value.slice(0, 4)}年${Number(value.slice(5))}月`

function shiftMonth(value: string, step: number) {
  const [year, month] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 7)
}
function initialDraft(kind: CheckinRequestKind = 'late'): Draft {
  const [start, end] = kind === 'early' ? ['19:30', '20:00'] : kind === 'overtime' ? ['20:00', '21:00'] : kind === 'leave' || kind === 'weekend' ? ['10:00', '20:00'] : ['10:00', '10:30']
  const now = new Date(), date = new Date(`${businessDate(now)}T00:00:00Z`)
  while ((kind === 'weekend' ? ![0, 6].includes(date.getUTCDay()) : kind !== 'overtime' && [0, 6].includes(date.getUTCDay())) || new Date(`${date.toISOString().slice(0, 10)}T${start}:00+08:00`).getTime() <= now.getTime()) date.setUTCDate(date.getUTCDate() + 1)
  const day = date.toISOString().slice(0, 10)
  return { kind, start: `${day}T${start}`, end: `${day}T${end}`, reason: '' }
}
const statusLabel = (row: CheckinRequestRecord) => row.status === 'rejected' ? '未批准' : CHECKIN_REQUEST_STATUS_LABELS[row.status]
function beijingISO(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请选择完整的开始和结束时间')
  const date = new Date(`${value}:00+08:00`)
  if (!Number.isFinite(date.getTime())) throw new Error('请选择有效时间')
  return date.toISOString()
}
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) throw new Error(body?.error ?? '暂时无法完成，请重试')
  return body as T
}

export function CheckinRequests() {
  const { me, role } = useSession()
  return <RequestPanel key={`${me.id}:${role.locked}`} />
}

function RequestPanel() {
  const { me, role, user } = useSession()
  const [view, setView] = useState<View>(role.locked ? 'pending' : 'mine')
  const scope = role.locked && view !== 'mine' ? 'team' : 'mine'
  const pendingView = role.locked && view === 'pending'
  const [month, setMonth] = useState(() => businessDate(new Date()).slice(0, 7))
  const [rows, setRows] = useState<CheckinRequestRecord[]>([])
  const [total, setTotal] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const [listError, setListError] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => initialDraft())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const savingRef = useRef(false)
  const submission = useRef<{ key: string; requestId: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [decisionError, setDecisionError] = useState('')
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null)
  const decisionRef = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [mobile, setMobile] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setMobile(query.matches)
    update(); query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const load = useCallback(async (offset = 0) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    if (offset === 0) { setLoading(true); setRows([]); setNext(null) } else setMoreBusy(true)
    setListError('')
    try {
      const result = await call<CheckinRequestList>(`/api/checkin-requests?${new URLSearchParams({ ...(pendingView ? { status: 'pending' } : { month }), scope, limit: '100', offset: String(offset) })}`, { signal: current.signal })
      if (!current.signal.aborted) {
        setRows(previous => offset === 0 ? result.rows : [...previous, ...result.rows.filter(row => !previous.some(old => old.id === row.id))])
        setNext(result.next)
        setTotal(result.total)
      }
    } catch (e) { if (!current.signal.aborted) setListError(e instanceof Error ? e.message : '申请记录读取失败') }
    finally { if (!current.signal.aborted) { setLoading(false); setMoreBusy(false) } }
  }, [month, scope, pendingView])
  useEffect(() => { void load(); return () => controller.current?.abort() }, [load, refresh])

  function openForm() {
    if (!creating) { setDraft(initialDraft()); setFormError(''); submission.current = null }
    setCreating(value => !value)
  }
  function showDetails(id: string, reject = false) {
    setExpanded(current => reject || current !== id ? id : null)
    setRejecting(reject ? id : null); setDecisionReason(''); setDecisionError('')
  }
  function reapply(row: CheckinRequestRecord) {
    const nextDraft = initialDraft(row.kind)
    if (new Date(row.startAt).getTime() > Date.now()) {
      nextDraft.start = `${businessDate(new Date(row.startAt))}T${hour(row.startAt)}`
      nextDraft.end = `${businessDate(new Date(row.endAt))}T${hour(row.endAt)}`
    }
    setDraft({ ...nextDraft, reason: row.reason }); setFormError(''); submission.current = null; setCreating(true)
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  async function submit() {
    if (savingRef.current) return
    setFormError('')
    let input: { kind: CheckinRequestKind; startAt: string; endAt: string; reason: string }
    try {
      input = { kind: draft.kind, startAt: beijingISO(draft.start), endAt: beijingISO(draft.end), reason: draft.reason.trim() }
      if (!input.reason) throw new Error('请填写申请原因')
      if (draft.start.slice(0, 10) !== draft.end.slice(0, 10)) throw new Error('跨天请分别申请')
      if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime()) throw new Error('结束时间必须晚于开始时间')
    } catch (e) { setFormError(e instanceof Error ? e.message : '请检查申请信息'); return }
    const key = JSON.stringify(input)
    if (submission.current?.key !== key) submission.current = { key, requestId: crypto.randomUUID() }
    savingRef.current = true; setSaving(true)
    try {
      const result = await call<CheckinRequestResult>('/api/checkin-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, requestId: submission.current.requestId }) })
      setCreating(false); setDraft(initialDraft()); submission.current = null
      setView('mine'); setSearch(''); setStatusFilter('all'); setMonth(businessDate(new Date(result.record.startAt)).slice(0, 7)); setExpanded(result.record.id); setRefresh(value => value + 1)
      toast.success(result.created ? '申请已提交，等待老板审批' : '这条申请已经提交')
    } catch (e) { setFormError(e instanceof Error ? e.message : '提交失败，请重试') }
    finally { savingRef.current = false; setSaving(false) }
  }
  async function decide(row: CheckinRequestRecord, decision: 'approved' | 'rejected') {
    if (!role.locked || decisionRef.current) return
    if (decision === 'rejected' && !decisionReason.trim()) { setDecisionError('请说明不批准的原因'); return }
    decisionRef.current = true; setDecisionBusy(row.id); setExpanded(row.id); setDecisionError('')
    try {
      const result = await call<{ record: CheckinRequestRecord }>(`/api/checkin-requests/${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, ...(decision === 'rejected' ? { decisionReason: decisionReason.trim() } : {}) }) })
      setRows(previous => previous.map(item => item.id === row.id ? result.record : item))
      if (pendingView) setRefresh(value => value + 1)
      setRejecting(null); setDecisionReason('')
      toast.success(decision === 'approved' ? '已批准申请' : '已记录不批准的原因')
    } catch (e) { setDecisionError(e instanceof Error ? e.message : '审批失败，请重试') }
    finally { decisionRef.current = false; setDecisionBusy(null) }
  }

  const visibleRows = useMemo(() => view === 'pending' ? rows.filter(row => row.status === 'pending') : rows, [rows, view])
  const mobileRows = useMemo(() => visibleRows.filter(row => (view === 'pending' || statusFilter === 'all' || row.status === statusFilter) && fuzzyMatch([row.name, CHECKIN_REQUEST_LABELS[row.kind], row.reason], search)), [visibleRows, view, statusFilter, search])

  function decisionButtons(row: CheckinRequestRecord) {
    return <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant={mobile ? 'outline' : 'ghost'} className="h-10 text-primary md:h-9" disabled={!!decisionBusy} onClick={e => { e.stopPropagation(); void decide(row, 'approved') }}>{decisionBusy === row.id ? <SpinnerGap className="animate-spin" size={14} /> : <Check size={14} />}批准</Button>
      <Button type="button" size="sm" variant="ghost" className="h-10 md:h-9" disabled={!!decisionBusy} onClick={e => { e.stopPropagation(); showDetails(row.id, true) }}>不批准</Button>
    </div>
  }
  function details(row: CheckinRequestRecord) {
    const reviewer = row.decidedBy ? user(row.decidedBy) : undefined
    return <div className="space-y-3 py-2 text-sm">
      {!mobile && <><div className="flex flex-wrap items-center gap-2"><Avatar user={{ id: row.userId, name: row.name, hue: row.hue, avatar: row.avatar }} size={24} /><strong>{row.name}</strong><span>{CHECKIN_REQUEST_LABELS[row.kind]}</span><Status row={row} /></div><p className="text-xs tabular-nums text-muted-foreground">{dateTime(row.startAt)} — {hour(row.endAt)} · 北京时间</p></>}
      <p className="whitespace-pre-wrap break-words">{row.reason}</p>
      <div className="space-y-2 border-t pt-2 text-xs text-muted-foreground">
        <p>提交于 {dateTime(row.createdAt)}</p>
        {row.decidedAt && <div className="flex flex-wrap items-center gap-1.5"><Avatar user={reviewer ?? { id: row.decidedBy ?? 'boss', name: '老板', hue: 160 }} size={20} /><span>{reviewer?.name ?? '老板'} · {dateTime(row.decidedAt)}</span></div>}
        {row.decisionReason && <p className="whitespace-pre-wrap break-words text-foreground">不批准原因：{row.decisionReason}</p>}
      </div>
      {row.status === 'rejected' && row.userId === me.id && <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => reapply(row)}>修改后重新申请</Button>}
      {role.locked && row.status === 'pending' && rejecting === row.id && <form className="space-y-2 border-t pt-3" onSubmit={e => { e.preventDefault(); void decide(row, 'rejected') }}>
        <label className="block space-y-1.5"><span className="text-xs">不批准原因</span><textarea aria-label="不批准申请的原因" autoFocus required maxLength={1000} rows={2} disabled={!!decisionBusy} value={decisionReason} onChange={e => setDecisionReason(e.target.value)} placeholder="说明原因，员工会看到这条回复" className={cn(inputCls, 'h-auto w-full bg-background py-2')} /></label>
        <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" className="h-10" disabled={!!decisionBusy} onClick={() => { setRejecting(null); setDecisionError('') }}>取消</Button><Button type="submit" size="sm" className="h-10" disabled={!!decisionBusy || !decisionReason.trim()}>{decisionBusy === row.id ? '正在保存…' : '确认不批准'}</Button></div>
      </form>}
      {decisionError && <p role="alert" className="text-sm text-danger">{decisionError}</p>}
    </div>
  }
  const cols: Col<CheckinRequestRecord>[] = [
    ...(scope === 'team' ? [{ id: 'person', header: '员工', size: 145, hideable: false, sort: (row: CheckinRequestRecord) => row.name, cell: (row: CheckinRequestRecord) => <span className="flex min-w-0 items-center gap-2 py-2"><Avatar user={{ id: row.userId, name: row.name, hue: row.hue, avatar: row.avatar }} size={26} /><span className="min-w-0 break-words text-sm font-medium">{row.name}</span></span> }] : []),
    { id: 'request', header: '申请 / 时段', size: 145, hideable: false, sort: row => CHECKIN_REQUEST_LABELS[row.kind], cell: row => <div className="space-y-0.5 py-2"><span className="block text-sm font-medium">{CHECKIN_REQUEST_LABELS[row.kind]}</span><span className="block text-xs tabular-nums text-muted-foreground">{hour(row.startAt)}–{hour(row.endAt)}</span></div> },
    { id: 'day', header: '日期', size: 110, sort: row => row.startAt, filterValue: row => businessDate(new Date(row.startAt)), cell: row => <span className="text-xs tabular-nums">{businessDate(new Date(row.startAt))}</span> },
    { id: 'period', header: '时段', size: 140, sort: row => row.startAt, filterValue: row => `${hour(row.startAt)}–${hour(row.endAt)}`, cell: row => <span className="tabular-nums">{hour(row.startAt)}–{hour(row.endAt)}</span> },
    { id: 'reason', header: '申请原因', size: 210, sort: row => row.reason, cell: row => <span className="line-clamp-2 break-words text-sm" title={row.reason}>{row.reason}</span> },
    { id: 'status', header: '状态', size: 90, sort: statusLabel, cell: row => <Status row={row} /> },
    { id: 'created', header: '申请时间', size: 170, sort: row => row.createdAt, filterValue: row => dateTime(row.createdAt), cell: row => <time dateTime={row.createdAt} className="text-xs tabular-nums text-muted-foreground">{dateTime(row.createdAt)}</time> },
    { id: 'decided', header: '审批时间', size: 170, sort: row => row.decidedAt ?? '', cell: row => <span className="text-xs tabular-nums text-muted-foreground">{row.decidedAt ? dateTime(row.decidedAt) : '—'}</span> },
    { id: 'reviewer', header: '审批人', size: 130, sort: row => row.decidedBy ? user(row.decidedBy)?.name ?? '老板' : '', cell: row => row.decidedAt ? <span className="inline-flex items-center gap-2"><Avatar user={(row.decidedBy ? user(row.decidedBy) : undefined) ?? { id: row.decidedBy ?? 'boss', name: '老板', hue: 160 }} size={22} />{row.decidedBy ? user(row.decidedBy)?.name ?? '老板' : '老板'}</span> : '—' },
    { id: 'decisionReason', header: '审批说明', size: 220, sort: row => row.decisionReason ?? '', cell: row => <span className="block truncate" title={row.decisionReason ?? undefined}>{row.decisionReason ?? '—'}</span> },
    { id: 'actions', header: '操作', size: 175, hideable: false, cell: row => role.locked && row.status === 'pending'
      ? decisionButtons(row)
      : <Button type="button" size="sm" variant="ghost" className="h-9" onClick={e => { e.stopPropagation(); showDetails(row.id) }}>{expanded === row.id ? '收起' : '查看'}<CaretDown size={13} className={cn('transition-transform', expanded === row.id && 'rotate-180')} /></Button> },
  ]

  return <section className="min-w-0" aria-label="出勤申请">
    <div className="flex items-center justify-between gap-3 px-4 py-3"><div><h3 className="text-sm font-semibold">出勤申请</h3><p className="mt-0.5 text-xs text-muted-foreground">晚到、早退、请假或加班，请提前申请</p></div><Button type="button" size="sm" className="h-10 shrink-0" variant={creating ? 'ghost' : 'outline'} disabled={saving} onClick={openForm}>{creating ? <X size={15} /> : <Plus size={15} />}{creating ? '收起' : '新申请'}</Button></div>
    {creating && <form ref={formRef} className="space-y-3 border-y bg-muted/20 px-4 py-4" onSubmit={e => { e.preventDefault(); void submit() }}>
      <div className="flex items-center justify-between gap-3"><label htmlFor="checkin-request-kind" className="text-sm">申请类型</label><span className="text-xs text-muted-foreground">北京时间</span></div>
      <Select value={draft.kind} disabled={saving} onValueChange={(kind: CheckinRequestKind) => setDraft(previous => ({ ...initialDraft(kind), reason: previous.reason }))}><SelectTrigger id="checkin-request-kind" className="h-10 bg-background"><SelectValue /></SelectTrigger><SelectContent>{CHECKIN_REQUEST_KINDS.map(kind => <SelectItem key={kind} value={kind}>{CHECKIN_REQUEST_LABELS[kind]}</SelectItem>)}</SelectContent></Select>
      <label className="block min-w-0 space-y-1.5 text-sm"><span>申请日期</span><input aria-label="申请日期（北京时间）" type="date" required min={businessDate(new Date())} disabled={saving} value={draft.start.slice(0, 10)} onChange={e => setDraft(previous => ({ ...previous, start: `${e.target.value}T${previous.start.slice(11)}`, end: `${e.target.value}T${previous.end.slice(11)}` }))} className={cn(inputCls, 'block h-11 min-w-0 w-full max-w-full bg-background')} /></label>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <label className="min-w-0 space-y-1.5 text-sm"><span>{draft.kind === 'late' ? '原定到岗' : draft.kind === 'early' ? '预计离岗' : '开始时间'}</span><input aria-label="申请开始时间（北京时间）" type="time" required step="60" disabled={saving} value={draft.start.slice(11)} onChange={e => setDraft(previous => ({ ...previous, start: `${previous.start.slice(0, 10)}T${e.target.value}` }))} className={cn(inputCls, 'block h-11 min-w-0 w-full max-w-full bg-background')} /></label>
        <label className="min-w-0 space-y-1.5 text-sm"><span>{draft.kind === 'late' ? '预计到岗' : draft.kind === 'early' ? '原定下班' : '结束时间'}</span><input aria-label="申请结束时间（北京时间）" type="time" required step="60" disabled={saving} value={draft.end.slice(11)} onChange={e => setDraft(previous => ({ ...previous, end: `${previous.end.slice(0, 10)}T${e.target.value}` }))} className={cn(inputCls, 'block h-11 min-w-0 w-full max-w-full bg-background')} /></label>
      </div>
      <label className="block space-y-1.5 text-sm"><span>申请原因</span><textarea required aria-label="申请原因" maxLength={1000} rows={3} disabled={saving} value={draft.reason} onChange={e => setDraft(previous => ({ ...previous, reason: e.target.value }))} className={cn(inputCls, 'h-auto w-full resize-y bg-background py-2')} placeholder="说明特殊情况或具体安排" /></label>
      {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
      <Button type="submit" className="h-11 w-full" disabled={saving || !draft.reason.trim()}>{saving && <SpinnerGap size={16} className="animate-spin" />}{saving ? '正在提交…' : '提交申请'}</Button>
    </form>}
    {role.locked && <div className="border-b px-3 py-2"><Segmented label="出勤申请范围" value={view} onChange={value => { setView(value); setExpanded(null); setRejecting(null); setDecisionError(''); setSearch(''); setStatusFilter('all') }} items={[["pending", '待我审批'], ["team", '团队记录'], ["mine", '我的申请']]} /></div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      {pendingView ? <span className="py-2 text-sm font-medium">待审批 {loading ? '…' : listError ? '—' : total} 条 · 全部日期</span> : <div className="flex items-center gap-1"><Button type="button" size="icon" variant="ghost" aria-label="申请记录上一月" className="h-9 w-9" onClick={() => setMonth(shiftMonth(month, -1))}><CaretLeft size={15} /></Button><span className="min-w-24 text-center text-sm tabular-nums">{monthLabel(month)}</span><Button type="button" size="icon" variant="ghost" aria-label="申请记录下一月" className="h-9 w-9" onClick={() => setMonth(shiftMonth(month, 1))}><CaretRight size={15} /></Button></div>}
      <span className="text-xs text-muted-foreground">{loading ? '读取中…' : `${mobile ? mobileRows.length : visibleRows.length} 条${next !== null ? ' · 可加载更多' : ''}`} · 北京时间</span>
    </div>
    {listError && <div role="alert" className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm text-danger"><span>{listError}</span><Button type="button" size="sm" variant="ghost" onClick={() => void load()}>重试</Button></div>}
    <div className="flex min-h-48 flex-col" aria-busy={loading || moreBusy}>
      {mobile ? <>
        <div className="flex min-w-0 gap-2 border-b px-4 py-2">
          <label className="relative min-w-0 flex-1"><MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" /><input aria-label="搜索出勤申请" value={search} onChange={e => setSearch(e.target.value)} placeholder={scope === 'team' ? '搜员工、原因' : '搜类型、原因'} className={cn(inputCls, 'h-10 w-full pl-9')} /></label>
          {view !== 'pending' && <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="申请状态筛选" className="h-10 w-28 shrink-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="pending">待审批</SelectItem><SelectItem value="approved">已批准</SelectItem><SelectItem value="rejected">未批准</SelectItem></SelectContent></Select>}
        </div>
        {mobileRows.length ? <div className="divide-y">{mobileRows.map(row => <article key={row.id} className="min-w-0 space-y-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><Avatar user={{ id: row.userId, name: row.name, hue: row.hue, avatar: row.avatar }} size={30} /><div className="min-w-0"><p className="break-words text-sm font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{CHECKIN_REQUEST_LABELS[row.kind]}</p></div></div><Status row={row} /></div>
          <p className="text-sm tabular-nums">{businessDate(new Date(row.startAt))}<span className="ml-2 font-medium">{hour(row.startAt)}–{hour(row.endAt)}</span></p>
          {expanded !== row.id && <><p className="line-clamp-2 break-words text-sm text-muted-foreground">{row.reason}</p>{row.status === 'rejected' && row.decisionReason && <p className="line-clamp-2 break-words text-xs text-warning">未批准：{row.decisionReason}</p>}</>}
          <div className="flex items-center justify-between gap-2"><Button type="button" size="sm" variant="ghost" className="-ml-2 h-10" aria-expanded={expanded === row.id} onClick={() => showDetails(row.id)}>{expanded === row.id ? '收起详情' : '查看详情'}<CaretDown size={13} className={cn('transition-transform', expanded === row.id && 'rotate-180')} /></Button>{role.locked && row.status === 'pending' && decisionButtons(row)}</div>
          {expanded === row.id && details(row)}
        </article>)}</div> : <p className="px-4 py-10 text-center text-sm text-muted-foreground">{loading ? '正在读取申请…' : listError ? '申请记录暂时无法显示' : search || statusFilter !== 'all' ? '没有符合条件的申请' : view === 'pending' ? '没有待审批申请' : '这个月还没有申请'}</p>}
      </> : <DataTable id={`checkin-requests:${me.id}:${scope}`} cols={cols} rows={visibleRows} rowId={row => row.id} freeze={1} maxHeight="min(65dvh,560px)" defaultVisibility={{ period: false, created: false, decided: false, reviewer: false, decisionReason: false }}
        empty={<p className="px-4 py-10 text-center text-sm text-muted-foreground">{loading ? '正在读取申请…' : listError ? '申请记录暂时无法显示' : view === 'pending' ? '没有待审批申请' : '这个月还没有申请'}</p>} onRowClick={row => showDetails(row.id)}
        expandedRow={row => expanded === row.id ? details(row) : null} />}
    </div>
    {next !== null && <div className="border-t px-4 py-2"><Button type="button" variant="ghost" className="h-10 w-full" disabled={loading || moreBusy} onClick={() => void load(next)}>{moreBusy ? <SpinnerGap size={16} className="animate-spin" /> : <CaretDown size={15} />}{moreBusy ? '读取中…' : '加载更多申请'}</Button></div>}
  </section>
}

function Status({ row }: { row: CheckinRequestRecord }) {
  return <span className={cn('inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs', row.status === 'approved' ? 'bg-primary/10 text-primary' : row.status === 'pending' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')}>{statusLabel(row)}</span>
}
