'use client'

import { SelectField } from '../SelectField'
import { LoadingList } from '../PageLoading'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle, Circle, Clock, DotsThree, LockSimple, PushPin, Prohibit, ThumbsUp, Paperclip } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'
import type { FeedbackStatus } from '@/shared/feedback'
import type { ForumPostDetail, ForumReply } from '@/shared/forum'
import { Avatar } from '../ui'
import { useSession } from '../store'
import { ForumError, deletePost, forumAct, getPost, newRequestId, onLive } from './api'
import { AttachmentList, ConfirmDialog, UploadChips, filesFrom, useUploads } from './Attachments'
import { CategoryIcon } from './CategoryIcon'
import { isMac, relTime } from './format'
import { Markdown } from './Markdown'

const T = FORUM_COPY.detail, F = FORUM_COPY.forum, C = FORUM_COPY.common, E = FORUM_COPY.errors

export const STATUS_STYLE: Record<FeedbackStatus, { icon: typeof Circle; className: string }> = {
  待处理: { icon: Circle, className: 'bg-muted text-muted-foreground' },
  处理中: { icon: Clock, className: 'bg-primary/10 text-primary' },
  已解决: { icon: CheckCircle, className: 'bg-ok/10 text-ok' },
  暂不处理: { icon: Prohibit, className: 'bg-muted text-muted-foreground' },
}
export function StatusPill({ status }: { status: FeedbackStatus }) {
  const { icon: Icon, className } = STATUS_STYLE[status]
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', className)}><Icon size={12} />{status}</span>
}
export function PrivateChip() {
  return <span title={F.privateTip} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground"><LockSimple size={12} />{F.private}</span>
}
const chip = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground'

export function PostDetail({ id, onBack, onEdit, onDeleted, onChanged }: { id: string; onBack: () => void; onEdit: (post: ForumPostDetail) => void; onDeleted: () => void; onChanged: () => void }) {
  const [post, setPost] = useState<ForumPostDetail | null>(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    ctrl.current?.abort()
    const c = new AbortController(); ctrl.current = c
    setError('')
    try {
      const p = await getPost(id, c.signal)
      if (c.signal.aborted) return
      setPost(p); setError('')
      if (p.unread) void forumAct('forum.read', { id: p.id }).then(() => { window.dispatchEvent(new Event('bxsh:forum-read')); onChanged() }).catch(() => {})
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : E.unknown) }
  }, [id, onChanged])
  useEffect(() => { setPost(null); void load(); return () => ctrl.current?.abort() }, [load])
  useEffect(() => onLive('post', changed => { if (changed === id) void load() }), [id, load])

  const run = async (name: string, payload: Record<string, unknown>, ok?: string) => {
    try { await forumAct(name, payload); if (ok) toast.success(ok); await load(); onChanged() }
    catch (e) { toast.error(e instanceof Error ? e.message : E.unknown) }
  }

  if (error) return <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground"><div className="space-y-3"><p>{error}</p><Button size="sm" variant="outline" onClick={() => void load()}>{C.retry}</Button><Button size="sm" variant="outline" onClick={onBack} className="lg:hidden">{C.back}</Button></div></div>
  if (!post) return <div role="status" aria-busy="true" className="p-4"><span className="sr-only">{C.loading}</span><div aria-hidden="true"><LoadingList detail rows={1} /></div></div>
  const label = FORUM_COPY.categories[post.category]
  const manageStatus = post.canManage && post.category === 'feedback'
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-col gap-2.5 border-b px-4 pb-3 pt-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" className="-ml-2 h-7 gap-1 px-2 lg:hidden" onClick={onBack}><ArrowLeft size={14} />{C.back}</Button>
          <span className={chip}><CategoryIcon category={post.category} size={12} />{label}</span>
          {post.feedbackKind && <span className={chip}>{post.feedbackKind}</span>}
          {post.status && !manageStatus && <StatusPill status={post.status} />}
          {post.pinned && <span className={cn(chip, 'text-primary')}><PushPin size={12} />{F.pinned}</span>}
          {post.private && <PrivateChip />}
        </div>
        <h2 className="text-balance break-words text-lg font-semibold leading-snug">{post.title}</h2>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar user={post.author} size={28} />
            <div className="min-w-0 text-[12.5px]">
              <div className="font-medium">{post.author.name}</div>
              <div className="num text-[11.5px] text-muted-foreground">{T.timeLine(relTime(post.createdAt), post.lastActivityAt !== post.createdAt ? relTime(post.lastActivityAt) : undefined)}{post.editedAt && ` · ${T.edited}`}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {manageStatus && post.status && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">{F.statusLabel}
                <SelectField value={post.status} onChange={e => void run('forum.status', { id: post.id, status: e.target.value }, T.statusToast(e.target.value))} className="h-7 rounded-md border bg-card px-1.5 text-xs text-foreground">
                  {F.statuses.map(s => <option key={s}>{s}</option>)}
                </SelectField>
              </label>
            )}
            {post.canManage && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void run('forum.pin', { id: post.id, pinned: !post.pinned }, post.pinned ? T.unpinnedToast : T.pinnedToast)}><PushPin size={13} />{post.pinned ? T.unpin : T.pin}</Button>}
            {(post.canEdit || post.canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label={C.more}><DotsThree size={16} /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {post.canEdit && <DropdownMenuItem onSelect={() => onEdit(post)}>{C.edit}</DropdownMenuItem>}
                  {post.canDelete && <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setConfirmDelete(true)}>{C.delete}</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>
      <section className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        {post.body.trim() && <Markdown>{post.body}</Markdown>}
        <AttachmentList files={post.attachments} />
        <div><Button size="sm" variant="outline" aria-pressed={post.liked} className={cn('h-7 gap-1.5 px-2.5 text-xs', post.liked && 'border-primary/40 bg-primary/5 text-primary')} onClick={() => void run('forum.like', { id: post.id, liked: !post.liked })}><ThumbsUp size={13} weight={post.liked ? 'fill' : 'regular'} /><span className="num">{T.useful(post.likeCount)}</span></Button></div>
      </section>
      <Replies post={post} onChanged={async () => { await load(); onChanged() }} />
      <ConfirmDialog open={confirmDelete} title={T.deleteTitle} body={T.deleteBody} ok={C.delete} danger onResult={async ok => {
        setConfirmDelete(false)
        if (!ok) return
        try { await deletePost(post.id); toast.success(T.deletedToast); onDeleted() } catch (e) { toast.error(e instanceof Error ? e.message : E.unknown) }
      }} />
    </div>
  )
}

