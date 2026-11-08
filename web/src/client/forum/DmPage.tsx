'use client'

import { fuzzyMatch } from '@/shared/search'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Eye, MagnifyingGlass, PaperPlaneRight, Paperclip, Plus, SpinnerGap } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'
import { DM_BODY_LIMIT, DM_RETRACT_MS, type DmMessage, type DmMessagePage, type DmPerson, type DmThread, type DmThreadList } from '@/shared/dm'
import { usePref } from '../prefs'
import { useSession } from '../store'
import { Avatar } from '../ui'
import { LoadingList } from '../PageLoading'
import { forumAct, getMessages, listPeople, listThreads, newRequestId, onLive, uploadFile } from './api'
import { AttachmentList, filesFrom } from './Attachments'
import { clock, daySeparator, relTime, sameDay } from './format'
import { refreshDmUnread, takeForumTarget, useForumTarget } from './live'

const M = FORUM_COPY.dmUi, C = FORUM_COPY.common, E = FORUM_COPY.errors

export function DmPage() {
  const { me, role } = useSession()
  return <DmPanel key={`${me.id}:${role.locked}`} />
}

function DmPanel() {
  const { role } = useSession()
  const [list, setList] = useState<DmThreadList | null>(null)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [noticeSeen, setNoticeSeen] = usePref<boolean>('dm.noticeSeen', false)
  const target = useForumTarget()
  const load = useCallback(async () => { setLoadError(''); try { setList(await listThreads()) } catch (error) { setLoadError(error instanceof Error ? error.message : E.unknown) } }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => onLive('dm', () => void load()), [load])
  useEffect(() => { if (target.threadId) { const t = takeForumTarget(); setSelected(t.threadId!) } }, [target])
  useEffect(() => {
    if (selected || !list || window.matchMedia('(max-width: 1023px)').matches) return
    const first = list.mine[0] ?? list.others[0]
    if (first) setSelected(first.id)
  }, [list, selected])
  const thread = list && [...list.mine, ...list.others].find(t => t.id === selected)
  const start = async (person: DmPerson) => {
    setPicking(false)
    try { const r = await forumAct<{ threadId: string }>('dm.start', { userId: person.id }); await load(); setSelected(r.threadId) }
    catch (e) { toast.error(e instanceof Error ? e.message : E.unknown) }
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-2">
        <h1 className="text-lg font-semibold tracking-tight">{M.title}</h1>
        <Button size="sm" className="ml-auto" onClick={() => setPicking(true)}><Plus size={15} />{M.newButton}</Button>
      </div>
      {!role.locked && !noticeSeen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2 text-[12.5px]">
          <Eye size={14} className="text-primary" /><span className="min-w-0 flex-1">{M.firstNotice}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setNoticeSeen(true)}>{C.gotIt}</Button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <section className={cn('scroll-thin min-h-0 overflow-y-auto border-r', selected && 'hidden lg:block')} aria-label={M.title}>
          {loadError && <div role="alert" className="space-y-2 p-4 text-center text-sm text-muted-foreground"><p>{loadError}</p><Button size="sm" variant="outline" onClick={() => void load()}>{C.retry}</Button></div>}
          {!list && !loadError && <div role="status" aria-busy="true" className="p-3"><span className="sr-only">{C.loading}</span><div aria-hidden="true"><LoadingList /></div></div>}
          {list && role.locked && <div className="border-b bg-muted/40 px-3 py-1.5 text-[11.5px] text-muted-foreground">{M.groupMine}</div>}
          {list && list.mine.length === 0 && <div className="px-6 py-10 text-center text-sm text-muted-foreground">{M.empty}</div>}
          {list?.mine.map(t => <ThreadRow key={t.id} thread={t} active={t.id === selected} onOpen={() => setSelected(t.id)} />)}
          {list && list.others.length > 0 && <>
            <div className="border-b bg-muted/40 px-3 py-1.5 text-[11.5px] text-muted-foreground">{M.groupOthers}</div>
            {list.others.map(t => <ThreadRow key={t.id} thread={t} active={t.id === selected} onOpen={() => setSelected(t.id)} />)}
          </>}
        </section>
        <section className={cn('flex min-h-0 flex-col', !selected && 'hidden lg:flex')}>
          {thread ? <Chat key={thread.id} thread={thread} onBack={() => setSelected(null)} onChanged={load} />
            : <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">{list && !list.mine.length && !list.others.length ? M.empty : M.pick}</div>}
        </section>
      </div>
      {picking && <PeoplePicker onClose={() => setPicking(false)} onPick={start} />}
    </div>
  )
}

function Pair({ people }: { people: [DmPerson, DmPerson] }) {
  return <span className="relative inline-flex h-8 w-10 shrink-0"><Avatar user={people[0]} size={24} className="absolute left-0 top-0" /><Avatar user={people[1]} size={24} className="absolute bottom-0 right-0 ring-2 ring-card" /></span>
}

function ThreadRow({ thread, active, onOpen }: { thread: DmThread; active: boolean; onOpen: () => void }) {
  const title = thread.counterpart ? thread.counterpart.name : M.pairTitle(thread.participants[0].name, thread.participants[1].name)
  return (
    <button type="button" onClick={onOpen} aria-current={active} className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent/60', active && 'bg-primary/[.07]')}>
      {thread.counterpart ? <Avatar user={thread.counterpart} size={32} /> : <Pair people={thread.participants} />}
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium">{title}</div>
        <div className="truncate text-[12.5px] text-muted-foreground">{thread.lastMessagePreview}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="num text-[11px] text-muted-foreground">{thread.lastMessage ? relTime(thread.lastMessage.createdAt) : ''}</span>
        {thread.unreadCount > 0 && <span className="num min-w-4 rounded-full bg-primary px-1.5 text-center text-[10.5px] leading-4 text-primary-foreground">{thread.unreadCount}</span>}
      </div>
    </button>
  )
}

type Outgoing = { key: string; name?: string; progress?: number; body?: string; error?: string }

function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s<>"'，。；、）)]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">{part}</a> : <Fragment key={i}>{part}</Fragment>)
}

