'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowClockwise, DownloadSimple, Eye, SpinnerGap, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'
import type { ForumAttachmentView } from '@/shared/forum-files'
import { ImageViewer, type Pic } from '../ImageViewer'
import { canPreview, openPreview } from '../preview/preview'
import { extOf, fileSize } from './format'
import { newRequestId, uploadFile, type UploadTask } from './api'

const C = FORUM_COPY.common, D = FORUM_COPY.detail, U = FORUM_COPY.upload
const isImage = (f: Pick<ForumAttachmentView, 'mime' | 'name'>) => /^image\//.test(f.mime) || /\.(png|jpe?g|webp|gif)$/i.test(f.name)

export function FileCard({ name, size, line, previewable, onPreview, downloadUrl, className }: { name: string; size?: number; line?: string; previewable: boolean; onPreview: () => void; downloadUrl: string; className?: string }) {
  return (
    <div className={cn('grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2', className)}>
      <span className="num grid h-9 w-9 place-items-center rounded-md bg-muted text-[10px] font-medium uppercase text-muted-foreground">{extOf(name).slice(0, 4) || '?'}</span>
      <button type="button" disabled={!previewable} onClick={onPreview} className="min-w-0 text-left disabled:cursor-default">
        <div className="truncate text-[13px]" title={name}>{name}</div>
        <div className="num truncate text-[11px] text-muted-foreground">{line ?? (size != null ? fileSize(size) : '')}</div>
      </button>
      <div className="flex">
        {previewable && <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={C.preview} aria-label={`${C.preview} ${name}`} onClick={onPreview}><Eye size={15} /></Button>}
        <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0" title={C.download}><a href={downloadUrl} download={name} aria-label={`${C.download} ${name}`}><DownloadSimple size={15} /></a></Button>
      </div>
    </div>
  )
}

/** 帖子、回复、私信里的附件：图片排成缩略图点开看大图，其他文件给预览和下载。 */
export function AttachmentList({ files, showMeta = true, className }: { files: ForumAttachmentView[]; showMeta?: boolean; className?: string }) {
  const [index, setIndex] = useState<number | null>(null)
  const images = files.filter(isImage), others = files.filter(f => !isImage(f))
  const pics: Pic[] = images.map(f => ({ src: f.previewUrl, thumb: f.thumbnailUrl ?? undefined, download: f.downloadUrl, name: f.name }))
  if (!files.length) return null
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f, i) => (
            <button key={f.id} type="button" onClick={() => setIndex(i)} className="overflow-hidden rounded-lg border outline-none hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${C.preview} ${f.name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.thumbnailUrl ?? f.previewUrl} alt="" loading="lazy" className="h-24 w-24 object-cover sm:h-28 sm:w-28" />
            </button>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {others.map(f => (
            <FileCard key={f.id} name={f.name} size={f.size} downloadUrl={f.downloadUrl} previewable={canPreview(f.name, f.mime)}
              line={showMeta ? D.fileLine({ size: fileSize(f.size), version: f.version, latest: f.latest, downloads: f.downloads }) : fileSize(f.size)}
              onPreview={() => openPreview({ name: f.name, size: f.size, mime: f.mime, url: f.previewUrl, downloadUrl: f.downloadUrl })} />
          ))}
        </div>
      )}
      <ImageViewer pics={pics} index={index} onIndex={setIndex} />
    </div>
  )
}

const guessVersion = (name: string) => name.match(/v\d+(?:\.\d+)*/i)?.[0] ?? ''

