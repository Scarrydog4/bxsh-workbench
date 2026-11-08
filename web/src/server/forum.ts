import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql as dsql, type SQL } from 'drizzle-orm'
import { avatarFrame } from '@/shared/avatar-frames'
import { fuzzySearchSql } from './search'
import { FORUM_COPY } from '@/shared/copy/forum'
import { can } from '@/shared/perm'
import type { ForumAuthor, ForumCategory, ForumPostDetail, ForumPostList, ForumPostSummary, ForumSort } from '@/shared/forum'
import type { FeedbackKind, FeedbackStatus } from '@/shared/feedback'
import { db, type Tx } from './db'
import { forumAttachmentViews } from './forum-files'
import { deny, notFound } from './http'
import type { World } from './repo'
import type { Ctx } from './session'
import { audit, forumAttachments, forumPosts, forumReplies, notifications, users } from './schema'

export type ForumPostRow = typeof forumPosts.$inferSelect
export const canManageForum = (c: Ctx) => c.role.locked && can(c.role, 'forum.manage')
export const canAnnounceForum = (c: Ctx) => c.role.locked && can(c.role, 'forum.announce')

export function canViewForumPost(row: Pick<ForumPostRow, 'private' | 'authorId' | 'deletedAt'>, c: Ctx, options: { includeDeleted?: boolean } = {}) {
  if (row.deletedAt && !(options.includeDeleted && canManageForum(c))) return false
  return !row.private || row.authorId === c.me.id || canManageForum(c)
}

/** 所有读取路径共用相同条件，避免列表、搜索和直接读取的可见范围不一致。 */
export function forumPostVisibility(c: Ctx, includeDeleted = false): SQL {
  return and(
    includeDeleted && canManageForum(c) ? undefined : isNull(forumPosts.deletedAt),
    canManageForum(c) ? undefined : or(eq(forumPosts.private, false), eq(forumPosts.authorId, c.me.id)),
  ) ?? dsql`true`
}

export function forumAudience(row: Pick<ForumPostRow, 'private' | 'authorId' | 'deletedAt'>, w: World): string[] {
  if (row.deletedAt) return []
  return w.users.filter(u => u.active && (!row.private || u.id === row.authorId || w.roles.some(r => r.id === u.roleId && r.locked))).map(u => u.id)
}

/** 审计权限不能绕过私密帖的可见范围。论坛回复的审计 objectId 也存所属帖 id。 */
export function forumAuditVisibility(c: Ctx) {
  return canManageForum(c) ? undefined : dsql`(
    ${audit.objectType} <> 'forum' OR EXISTS (
      SELECT 1 FROM ${forumPosts} WHERE ${forumPosts.id} = ${audit.objectId} AND ${forumPostVisibility(c)}
    )
  )`
}

/** 提醒发出后仍按当前帖子权限过滤；帖子被改为私密或删除时旧提醒不能泄露内容。 */
export function forumNotificationVisibility(c: Ctx) {
  return dsql`(
    ${notifications.tab} IS NULL OR ${notifications.tab} NOT LIKE 'page:forum:%' OR EXISTS (
      SELECT 1 FROM ${forumPosts} WHERE ('page:forum:' || ${forumPosts.id}) = ${notifications.tab} AND ${forumPostVisibility(c)}
    )
  )`
}

export async function forumPostFor(tx: Tx | typeof db, c: Ctx, id: string, includeDeleted = false): Promise<ForumPostRow> {
  const [post] = await tx.select().from(forumPosts).where(and(eq(forumPosts.id, id), forumPostVisibility(c, includeDeleted)))
  if (!post) throw notFound(FORUM_COPY.errors.notFound)
  return post
}

async function authors(tx: Tx | typeof db, ids: string[]): Promise<Map<string, ForumAuthor>> {
  if (!ids.length) return new Map()
  const people = await tx.select({ id: users.id, name: users.name, hue: users.hue, avatar: users.avatar, frame: users.avatarFrame }).from(users).where(inArray(users.id, [...new Set(ids)]))
  return new Map(people.map(person => [person.id, { ...person, avatar: person.avatar ?? undefined, frame: avatarFrame(person.frame) }]))
}

/** 附件计数包含帖子本身和未删除回复的附件；不包括草稿上传和已移除附件。 */
export function forumAttachmentScope() {
  return dsql`(
    (${forumAttachments.ownerKind} = 'post' AND ${forumAttachments.ownerId} = ${forumPosts.id}) OR
    (${forumAttachments.ownerKind} = 'reply' AND EXISTS (
      SELECT 1 FROM ${forumReplies} WHERE ${forumReplies.id} = ${forumAttachments.ownerId}
        AND ${forumReplies.postId} = ${forumPosts.id} AND ${forumReplies.deletedAt} IS NULL
    ))
  )`
}