function Replies({ post, onChanged }: { post: ForumPostDetail; onChanged: () => Promise<void> }) {
  const { me } = useSession()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const uploads = useUploads()
  const requestId = useRef(newRequestId())
  const file = useRef<HTMLInputElement>(null)
  const send = async () => {
    if (busy) return
    if (!body.trim() && !uploads.ids.length) return setError(E.replyRequired)
    if (uploads.pending || uploads.failed) return setError(E.uploadPending)
    setBusy(true); setError('')
    try {
      await forumAct('forum.reply', { id: post.id, body, attachmentIds: uploads.ids }, requestId.current)
      requestId.current = newRequestId(); setBody(''); uploads.reset(); toast.success(T.repliedToast); await onChanged()
    } catch (e) { if (!(e instanceof ForumError) || e.status) requestId.current = newRequestId(); setError(e instanceof Error ? e.message : E.unknown) }
    finally { setBusy(false) }
  }
  return (
    <section className="flex flex-col gap-4 border-t px-4 py-4 sm:px-5">
      <h3 className="text-[12.5px] font-medium text-muted-foreground">{T.replies(post.replies.length)}</h3>
      {post.replies.map(r => <ReplyItem key={r.id} reply={r} postId={post.id} onChanged={onChanged} />)}
      <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-2.5">
        <Avatar user={me} size={22} />
        <div className="min-w-0"
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
          onDrop={e => { e.preventDefault(); uploads.add(filesFrom(e.dataTransfer)) }}>
          <label htmlFor="forum-reply" className="mb-1 block text-xs text-muted-foreground">{T.replyLabel}</label>
          <textarea id="forum-reply" value={body} rows={3} placeholder={T.replyPlaceholder} onChange={e => { setBody(e.target.value); setError('') }}
            onPaste={e => { const f = filesFrom(e.clipboardData); if (f.length) { e.preventDefault(); uploads.add(f) } }}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send() } }}
            className="block w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          <UploadChips uploads={uploads} />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
            <span className={cn(error && 'text-danger')} role={error ? 'alert' : undefined}>{error || T.replyHint(isMac())}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={FORUM_COPY.composer.pickFile} title={FORUM_COPY.composer.pickFile} onClick={() => file.current?.click()}><Paperclip size={15} /></Button>
              <input ref={file} type="file" multiple hidden onChange={e => { uploads.add([...(e.target.files ?? [])]); e.target.value = '' }} />
              <Button size="sm" className="h-7" disabled={busy} onClick={() => void send()}>{T.replyButton}</Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ReplyItem({ reply, postId, onChanged }: { reply: ForumReply; postId: string; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(reply.body)
  const save = async () => {
    if (!body.trim() && !reply.attachments.length) return toast.error(E.replyRequired)
    try { await forumAct('forum.editReply', { id: postId, replyId: reply.id, body }); toast.success(FORUM_COPY.composer.saved); setEditing(false); await onChanged() }
    catch (e) { toast.error(e instanceof Error ? e.message : E.unknown) }
  }
  return (
    <div className="group grid grid-cols-[22px_minmax(0,1fr)] gap-2.5">
      <Avatar user={reply.author} size={22} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium">{reply.author.name}</span>
          <span className="num text-muted-foreground">{relTime(reply.createdAt)}{reply.editedAt && ` · ${T.edited}`}</span>
          {reply.canEdit && !editing && <button type="button" onClick={() => setEditing(true)} className="text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100">{C.edit}</button>}
        </div>
        {editing
          ? <div className="mt-1 space-y-1.5">
              <textarea value={body} rows={3} onChange={e => setBody(e.target.value)} className="block w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <div className="flex gap-1.5"><Button size="sm" className="h-7" onClick={() => void save()}>{C.save}</Button><Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditing(false); setBody(reply.body) }}>{C.cancel}</Button></div>
            </div>
          : reply.body.trim() && <Markdown className="mt-0.5 text-[13px]">{reply.body}</Markdown>}
        <AttachmentList files={reply.attachments} showMeta={false} className="mt-2" />
      </div>
    </div>
  )
}
