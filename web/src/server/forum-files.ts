import { unlink } from 'node:fs/promises'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { DB, Tx } from './db'
import { db } from './db'
import * as t from './schema'
import type { Ctx } from './session'
import { notFound } from './http'
import { can } from '@/shared/perm'
import { FORUM_COPY } from '@/shared/copy/forum'
import type { ForumAttachmentView } from '@/shared/forum-files'

type Kind = 'post' | 'reply' | 'dm'
type Attachment = typeof t.forumAttachments.$inferSelect
const missing = () => notFound(FORUM_COPY.errors.notFound)

async function visiblePost(q: DB | Tx, id: string, c: Ctx) {
  const [post] = await q.select().from(t.forumPosts).where(and(eq(t.forumPosts.id,id),isNull(t.forumPosts.deletedAt)))
  return post && (!post.private || post.authorId === c.me.id || c.role.locked) ? post : null
}

/** Pending uploads stay private to the uploader; every bound file inherits its current parent visibility. */
export async function canReadForumAttachment(q: DB | Tx, f: Attachment, c: Ctx): Promise<boolean> {
  if (f.deletedAt) return false
  if (!f.ownerKind || !f.ownerId) return !f.ownerKind && !f.ownerId && f.uploadedBy === c.me.id
  if (f.ownerKind === 'post') return !!await visiblePost(q,f.ownerId,c)
  if (f.ownerKind === 'reply') {
    const [reply] = await q.select().from(t.forumReplies).where(and(eq(t.forumReplies.id,f.ownerId),isNull(t.forumReplies.deletedAt)))
    return !!reply && !!await visiblePost(q,reply.postId,c)
  }
  const [row] = await q.select({ message: t.dmMessages, thread: t.dmThreads }).from(t.dmMessages)
    .innerJoin(t.dmThreads,eq(t.dmMessages.threadId,t.dmThreads.id))
    .where(and(eq(t.dmMessages.id,f.ownerId),isNull(t.dmMessages.retractedAt)))
  return !!row && (row.thread.participantA === c.me.id || row.thread.participantB === c.me.id || c.role.locked && can(c.role,'dm.viewAll'))
}

export function forumAttachmentView(f: Attachment, latest = false): ForumAttachmentView {
  const url = `/api/forum/files/${encodeURIComponent(f.id)}`
  return { id:f.id,name:f.name,size:f.size,mime:f.mime,version:f.version,downloads:f.downloads,createdAt:f.createdAt,
    downloadUrl:url,previewUrl:`${url}?inline=1`,thumbnailUrl:f.thumbPath?`${url}?thumb=1`:null,latest }
}

/** Caller must authorize the parent before listing. Do not expose storage paths to clients. */
export async function forumAttachmentViews(q: DB | Tx, kind: Kind, id: string): Promise<ForumAttachmentView[]> {
  const files = await q.select().from(t.forumAttachments).where(and(eq(t.forumAttachments.ownerKind,kind),eq(t.forumAttachments.ownerId,id),isNull(t.forumAttachments.deletedAt)))
    .orderBy(desc(t.forumAttachments.createdAt),desc(t.forumAttachments.id))
  const latest = kind === 'post' ? files.find(f => !!f.version)?.id : undefined
  return files.map(f => forumAttachmentView(f,f.id === latest))
}

/** Only the uploader can claim a pending attachment; rebinding a file to another parent is forbidden. */
export async function bindForumAttachments(tx: Tx, c: Ctx, ids: string[], owner: {kind:Kind;id:string}) {
  if (!ids.length) return
  if (owner.kind === 'post') {
    const post = await visiblePost(tx,owner.id,c)
    if (!post || post.authorId !== c.me.id && !(c.role.locked && can(c.role,'forum.manage'))) throw missing()
  } else if (owner.kind === 'reply') {
    const [reply] = await tx.select().from(t.forumReplies).where(and(eq(t.forumReplies.id,owner.id),isNull(t.forumReplies.deletedAt)))
    if (!reply || !await visiblePost(tx,reply.postId,c) || reply.authorId !== c.me.id && !(c.role.locked && can(c.role,'forum.manage'))) throw missing()
  } else {
    const [row] = await tx.select({ message:t.dmMessages,thread:t.dmThreads }).from(t.dmMessages).innerJoin(t.dmThreads,eq(t.dmThreads.id,t.dmMessages.threadId))
      .where(and(eq(t.dmMessages.id,owner.id),isNull(t.dmMessages.retractedAt)))
    if (!row || row.message.senderId !== c.me.id || row.thread.participantA !== c.me.id && row.thread.participantB !== c.me.id) throw missing()
  }
  const unique = [...new Set(ids)]
  const files = await tx.select().from(t.forumAttachments).where(and(inArray(t.forumAttachments.id,unique),isNull(t.forumAttachments.deletedAt))).for('update')
  if (files.length !== unique.length || files.some(f => f.ownerKind || f.ownerId ? f.ownerKind !== owner.kind || f.ownerId !== owner.id : f.uploadedBy !== c.me.id)) throw missing()
  await tx.update(t.forumAttachments).set({ownerKind:owner.kind,ownerId:owner.id}).where(inArray(t.forumAttachments.id,unique))
}

/** Transactional tombstones first: a failed transaction must not destroy live files. */
export async function retractDmAttachments(tx: Tx, messageId: string) {
  await tx.update(t.forumAttachments).set({deletedAt:new Date().toISOString()})
    .where(and(eq(t.forumAttachments.ownerKind,'dm'),eq(t.forumAttachments.ownerId,messageId),isNull(t.forumAttachments.deletedAt)))
}

/** Called after commit, including retries. Tombstones persist so failed unlinks remain retryable. */
export async function cleanupRetractedDmAttachments(messageId: string) {
  const [message] = await db.select().from(t.dmMessages).where(and(eq(t.dmMessages.id,messageId),isNotNull(t.dmMessages.retractedAt)))
  if (!message) return
  const files = await db.select().from(t.forumAttachments).where(and(eq(t.forumAttachments.ownerKind,'dm'),eq(t.forumAttachments.ownerId,messageId),isNotNull(t.forumAttachments.deletedAt)))
  const uploads = files.length ? await db.select({path:t.forumUploads.path}).from(t.forumUploads).where(inArray(t.forumUploads.attachmentId,files.map(f=>f.id))) : []
  const paths = new Set([...files.flatMap(f=>[f.path,f.thumbPath]),...uploads.map(u=>u.path)].filter((p):p is string=>!!p))
  for (const path of paths) {
    await unlink(path).catch((error:NodeJS.ErrnoException)=>{ if(error.code!=='ENOENT')throw error })
  }
}
