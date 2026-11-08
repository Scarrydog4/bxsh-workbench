'use client'

import { SelectField } from '../SelectField'
import { useRef, useState } from 'react'
import { Paperclip, TextB, TextItalic, TextHOne, ListBullets, ListNumbers, Quotes, Code, Table } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'
import { FORUM_CATEGORIES, type ForumCategory, type ForumPostDetail } from '@/shared/forum'
import type { FeedbackKind } from '@/shared/feedback'
import { Segmented } from '../controls'
import { useSession } from '../store'
import { forumAct, newRequestId } from './api'
import { ConfirmDialog, UploadChips, filesFrom, useUploads } from './Attachments'
import { Markdown } from './Markdown'

const W = FORUM_COPY.composer, E = FORUM_COPY.errors, F = FORUM_COPY.forum
const field = 'h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring'

const TOOLS: { key: keyof typeof W.toolbar; icon: React.ReactNode; wrap: [string, string] }[] = [
  { key: 'bold', icon: <TextB size={15} />, wrap: ['**', '**'] },
  { key: 'italic', icon: <TextItalic size={15} />, wrap: ['*', '*'] },
  { key: 'heading', icon: <TextHOne size={15} />, wrap: ['\n## ', ''] },
  { key: 'list', icon: <ListBullets size={15} />, wrap: ['\n- ', ''] },
  { key: 'ordered', icon: <ListNumbers size={15} />, wrap: ['\n1. ', ''] },
  { key: 'quote', icon: <Quotes size={15} />, wrap: ['\n> ', ''] },
  { key: 'code', icon: <Code size={15} />, wrap: ['`', '`'] },
  { key: 'table', icon: <Table size={15} />, wrap: ['\n| 列 | 列 |\n|---|---|\n|  |  |\n', ''] },
]

