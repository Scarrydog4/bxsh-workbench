'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowClockwise, BellRinging, CalendarBlank, CheckCircle, ChatCircleText, Clock, PaperPlaneTilt, SpinnerGap } from '@phosphor-icons/react'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CUSTOMER_PORTAL_LIMITS, type CustomerPortalView, type CustomerRequest } from '@/shared/customer-portal'
import { SettlementNote } from './SettlementNote'
import { Thumbs } from './ImageViewer'
import { inputCls } from './ui'

const rememberedClients = new Map<string, string>()
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const connectionError = '暂时无法连接，请稍后重试。'
class CustomerPortalError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}

function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const s = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

/** A link-specific browser identity; blocked storage never broadens the returned history. */
function clientIdentity(token: string) {
  const key = `bxsh:customer:${token}`
  let id = rememberedClients.get(token)
  try {
    const stored = localStorage.getItem(key)
    if (stored && uuidPattern.test(stored)) id = stored
    if (!id) id = uuid()
    localStorage.setItem(key, id)
    rememberedClients.set(token, id)
    return { id, persistent: true }
  } catch {
    if (!id) id = uuid()
    rememberedClients.set(token, id)
    return { id, persistent: false }
  }
}

function timestamp(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
}

async function responseBody(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new CustomerPortalError(typeof body?.error === 'string' ? body.error : connectionError, response.status)
  if (!body || typeof body !== 'object') throw new CustomerPortalError(connectionError)
  return body
}