/** 附件上传：加进来就开始传；Skill 的版本号改了会重新传一次（版本号在开始上传时登记）。 */
export function useUploads(initial: ForumAttachmentView[] = []) {
  const [tasks, setTasks] = useState<UploadTask[]>(() => initial.map(a => ({ key: a.id, file: new File([], a.name), name: a.name, size: a.size, version: a.version ?? '', progress: 100, status: 'done', attachment: a })))
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const patch = (key: string, p: Partial<UploadTask>) => alive.current && setTasks(list => list.map(t => t.key === key ? { ...t, ...p } : t))
  const start = useCallback((task: UploadTask) => {
    patch(task.key, { status: 'uploading', progress: 0, error: undefined })
    uploadFile(task.file, task.version, p => patch(task.key, { progress: p }))
      .then(a => patch(task.key, { status: 'done', progress: 100, attachment: a }))
      .catch(e => patch(task.key, { status: 'error', error: e instanceof Error ? e.message : FORUM_COPY.errors.unknown }))
  }, [])
  const add = useCallback((files: File[], withVersion = false) => {
    const next = files.map(f => ({ key: newRequestId(), file: f, name: f.name || '粘贴的图片.png', size: f.size, version: withVersion ? guessVersion(f.name) : '', progress: 0, status: 'uploading' as const }))
    setTasks(list => [...list, ...next])
    next.forEach(start)
  }, [start])
  const remove = (key: string) => setTasks(list => list.filter(t => t.key !== key))
  const retry = (key: string) => { const t = tasks.find(x => x.key === key); if (t) start(t) }
  const setVersion = (key: string, version: string) => {
    const t = tasks.find(x => x.key === key)
    if (!t || t.version === version) return
    const updated = { ...t, version }
    setTasks(list => list.map(x => x.key === key ? updated : x))
    if (t.file.size > 0 || !t.attachment) start(updated)
  }
  const reset = () => setTasks([])
  return {
    tasks, add, remove, retry, setVersion, reset,
    ids: tasks.filter(t => t.status === 'done' && t.attachment).map(t => t.attachment!.id),
    pending: tasks.some(t => t.status === 'uploading'),
    failed: tasks.some(t => t.status === 'error'),
  }
}

export function UploadChips({ uploads, versioned }: { uploads: ReturnType<typeof useUploads>; versioned?: boolean }) {
  if (!uploads.tasks.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {uploads.tasks.map(t => (
        <span key={t.key} className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs', t.status === 'error' && 'bg-danger/10 text-danger')} title={t.error}>
          {t.status === 'uploading' && <SpinnerGap size={12} className="animate-spin" />}
          <span className="max-w-[180px] truncate">{t.name}</span>
          <span className="num text-muted-foreground">{t.status === 'uploading' ? U.progress(t.progress) : fileSize(t.size)}</span>
          {versioned && t.status !== 'error' && (
            <input defaultValue={t.version} placeholder={FORUM_COPY.composer.versionPlaceholder} aria-label={FORUM_COPY.composer.versionPlaceholder}
              onBlur={e => uploads.setVersion(t.key, e.currentTarget.value.trim())}
              className="h-5 w-40 rounded border bg-card px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring" />
          )}
          {t.status === 'error' && <button type="button" onClick={() => uploads.retry(t.key)} className="grid h-5 w-5 place-items-center rounded-full hover:bg-danger/10" aria-label={C.retry} title={t.error}><ArrowClockwise size={12} /></button>}
          <button type="button" onClick={() => uploads.remove(t.key)} className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-accent" aria-label={`移除 ${t.name}`}><X size={11} /></button>
        </span>
      ))}
      {uploads.tasks.filter(t => t.status === 'error').slice(0, 1).map(t => <span key={t.key} role="alert" className="w-full text-xs text-danger">{t.error}</span>)}
    </div>
  )
}

/** 从粘贴、拖拽里拿文件 */
export const filesFrom = (data: DataTransfer | null) => data ? [...data.files] : []

export function ConfirmDialog({ open, title, body, ok, cancel = C.cancel, danger, onResult }: { open: boolean; title: string; body: string; ok: string; cancel?: string; danger?: boolean; onResult: (ok: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onResult(false)}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-sm gap-4">
        <div className="space-y-1.5"><DialogTitle className="text-base">{title}</DialogTitle><DialogDescription>{body}</DialogDescription></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onResult(false)}>{cancel}</Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={() => onResult(true)} autoFocus>{ok}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