async function summaries(tx: Tx | typeof db, c: Ctx, rows: ForumPostRow[]): Promise<ForumPostSummary[]> {
  if (!rows.length) return []
  const ids = rows.map(row => row.id)
  const [people, aggregates] = await Promise.all([
    authors(tx, rows.map(row => row.authorId)),
    tx.select({
      id: forumPosts.id,
      // Drizzle strips table prefixes in SELECT expressions; explicit aliases keep correlated subqueries scoped to the outer post.
      replyCount: dsql<number>`(SELECT count(*)::int FROM forum_replies fr WHERE fr.post_id = forum_posts.id AND fr.deleted_at IS NULL)`,
      attachmentCount: dsql<number>`(SELECT count(*)::int FROM forum_attachments fa WHERE fa.deleted_at IS NULL AND (
        (fa.owner_kind = 'post' AND fa.owner_id = forum_posts.id) OR (fa.owner_kind = 'reply' AND EXISTS (
          SELECT 1 FROM forum_replies fr WHERE fr.id = fa.owner_id AND fr.post_id = forum_posts.id AND fr.deleted_at IS NULL
        ))
      ))`,
      likeCount: dsql<number>`(SELECT count(*)::int FROM forum_likes fl WHERE fl.post_id = forum_posts.id)`,
      liked: dsql<boolean>`EXISTS (SELECT 1 FROM forum_likes fl WHERE fl.post_id = forum_posts.id AND fl.user_id = ${c.me.id})`,
      unread: dsql<boolean>`NOT EXISTS (SELECT 1 FROM forum_reads fr WHERE fr.post_id = forum_posts.id AND fr.user_id = ${c.me.id} AND fr.read_at >= forum_posts.updated_at)`,
    }).from(forumPosts).where(inArray(forumPosts.id, ids)),
  ])
  const counts = new Map(aggregates.map(row => [row.id, row]))
  return rows.map(row => {
    const author = people.get(row.authorId)
    if (!author) throw notFound(FORUM_COPY.errors.notFound)
    return {
      id: row.id, no: row.no, category: row.category, authorId: row.authorId, author,
      title: row.title, excerpt: row.body.slice(0, 200), feedbackKind: row.feedbackKind, status: row.status,
      private: row.private, pinned: row.pinned, createdAt: row.createdAt, updatedAt: row.updatedAt,
      lastActivityAt: row.lastActivityAt, editedAt: row.editedAt, deletedAt: row.deletedAt,
      replyCount: counts.get(row.id)?.replyCount ?? 0, attachmentCount: counts.get(row.id)?.attachmentCount ?? 0,
      likeCount: counts.get(row.id)?.likeCount ?? 0, liked: counts.get(row.id)?.liked ?? false, unread: counts.get(row.id)?.unread ?? true,
      canEdit: !row.deletedAt && (row.authorId === c.me.id || canManageForum(c)), canDelete: !row.deletedAt && (row.authorId === c.me.id || canManageForum(c)), canManage: canManageForum(c),
    }
  })
}

export interface ForumListOptions {
  category?: ForumCategory; q?: string; sort?: ForumSort; offset?: number; limit?: number
  status?: FeedbackStatus; feedbackKind?: FeedbackKind; deleted?: boolean
}

export async function listForumPosts(c: Ctx, opts: ForumListOptions = {}): Promise<ForumPostList> {
  if (opts.deleted && !canManageForum(c)) throw deny(FORUM_COPY.errors.forbidden)
  const offset = opts.offset ?? 0, limit = opts.limit ?? 50
  const filters: SQL[] = [forumPostVisibility(c, !!opts.deleted)]
  if (opts.deleted) filters.push(isNotNull(forumPosts.deletedAt))
  if (opts.category) filters.push(eq(forumPosts.category, opts.category))
  if (opts.status) filters.push(eq(forumPosts.status, opts.status))
  if (opts.feedbackKind) filters.push(eq(forumPosts.feedbackKind, opts.feedbackKind))
  if (opts.q) filters.push(fuzzySearchSql(opts.q, [forumPosts.title, forumPosts.body, dsql`(
    SELECT string_agg(${forumAttachments.name}, ' ') FROM ${forumAttachments}
    WHERE ${forumAttachments.deletedAt} IS NULL AND ${forumAttachmentScope()}
  )`])!)
  const [rows, [total], pending] = await Promise.all([
    db.select().from(forumPosts).where(and(...filters)).orderBy(desc(forumPosts.pinned), desc(opts.sort === 'created' ? forumPosts.createdAt : forumPosts.lastActivityAt), desc(forumPosts.id)).limit(limit).offset(offset),
    db.select({ value: count() }).from(forumPosts).where(and(...filters)),
    canManageForum(c) ? db.select({ value: count() }).from(forumPosts).where(and(isNull(forumPosts.deletedAt), eq(forumPosts.category, 'feedback'), eq(forumPosts.status, '待处理'))) : Promise.resolve([]),
  ])
  return { rows: await summaries(db, c, rows), total: total.value, next: offset + rows.length < total.value ? offset + rows.length : null, ...(canManageForum(c) ? { pendingFeedbackCount: pending[0]?.value ?? 0 } : {}) }
}

/** 读取详情不标记已读；前端确认展示后显式调用 forum.read。 */
export async function getForumPost(c: Ctx, id: string, includeDeleted = false): Promise<ForumPostDetail> {
  const post = await forumPostFor(db, c, id, includeDeleted)
  const [summary, replyRows, attachments] = await Promise.all([
    summaries(db, c, [post]),
    db.select().from(forumReplies).where(and(eq(forumReplies.postId, id), isNull(forumReplies.deletedAt))).orderBy(asc(forumReplies.createdAt), asc(forumReplies.id)),
    forumAttachmentViews(db, 'post', id),
  ])
  const people = await authors(db, replyRows.map(reply => reply.authorId))
  const replies = await Promise.all(replyRows.map(async reply => {
    const author = people.get(reply.authorId)
    if (!author) throw notFound(FORUM_COPY.errors.notFound)
    return { id: reply.id, postId: id, authorId: reply.authorId, author, body: reply.body, createdAt: reply.createdAt, editedAt: reply.editedAt, attachments: await forumAttachmentViews(db, 'reply', reply.id), canEdit: !post.deletedAt && (reply.authorId === c.me.id || canManageForum(c)) }
  }))
  return { ...summary[0], body: post.body, attachments, replies }
}