export function CustomerPortal({ token }: { token: string }) {
  const [client, setClient] = useState<{ id: string; persistent: boolean } | null>(null)
  const [view, setView] = useState<CustomerPortalView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [kind, setKind] = useState<'nudge' | 'requirement'>('nudge')
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [now, setNow] = useState(Date.now)
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const submitLock = useRef(false)
  const loadSequence = useRef(0)

  useEffect(() => { setClient(clientIdentity(token)) }, [token])
  const load = useCallback(async () => {
    if (!client) return
    const sequence = ++loadSequence.current
    setLoading(true)
    try {
      const response = await fetch(`/api/customer/${encodeURIComponent(token)}?clientId=${encodeURIComponent(client.id)}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      const result = await responseBody(response) as CustomerPortalView
      if (sequence !== loadSequence.current) return
      setView(result); setError(''); setNow(Date.now())
    } catch (e) {
      if (sequence !== loadSequence.current) return
      if ((e as { status?: number }).status === 404) setView(null)
      setError(e instanceof CustomerPortalError ? e.message : connectionError)
    } finally { if (sequence === loadSequence.current) setLoading(false) }
  }, [client, token])
  useEffect(() => { void load(); return () => { loadSequence.current++ } }, [load])
  useEffect(() => {
    if (!view?.nudgeAvailableAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [view?.nudgeAvailableAt])

  const wait = view?.nudgeAvailableAt ? Math.max(0, Math.ceil((Date.parse(view.nudgeAvailableAt) - now) / 60_000)) : 0
  const canSubmit = !!client && !!view && !busy && !reading && (kind !== 'nudge' || wait === 0) && (kind === 'nudge' || !!body.trim() || !!shots.length)

  async function submit() {
    if (!canSubmit || submitLock.current || !client) return
    submitLock.current = true; setBusy(true); setError(''); setSuccess('')
    loadSequence.current++; setLoading(false)
    const input = { clientId: client.id, kind, name: name.trim(), body: body.trim(), shots }
    const fingerprint = JSON.stringify(input)
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: uuid() }
    try {
      const response = await fetch(`/api/customer/${encodeURIComponent(token)}`, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, requestId: pending.current.requestId }),
      })
      const result = await responseBody(response) as { request: CustomerRequest; nudgeAvailableAt: string | null }
      setView(current => current && { ...current, nudgeAvailableAt: result.nudgeAvailableAt, requests: [result.request, ...current.requests.filter(request => request.id !== result.request.id)] })
      setBody(''); setShots([]); pending.current = null; setNow(Date.now())
      setSuccess(kind === 'nudge' ? '催办已发送，可在下方查看回复。' : '要求已提交，可在下方查看回复。')
    } catch (e) {
      if ((e as { status?: number }).status === 404) setView(null)
      setError(e instanceof CustomerPortalError ? e.message : connectionError)
    } finally { submitLock.current = false; setBusy(false) }
  }

  return <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 sm:pt-10">
    <Toaster position="top-center" richColors />
    <header className="mb-5 flex items-center justify-between gap-3">
      <div><p className="text-xs font-medium tracking-wide text-primary">笔下工单 · 订单服务</p><h1 className="mt-1 text-xl font-semibold">订单进度与要求</h1></div>
      <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" aria-label="刷新订单和回复" title="刷新" disabled={loading || busy || !client} onClick={() => { setSuccess(''); void load() }}><ArrowClockwise className={cn(loading && 'animate-spin')}/></Button>
    </header>
    {!view ? <section className="rounded-xl border bg-card p-6" aria-live="polite">
      {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><SpinnerGap className="animate-spin" size={18}/>正在读取订单…</div> : <><p role="alert" className="break-words text-sm">{error}</p><Button variant="outline" className="mt-4" onClick={() => void load()}>重新加载</Button></>}
    </section> : <>
      <section aria-label="订单信息" className="rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="break-words text-lg font-semibold leading-relaxed">{view.order.title}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary"><span className="h-1.5 w-1.5 rounded-full bg-current"/>{view.order.status}</span>
          {view.order.dueDate && <span className="inline-flex items-center gap-1.5 text-muted-foreground"><CalendarBlank size={16}/>当前计划 {view.order.dueDate.replaceAll('-', '/')}</span>}
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-xl border bg-card" aria-label="联系订单负责人">
        <div className="grid grid-cols-2 gap-1 border-b p-2" role="group" aria-label="提交类型">
          {([{ value: 'nudge', label: '催进度', Icon: BellRinging }, { value: 'requirement', label: '补充要求', Icon: ChatCircleText }] as const).map(({ value, label, Icon }) => <button key={value} type="button" disabled={busy || reading} aria-pressed={kind === value} onClick={() => { setKind(value); setError(''); setSuccess('') }} className={cn('flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', kind === value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}><Icon size={19} weight={kind === value ? 'fill' : 'regular'}/>{label}</button>)}
        </div>
        <form className="space-y-3 p-4 sm:p-5" onSubmit={e => { e.preventDefault(); void submit() }}>
          <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>你的称呼<span className="ml-1 text-xs">（选填）</span></span><input aria-label="你的称呼（选填）" value={name} onChange={e => setName(e.target.value)} maxLength={CUSTOMER_PORTAL_LIMITS.nameLength} autoComplete="off" disabled={busy} className={cn(inputCls, 'h-10 min-w-0 flex-1 text-base sm:max-w-64 sm:text-sm')} placeholder="方便对接人认出你"/></label>
          <SettlementNote anonymous note={body} shots={shots} onNote={setBody} onShots={setShots} disabled={busy} onReading={setReading} label={kind === 'nudge' ? '催办说明' : '补充要求'} placeholder={kind === 'nudge' ? '想了解哪部分进度？可以补充说明，也可以直接发送。' : '填写具体要求，或直接粘贴、拖入截图。'} maxImages={CUSTOMER_PORTAL_LIMITS.images} maxLength={CUSTOMER_PORTAL_LIMITS.bodyLength}/>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{reading ? '正在读取截图…' : `可粘贴或选图 · 最多 ${CUSTOMER_PORTAL_LIMITS.images} 张${shots.length ? ` · 已选 ${shots.length} 张` : ''}`}</span><span className="tabular-nums">{body.length}/{CUSTOMER_PORTAL_LIMITS.bodyLength}</span></div>
          {error && <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm leading-relaxed text-danger">{error}</p>}
          {success && <p role="status" className="flex items-start gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm leading-relaxed text-primary"><CheckCircle size={18} className="mt-0.5 shrink-0"/>{success}</p>}
          <Button type="submit" className="min-h-11 w-full text-sm" disabled={!canSubmit}>{busy ? <><SpinnerGap className="animate-spin"/>正在发送…</> : kind === 'nudge' && wait > 0 ? <><Clock/>{wait} 分钟后可再次催办</> : <><PaperPlaneTilt/>{kind === 'nudge' ? '发送催办' : '提交要求'}</>}</Button>
          {kind === 'nudge' && wait > 0 && <p className="text-center text-xs text-muted-foreground">这单近期已催办，补充要求仍可提交。</p>}
        </form>
      </section>

      <section className="mt-6" aria-label="我的提交记录">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">我的提交<span className="ml-2 text-sm font-normal text-muted-foreground">{view.requests.length}</span></h2><p className="text-xs text-muted-foreground">仅显示本浏览器的记录</p></div>
        {client && !client.persistent && <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">浏览器未允许保存记录身份，重新打开后可能看不到本次提交。</p>}
        {!view.requests.length ? <div className="rounded-xl border border-dashed px-4 py-7 text-center text-sm text-muted-foreground">提交后，处理进度和回复会显示在这里。</div> : <div className="space-y-3">{view.requests.map(request => <article key={request.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-sm font-medium">{request.kind === 'nudge' ? <BellRinging size={16}/> : <ChatCircleText size={16}/>}{request.kind === 'nudge' ? '催进度' : '补充要求'}{request.name && <span className="break-all font-normal text-muted-foreground">· {request.name}</span>}</div><time dateTime={request.createdAt} className="mt-1 block text-xs tabular-nums text-muted-foreground">{timestamp(request.createdAt)}</time></div><span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', request.status === 'handled' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{request.status === 'handled' ? '已处理' : '待处理'}</span></div>
          {request.body && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{request.body}</p>}
          {!!request.shots.length && <Thumbs anonymous className="mt-3" imgClass="h-20 w-20" pics={request.shots.map((src, i) => ({ src, thumb: `${src}${src.includes('?') ? '&' : '?'}thumb=1`, name: `提交截图${i + 1}.webp` }))}/>}
          {request.reply && <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2.5"><div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-primary"><span>处理回复</span>{request.handledAt && <time dateTime={request.handledAt} className="font-normal text-muted-foreground">{timestamp(request.handledAt)}</time>}</div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{request.reply}</p></div>}
        </article>)}</div>}
      </section>
    </>}
  </main>
}