/** Markdown 编辑区：工具栏 + 编辑 / 预览；粘贴或拖进来的文件交给 onFiles。 */
export function MarkdownEditor({ id, value, onChange, placeholder, onFiles, minRows = 9 }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; onFiles: (files: File[]) => void; minRows?: number }) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const ref = useRef<HTMLTextAreaElement>(null)
  const insert = ([a, b]: [string, string]) => {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart, e = el.selectionEnd, sel = value.slice(s, e)
    onChange(value.slice(0, s) + a + sel + b + value.slice(e))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + a.length, s + a.length + sel.length) })
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring">
      <div role="toolbar" aria-label={W.fields.body} className="flex flex-wrap items-center gap-0.5 border-b bg-muted/50 px-1.5 py-1">
        {TOOLS.map(t => <button key={t.key} type="button" disabled={tab !== 'edit'} title={W.toolbar[t.key]} aria-label={W.toolbar[t.key]} onClick={() => insert(t.wrap)} className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">{t.icon}</button>)}
        <Segmented size="sm" className="ml-auto" label={W.fields.body} value={tab} onChange={setTab} items={[['edit', W.tabEdit], ['preview', W.tabPreview]]} />
      </div>
      {tab === 'edit'
        ? <textarea id={id} ref={ref} value={value} rows={minRows} placeholder={placeholder} onChange={e => onChange(e.target.value)}
            onPaste={e => { const f = filesFrom(e.clipboardData); if (f.length) { e.preventDefault(); onFiles(f) } }}
            className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[13px] leading-relaxed outline-none" />
        : <div className="min-h-[200px] px-3 py-2.5">{value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-muted-foreground">{W.noBody}</p>}</div>}
    </div>
  )
}

/** 发帖 / 编辑帖子。 */
export function Composer({ post, defaultCategory, onClose, onSaved }: { post?: ForumPostDetail; defaultCategory?: ForumCategory; onClose: () => void; onSaved: (id: string) => void }) {
  const { can, role } = useSession()
  const boss = role.locked
  const canAnnounce = boss && can('forum.announce')
  const start: ForumCategory = post?.category ?? (defaultCategory && (defaultCategory !== 'announcement' || canAnnounce) ? defaultCategory : 'feedback')
  const [category, setCategory] = useState<ForumCategory>(start)
  const [kind, setKind] = useState<FeedbackKind>(post?.feedbackKind ?? '问题')
  const [priv, setPriv] = useState(post?.private ?? false)
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [over, setOver] = useState(false)
  const uploads = useUploads(post?.attachments)
  const requestId = useRef(newRequestId())
  const initial = useRef(JSON.stringify([post?.title ?? '', post?.body ?? '', post?.attachments.length ?? 0]))
  const dirty = JSON.stringify([title, body, uploads.tasks.length]) !== initial.current
  const fileInput = useRef<HTMLInputElement>(null)
  // 员工不能把已经发出的反馈挪去别的分类（会重置处理状态）
  const categoryLocked = !!post && post.category === 'feedback' && !boss

  const tryClose = () => { if (dirty && !busy) setLeaving(true); else onClose() }
  const submit = async () => {
    if (busy) return
    if (!title.trim()) return setError(E.titleRequired)
    if ([...title.trim()].length > 200) return setError(E.titleTooLong)
    if ([...body].length > 20000) return setError(E.bodyTooLong)
    if (uploads.pending || uploads.failed) return setError(E.uploadPending)
    setBusy(true); setError('')
    const payload = { category, title: title.trim(), body, attachmentIds: uploads.ids, ...(category === 'feedback' ? { feedbackKind: kind, private: priv } : {}) }
    try {
      const r = post
        ? await forumAct<{ id: string }>('forum.edit', { id: post.id, ...payload }, requestId.current)
        : await forumAct<{ id: string }>('forum.create', payload, requestId.current)
      toast.success(post ? W.saved : W.published)
      onSaved(r.id ?? post!.id)
    } catch (e) {
      requestId.current = newRequestId()
      setError(e instanceof Error ? e.message : E.unknown)
    } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={o => !o && tryClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-2xl flex-col gap-0 overflow-hidden p-0" onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit() } }}>
        <div className="border-b px-5 py-3.5"><DialogTitle className="text-base">{post ? W.titleEdit : W.titleNew}</DialogTitle></div>
        <div className={cn('flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4', over && 'bg-primary/5')}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); uploads.add(filesFrom(e.dataTransfer), category === 'skill') }}>
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-[150px] flex-1 flex-col gap-1.5 text-xs text-muted-foreground">{W.fields.category}
              <SelectField value={category} disabled={categoryLocked} onChange={e => setCategory(e.target.value as ForumCategory)} className={field}>
                {FORUM_CATEGORIES.map(c => <option key={c} value={c} disabled={c === 'announcement' && !canAnnounce}>{c === 'announcement' && !canAnnounce ? W.announcementLocked : FORUM_COPY.categories[c]}</option>)}
              </SelectField>
            </label>
            {category === 'feedback' && <>
              <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">{W.fields.kind}
                <Segmented label={W.fields.kind} value={kind} onChange={setKind} items={F.kinds.map(k => [k, k] as const)} />
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">{W.fields.visibility}
                <label className="flex h-9 items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={priv} onChange={e => setPriv(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />{W.onlyBoss}</label>
              </div>
            </>}
          </div>
          <input aria-label={W.fields.title} value={title} maxLength={200} autoFocus onChange={e => { setTitle(e.target.value); setError('') }} placeholder={W.titlePlaceholder[category]} className={field} />
          <MarkdownEditor id="forum-body" value={body} onChange={setBody} placeholder={W.bodyPlaceholder} onFiles={f => uploads.add(f, category === 'skill')} />
          <div className="flex flex-col gap-1.5">
            <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', over && 'text-primary')}>
              <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={W.pickFile} title={W.pickFile} onClick={() => fileInput.current?.click()}><Paperclip size={16} aria-hidden/></Button>
              {over ? FORUM_COPY.upload.dropOver : category === 'skill' ? W.skillTip : ''}
              <input ref={fileInput} type="file" multiple hidden onChange={e => { uploads.add([...(e.target.files ?? [])], category === 'skill'); e.target.value = '' }} />
            </div>
            <UploadChips uploads={uploads} versioned={category === 'skill'} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <span className={cn('text-xs', error ? 'text-danger' : 'text-muted-foreground')} role={error ? 'alert' : undefined}>{error || W.footHint}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={tryClose}>{FORUM_COPY.common.cancel}</Button>
            <Button onClick={() => void submit()} disabled={busy}>{post ? FORUM_COPY.common.save : FORUM_COPY.common.publish}</Button>
          </div>
        </div>
        <ConfirmDialog open={leaving} title={W.leaveTitle} body={W.leaveBody} ok={W.leaveDrop} cancel={W.leaveKeep} danger onResult={ok => { setLeaving(false); if (ok) onClose() }} />
      </DialogContent>
    </Dialog>
  )
}
