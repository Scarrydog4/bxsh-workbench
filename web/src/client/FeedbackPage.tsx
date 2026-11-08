import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatCircleText, CheckCircle, Circle, Clock, Lightbulb, Plus, Prohibit, WarningCircle } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, type Feedback, type FeedbackKind, type FeedbackStatus } from '@/shared/feedback'
import { Segmented } from './controls'
import { fetchFeedback } from './feedback-client'
import { SelectField } from './SelectField'
import { SettlementNote, SettlementNoteView } from './SettlementNote'
import { act, useSession } from './store'
import { DataTable, TableFooter, TablePageHeader } from './table-kit'
import { Empty, Person, inputCls } from './ui'

const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
const statusStyle = {
  待处理: { icon: Circle, className: 'bg-muted text-muted-foreground' },
  处理中: { icon: Clock, className: 'bg-primary/10 text-primary' },
  已解决: { icon: CheckCircle, className: 'bg-ok/10 text-ok' },
  暂不处理: { icon: Prohibit, className: 'bg-muted text-muted-foreground' },
}

function FeedbackStatusPill({ status }: { status: FeedbackStatus }) {
  const { icon: Icon, className } = statusStyle[status]
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs', className)}><Icon size={12}/>{status}</span>
}

export function FeedbackPage() {
  const { me, role } = useSession()
  // 切换账号或权限时立即丢弃上一个人的列表、详情和未提交内容。
  return <FeedbackPanel key={`${me.id}:${JSON.stringify(role)}`} />
}

function FeedbackPanel() {
  const { s, me, role } = useSession()
  const [rows, setRows] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setLoading(true)
    try {
      const result = await fetchFeedback(next.signal)
      if (!next.signal.aborted) { setRows(result); setError('') }
    } catch (e) {
      if (!next.signal.aborted) setError(e instanceof Error ? e.message : '反馈加载失败')
    } finally { if (!next.signal.aborted) setLoading(false) }
  }, [])
  useEffect(() => { void reload(); return () => controller.current?.abort() }, [reload, s.version])
  const item = rows.find(row => row.id === selected)
  return <div className="flex h-full min-h-0 flex-col bg-card">
    <TablePageHeader title="反馈" summary={role.locked ? '全部反馈' : '我的反馈'}>
      <Button size="sm" onClick={() => setCreating(true)}><Plus size={15}/>新建反馈</Button>
    </TablePageHeader>
    {error && <div role="alert" className="flex items-center gap-2 border-b px-4 py-2 text-sm text-danger">{error}<Button size="sm" variant="ghost" onClick={() => void reload()}>重试</Button></div>}
    <DataTable fill id="feedback" rows={rows} rowId={row => row.id} onRowClick={row => setSelected(row.id)} empty={<Empty icon={<ChatCircleText size={24}/>} title={loading ? '正在加载反馈…' : '还没有反馈'} action={!loading && !error ? <Button size="sm" variant="outline" onClick={() => setCreating(true)}>提个问题或建议</Button> : undefined}/>} cols={[
      { id: 'title', header: '标题', size: 360, hideable: false, sort: row => row.title, filterValue: row => `${row.no} ${row.title} ${row.body}`, cell: row => <span className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.no}</span><button className="truncate text-left font-medium hover:text-primary" title={row.title} onClick={event => { event.stopPropagation(); setSelected(row.id) }}>{row.title}</button></span> },
      { id: 'kind', header: '类型', size: 100, sort: row => row.kind, cell: row => <span className="inline-flex items-center gap-1.5 text-muted-foreground">{row.kind === '问题' ? <WarningCircle size={15}/> : <Lightbulb size={15}/>} {row.kind}</span> },
      { id: 'status', header: '状态', size: 115, sort: row => row.status, cell: row => <FeedbackStatusPill status={row.status}/> },
      { id: 'author', header: '提交人', size: 135, sort: row => row.author.name, cell: row => <Person user={row.author}/> },
      { id: 'replies', header: '回复', size: 80, sort: row => row.replies.length, cell: row => <span className="inline-flex items-center gap-1.5 tabular-nums text-muted-foreground"><ChatCircleText size={14}/>{row.replies.length}</span> },
      { id: 'updated', header: '更新时间', size: 165, sort: row => row.updatedAt, cell: row => <time dateTime={row.updatedAt} className="text-xs tabular-nums text-muted-foreground">{date(row.updatedAt)}</time> },
    ]} footer={table => <TableFooter>{table.getRowModel().rows.length} 条反馈{loading && rows.length > 0 && <span className="ml-2">更新中…</span>}</TableFooter>}/>
    {creating && <FeedbackCreateDialog onClose={() => setCreating(false)} onSaved={async id => { setCreating(false); await reload(); setSelected(id) }}/>}
    {item && <FeedbackDetail key={item.id} item={item} canManage={role.locked} canReply={role.locked || item.authorId === me.id} onClose={() => setSelected(null)} onSaved={reload}/>}
  </div>
}

