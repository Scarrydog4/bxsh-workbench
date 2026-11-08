'use client'

import { FORUM_COPY } from '@/shared/copy/forum'
import type { ForumCategory, ForumPostDetail, ForumPostList, ForumSort } from '@/shared/forum'
import type { DmMessagePage, DmPerson, DmThreadList } from '@/shared/dm'
import type { ForumAttachmentView } from '@/shared/forum-files'

/** 论坛和私信接口。写操作统一带 requestId；被拒绝时换新的 requestId 再提交。 */
export class ForumError extends Error { constructor(message: string, public status = 0) { super(message) } }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response
  try { r = await fetch(url, { cache: 'no-store', ...init }) } catch { throw new ForumError(FORUM_COPY.errors.network) }
  const data = await r.json().catch(() => ({}))
  if (r.status === 401) { window.location.reload(); throw new ForumError(FORUM_COPY.errors.forbidden, 401) }
  if (!r.ok) throw new ForumError(typeof data.error === 'string' ? data.error : FORUM_COPY.errors.unknown, r.status)
  return data as T
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const newRequestId = () => crypto.randomUUID()

/** 同一次操作重试时复用 requestId，服务器会返回第一次的结果，不会写两遍。 */
export async function forumAct<T = { id: string }>(name: string, payload: Record<string, unknown>, requestId = newRequestId()): Promise<T> {
  return call<T>(`/api/act/${name}`, json({ requestId, ...payload }))
}

export interface ListQuery { category?: ForumCategory; q?: string; sort?: ForumSort; offset?: number; limit?: number }
export function listPosts(query: ListQuery, signal?: AbortSignal) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v))
  return call<ForumPostList>(`/api/forum?${params}`, { signal })
}
export const getPost = (id: string, signal?: AbortSignal) => call<ForumPostDetail>(`/api/forum/${encodeURIComponent(id)}`, { signal })
export const deletePost = (id: string) => call<{ id: string }>(`/api/forum/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: newRequestId() }) })

export const listThreads = (signal?: AbortSignal) => call<DmThreadList>('/api/dm?limit=100', { signal })
export const listPeople = () => call<DmPerson[] | { rows: DmPerson[] }>('/api/dm/people').then(r => Array.isArray(r) ? r : r.rows)
export function getMessages(threadId: string, before?: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: '50' })
  if (before) params.set('before', before)
  return call<DmMessagePage>(`/api/dm/${encodeURIComponent(threadId)}/messages?${params}`, { signal })
}

// ---------- 附件上传：8MB 一片，断了查进度接着传 ----------

export interface UploadTask {
  key: string
  file: File
  name: string
  size: number
  version: string
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
  attachment?: ForumAttachmentView
}

const MAX = 500 * 1024 * 1024
const reasons = FORUM_COPY.upload.reasons

export async function uploadFile(file: File, version: string, onProgress: (percent: number) => void): Promise<ForumAttachmentView> {
  if (file.size > MAX) throw new ForumError(FORUM_COPY.errors.fileTooLarge)
  const name = file.name || `粘贴的图片.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`
  let init: { id: string; chunk: number; received: number; size: number }
  try {
    init = await call(`/api/forum/uploads`, json({ requestId: newRequestId(), name, size: file.size, mime: file.type || 'application/octet-stream', ...(version.trim() ? { version: version.trim() } : {}) }))
  } catch (e) { throw failure(e) }
  let received = init.received, mismatches = 0
  onProgress(file.size ? Math.round(received / file.size * 100) : 0)
  while (received < file.size) {
    let piece: ArrayBuffer
    try { piece = await file.slice(received, received + init.chunk).arrayBuffer() } catch { throw new ForumError(FORUM_COPY.upload.failed(reasons.read)) }
    let r: Response
    try { r = await fetch(`/api/forum/uploads/${init.id}?offset=${received}`, { method: 'PUT', body: piece, headers: { 'content-type': 'application/octet-stream' } }) }
    catch { throw new ForumError(FORUM_COPY.upload.failed(reasons.network)) }
    const data = await r.json().catch(() => ({}))
    if (r.status === 409 && data.code === 'UPLOAD_OFFSET_MISMATCH') {
      // 服务器记的进度为准，接着传；连续 3 次对不上才报错。
      if (++mismatches >= 3) throw new ForumError(FORUM_COPY.upload.failed(reasons.offset))
      received = Number(data.received) || 0
      continue
    }
    if (!r.ok) throw new ForumError(r.status >= 500 ? FORUM_COPY.upload.failed(reasons.server) : (data.error ?? FORUM_COPY.errors.unknown))
    mismatches = 0
    received = Number(data.received)
    onProgress(Math.round(received / file.size * 100))
  }
  try {
    const done = await call<ForumAttachmentView | { attachment: ForumAttachmentView }>(`/api/forum/uploads/${init.id}/complete`, json({ requestId: newRequestId() }))
    return 'attachment' in done ? done.attachment : done
  } catch (e) {
    if (file.type.startsWith('image/') && e instanceof ForumError && e.status === 400) throw new ForumError(FORUM_COPY.errors.imageBroken)
    throw failure(e)
  }
}
function failure(e: unknown) {
  if (e instanceof ForumError) return e.message === FORUM_COPY.errors.network ? new ForumError(FORUM_COPY.upload.failed(reasons.network)) : e.status >= 500 ? new ForumError(FORUM_COPY.upload.failed(reasons.server)) : e
  return new ForumError(FORUM_COPY.errors.unknown)
}

// ---------- 实时：store 收到 SSE 后在 window 上派发 ----------

export type LiveDetail = { type: 'post' | 'dm'; id: string }
export function onLive(type: 'post' | 'dm', fn: (id: string) => void) {
  const handler = (e: Event) => { const d = (e as CustomEvent<LiveDetail>).detail; if (d?.type === type) fn(d.id) }
  window.addEventListener('bxsh:forum-live', handler)
  return () => window.removeEventListener('bxsh:forum-live', handler)
}