function Chat({ thread, onBack, onChanged }: { thread: DmThread; onBack: () => void; onChanged: () => void }) {
  const { me } = useSession()
  const [page, setPage] = useState<DmMessagePage | null>(null)
  const [loadError, setLoadError] = useState('')
  const [older, setOlder] = useState<DmMessage[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [outbox, setOutbox] = useState<Outgoing[]>([])
  const [over, setOver] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const stick = useRef(true)
  const readOnly = thread.readOnly
  const other = thread.counterpart

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const p = await getMessages(thread.id)
      setPage(p); setCursor(c => c ?? p.next)
      if (!p.thread.readOnly && p.thread.unreadCount > 0) {
        await forumAct('dm.read', { threadId: thread.id }).catch(() => {})
        void refreshDmUnread(); onChanged()
      }
    } catch (e) { setLoadError(e instanceof Error ? e.message : E.unknown) }
  }, [thread.id, onChanged])
  useEffect(() => { void load() }, [load])
  useEffect(() => onLive('dm', id => { if (id === thread.id) void load() }), [thread.id, load])
  const messages = useMemo(() => [...older, ...(page?.rows ?? [])], [older, page])
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [messages.length, outbox.length])

  const loadOlder = async () => {
    if (!cursor) return
    const el = box.current, before = el ? el.scrollHeight - el.scrollTop : 0
    const p = await getMessages(thread.id, cursor).catch(() => null)
    if (!p) return
    stick.current = false
    setOlder(o => [...p.rows, ...o]); setCursor(p.next)
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before })
  }

  const send = async (body: string, attachmentIds: string[] = [], key = newRequestId()) => {
    stick.current = true
    try { await forumAct('dm.send', { threadId: thread.id, body, attachmentIds }, key); setOutbox(o => o.filter(x => x.key !== key)); await load(); onChanged() }
    catch (e) { setOutbox(o => o.map(x => x.key === key ? { ...x, error: e instanceof Error ? e.message : M.sendFailed } : x)) }
  }
  const sendText = () => {
    const body = text.trim()
    if (!body) return
    if ([...body].length > DM_BODY_LIMIT) return toast.error(E.dmTooLong)
    const key = newRequestId()
    setText(''); setOutbox(o => [...o, { key, body }]); void send(body, [], key)
  }
  const sendFiles = (files: File[]) => files.forEach(f => {
    const key = newRequestId()
    setOutbox(o => [...o, { key, name: f.name || '粘贴的图片.png', progress: 0 }])
    uploadFile(f, '', p => setOutbox(o => o.map(x => x.key === key ? { ...x, progress: p } : x)))
      .then(a => send('', [a.id], key))
      .catch(e => setOutbox(o => o.map(x => x.key === key ? { ...x, error: e instanceof Error ? e.message : E.unknown } : x)))
  })
  const retract = async (m: DmMessage) => {
    if (Date.now() - Date.parse(m.createdAt) > DM_RETRACT_MS) return toast.error(E.retractExpired)
    try { await forumAct('dm.retract', { id: m.id }); await load(); onChanged() } catch (e) { toast.error(e instanceof Error ? e.message : E.unknown) }
  }
  const copy = async (m: DmMessage) => { try { await navigator.clipboard.writeText(m.body); toast.success(M.copied) } catch { /* 复制被拒时不打扰 */ } }

  const [a, b] = thread.participants
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', over && 'bg-primary/5')}
      onDragOver={e => { if (!readOnly && thread.canSend && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); if (!readOnly && thread.canSend) sendFiles(filesFrom(e.dataTransfer)) }}>
      <header className="flex shrink-0 items-center gap-2.5 border-b px-3 py-2.5">
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 lg:hidden" aria-label={C.back} onClick={onBack}><ArrowLeft size={16} /></Button>
        {other ? <Avatar user={other} size={30} /> : <Pair people={thread.participants} />}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{other ? other.name : M.pairTitle(a.name, b.name)}</div>
          <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground"><Eye size={12} />{readOnly ? M.readOnlyTag : M.privacy}</div>
        </div>
      </header>
      <div ref={box} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4" onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        {cursor && <div className="mb-2 text-center"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void loadOlder()}>{M.loadEarlier}</Button></div>}
        {loadError && <div role="alert" className="space-y-2 p-4 text-center text-sm text-muted-foreground"><p>{loadError}</p><Button size="sm" variant="outline" onClick={() => void load()}>{C.retry}</Button></div>}
        {!page && !loadError && <div role="status" aria-busy="true"><span className="sr-only">{C.loading}</span><div aria-hidden="true"><LoadingList rows={2} /></div></div>}
        <div className="flex flex-col gap-2.5">
          {messages.map((m, i) => {
            const mine = !readOnly && m.senderId === me.id
            const sender = thread.participants.find(p => p.id === m.senderId)
            const sep = i === 0 || !sameDay(messages[i - 1].createdAt, m.createdAt)
            return (
              <Fragment key={m.id}>
                {sep && <div className="self-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">{daySeparator(m.createdAt)}</div>}
                {m.retractedAt
                  ? <div className="self-center text-[11.5px] text-muted-foreground">{m.senderId === me.id ? M.retractedMine : M.retractedOther(sender?.name ?? '')}</div>
                  : <div className={cn('group flex max-w-[86%] items-end gap-2 sm:max-w-[70%]', mine && 'flex-row-reverse self-end')}>
                      {!mine && <Avatar user={sender} size={22} />}
                      <div className={cn('flex min-w-0 flex-col gap-1', mine && 'items-end')}>
                        {m.body && <div className={cn('whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13.5px] leading-relaxed', mine ? 'bg-primary/[.12] rounded-br-md' : 'rounded-bl-md bg-muted')}>{linkify(m.body)}</div>}
                        {m.attachments.length > 0 && <AttachmentList files={m.attachments} showMeta={false} className="w-full min-w-[220px]" />}
                        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                          {readOnly && <span className="font-medium">{sender?.name}</span>}
                          <span className="num">{clock(m.createdAt)}</span>
                          {mine && page?.lastOwnMessageId === m.id && page.lastOwnMessageRead && <span>{M.read}</span>}
                          <span className="hidden gap-1.5 group-hover:inline-flex group-focus-within:inline-flex">
                            {mine && <button type="button" className="hover:text-foreground" onClick={() => void retract(m)}>{C.retract}</button>}
                            {m.body && <button type="button" className="hover:text-foreground" onClick={() => void copy(m)}>{C.copy}</button>}
                          </span>
                        </div>
                      </div>
                    </div>}
              </Fragment>
            )
          })}
          {outbox.map(o => (
            <div key={o.key} className="flex max-w-[70%] flex-col items-end gap-1 self-end">
              <div className={cn('flex items-center gap-1.5 rounded-2xl rounded-br-md px-3 py-1.5 text-[13.5px]', o.error ? 'bg-danger/10 text-danger' : 'bg-primary/[.12] opacity-70')}>
                {!o.error && <SpinnerGap size={13} className="animate-spin" />}
                <span className="whitespace-pre-wrap break-words">{o.body ?? `${o.name}${o.progress != null && !o.error ? ` · ${FORUM_COPY.upload.progress(o.progress)}` : ''}`}</span>
              </div>
              {o.error && <div className="flex items-center gap-1.5 text-[11px] text-danger">{o.error === M.sendFailed || !o.body ? o.error : M.sendFailed}
                {o.body && <button type="button" className="underline" onClick={() => { setOutbox(x => x.map(y => y.key === o.key ? { ...y, error: undefined } : y)); void send(o.body!, [], o.key) }}>{C.retry}</button>}
                <button type="button" className="underline" onClick={() => setOutbox(x => x.filter(y => y.key !== o.key))}>{C.close}</button>
              </div>}
            </div>
          ))}
        </div>
      </div>
      {readOnly
        ? <div className="shrink-0 border-t px-4 py-3 text-center text-xs text-muted-foreground">{M.readOnlyBox(a.name, b.name)}</div>
        : !thread.canSend
          ? <div className="shrink-0 border-t px-4 py-3 text-center text-xs text-muted-foreground">{E.accountInactive(other?.name ?? '')}</div>
          : <div className="shrink-0 border-t px-3 py-2.5">
              <div className="flex items-end gap-2">
                <Button size="sm" variant="ghost" className="h-9 w-9 shrink-0 p-0" title={FORUM_COPY.composer.pickFile} aria-label={FORUM_COPY.composer.pickFile} onClick={() => file.current?.click()}><Paperclip size={17} /></Button>
                <input ref={file} type="file" multiple hidden onChange={e => { sendFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
                <textarea value={text} rows={1} aria-label={M.placeholder(other?.name ?? '')} placeholder={M.placeholder(other?.name ?? '')} onChange={e => setText(e.target.value)}
                  onPaste={e => { const f = filesFrom(e.clipboardData); if (f.length) { e.preventDefault(); sendFiles(f) } }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendText() } }}
                  className="max-h-36 min-h-9 flex-1 resize-none rounded-lg border bg-background px-3 py-1.5 text-sm leading-relaxed outline-none [field-sizing:content] focus-visible:ring-1 focus-visible:ring-ring" />
                <Button size="sm" className="h-9 shrink-0 gap-1.5" disabled={!text.trim()} onClick={sendText}><PaperPlaneRight size={15} />{C.send}</Button>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{M.hint}</div>
            </div>}
    </div>
  )
}

function PeoplePicker({ onClose, onPick }: { onClose: () => void; onPick: (p: DmPerson) => void }) {
  const [people, setPeople] = useState<DmPerson[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { listPeople().then(setPeople).catch(() => setPeople([])) }, [])
  const shown = (people ?? []).filter(p => fuzzyMatch(p.name, q))
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-sm gap-3 p-4">
        <DialogTitle className="text-base">{M.pickTitle}</DialogTitle>
        <label className="flex h-9 items-center gap-1.5 rounded-md border bg-background px-2.5 text-muted-foreground"><MagnifyingGlass size={15} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={M.pickPlaceholder} aria-label={M.pickPlaceholder} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" />
        </label>
        <div className="scroll-thin -mx-1 max-h-72 overflow-y-auto">
          {people === null && <div className="p-4 text-center text-sm text-muted-foreground">{C.loading}</div>}
          {shown.map(p => <button key={p.id} type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"><Avatar user={p} size={26} />{p.name}</button>)}
        </div>
      </DialogContent>
    </Dialog>
  )
}