export function FeedbackCreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [kind, setKind] = useState<FeedbackKind>('问题')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const submit = async () => {
    if (busy || reading || !title.trim()) return
    setBusy(true)
    try {
      const saved = await act<{ id: string }>('feedback.create', { requestId: requestId.current, kind, title: title.trim(), body: body.trim(), shots }, { onRejected: () => { requestId.current = crypto.randomUUID() } })
      if (saved?.id) { toast.success('反馈已提交'); await onSaved(saved.id) }
    } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100vw-24px)] max-w-xl overflow-y-auto rounded-xl p-5" aria-describedby="feedback-create-hint">
      <DialogTitle>新建反馈</DialogTitle>
      <DialogDescription id="feedback-create-hint" className="sr-only">提交平台问题或改进建议，支持文字和截图。</DialogDescription>
      <Segmented label="反馈类型" value={kind} onChange={setKind} items={FEEDBACK_KINDS.map(value => [value, value === '问题' ? <><WarningCircle size={15}/>{value}</> : <><Lightbulb size={15}/>{value}</>])}/>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
        <label className="block space-y-1.5 text-sm"><span>标题<span className="ml-1 text-danger">*</span></span><input autoFocus required maxLength={120} aria-label="反馈标题" disabled={busy} value={title} onChange={event => setTitle(event.target.value)} className={cn(inputCls, 'w-full')} placeholder="一句话说明遇到的问题或建议"/></label>
        <SettlementNote note={body} shots={shots} onNote={setBody} onShots={setShots} onReading={setReading} disabled={busy} label="反馈描述" placeholder="具体情况、操作步骤或建议，可直接粘贴截图" maxLength={5000}/>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || reading || !title.trim()}>{busy ? '提交中…' : reading ? '读取截图…' : '提交反馈'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}

export function FeedbackDetail({ item, canManage, canReply, onClose, onSaved }: { item: Feedback; canManage: boolean; canReply: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [body, setBody] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const replyRequestId = useRef(crypto.randomUUID())
  const updateRequest = useRef<{ id: string; status: FeedbackStatus } | null>(null)
  async function update(status: FeedbackStatus) {
    if (busy || !canManage || status === item.status) return
    const request = updateRequest.current?.status === status ? updateRequest.current : { id: crypto.randomUUID(), status }
    updateRequest.current = request
    setBusy(true)
    try {
      const saved = await act<{ id: string }>('feedback.update', { requestId: request.id, id: item.id, status }, { onRejected: () => { updateRequest.current = null } })
      if (saved?.id) { updateRequest.current = null; toast.success(`已标记为${status}`); await onSaved() }
    } finally { setBusy(false) }
  }
  async function reply() {
    if (busy || reading || !canReply || (!body.trim() && !shots.length)) return
    setBusy(true)
    try {
      const saved = await act<{ id: string }>('feedback.reply', { requestId: replyRequestId.current, id: item.id, body: body.trim(), shots }, { onRejected: () => { replyRequestId.current = crypto.randomUUID() } })
      if (saved?.id) { replyRequestId.current = crypto.randomUUID(); setBody(''); setShots([]); toast.success('回复已提交'); await onSaved() }
    } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-24px)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl p-0" aria-describedby="feedback-detail-hint">
      <div className="shrink-0 border-b p-5 pr-12">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span>{item.no}</span><span>{item.kind}</span><FeedbackStatusPill status={item.status}/></div>
        <DialogTitle className="break-words text-base leading-relaxed">{item.title}</DialogTitle>
        <DialogDescription id="feedback-detail-hint" className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Person user={item.author}/><span>提交于 {date(item.createdAt)}</span></DialogDescription>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <SettlementNoteView note={item.body} shots={item.shots} label="反馈截图"/>
        {canManage && <label className="flex items-center gap-3 border-y py-3 text-sm"><span className="text-muted-foreground">处理状态</span><SelectField aria-label="反馈处理状态" value={item.status} disabled={busy} onChange={event => void update(event.target.value as FeedbackStatus)} className={cn(inputCls, 'h-8 w-36')}>{FEEDBACK_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}</SelectField></label>}
        <section aria-label="反馈回复" className="space-y-4"><h3 className="flex items-center gap-1.5 text-sm font-medium"><ChatCircleText size={16}/>回复<span className="font-normal tabular-nums text-muted-foreground">{item.replies.length}</span></h3>
          {item.replies.length === 0 ? <p className="text-sm text-muted-foreground">暂无回复</p> : item.replies.map(reply => <article key={reply.id} className="space-y-2 border-l-2 border-border pl-3"><div className="flex flex-wrap items-center gap-2 text-sm"><Person user={reply.author}/><time dateTime={reply.at} className="text-xs tabular-nums text-muted-foreground">{date(reply.at)}</time></div><SettlementNoteView note={reply.body} shots={reply.shots} label="回复截图"/></article>)}
        </section>
        {canReply && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void reply() }}><SettlementNote note={body} shots={shots} onNote={setBody} onShots={setShots} onReading={setReading} disabled={busy} label="回复内容" placeholder="补充情况或回复，可直接粘贴截图" maxLength={5000}/><div className="flex justify-end"><Button type="submit" size="sm" disabled={busy || reading || (!body.trim() && !shots.length)}>{busy ? '保存中…' : reading ? '读取截图…' : '回复'}</Button></div></form>}
      </div>
    </DialogContent>
  </Dialog>
}
