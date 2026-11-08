import { and, count, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { FORUM_COPY } from '@/shared/copy/forum'
import { plainText, takeChars } from '@/shared/plain-text'
import { FEEDBACK_KINDS, FEEDBACK_STATUSES } from '@/shared/feedback'
import { businessDate } from '@/shared/format'
import { FORUM_CATEGORIES } from '@/shared/forum'
import { act, log } from './actions'
import type { Tx } from './db'
import { bindForumAttachments } from './forum-files'
import { canAnnounceForum, canManageForum, forumAudience, forumPostFor } from './forum'
import { bad, deny, notFound } from './http'
import { uid } from './ids'
import { notify } from './notify'
import type { Ctx } from './session'
import { counters, forumAttachments, forumLikes, forumPosts, forumReads, forumReplies, notifications } from './schema'

const unknown = FORUM_COPY.errors.unknown
const requestId = z.uuid({ error: unknown })
const id = z.string({ error: unknown }).min(1, unknown).max(150, unknown)
const body = z.string({ error: unknown }).max(20_000, FORUM_COPY.errors.bodyTooLong)
const title = z.string({ error: FORUM_COPY.errors.titleRequired }).trim().min(1, FORUM_COPY.errors.titleRequired).max(200, unknown)
const attachments = z.array(id, { error: unknown }).max(100, unknown)
const feedbackKind = z.enum(FEEDBACK_KINDS, { error: unknown })
const category = z.enum(FORUM_CATEGORIES, { error: unknown })
const flag = z.boolean({ error: unknown })
const postInput = z.object({ requestId, id })

async function nextForumNo(tx: Tx) {
  const [counter] = await tx.insert(counters).values({ name: 'forum_serial', value: 1 }).onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } }).returning()
  return `FT${businessDate(new Date()).replaceAll('-', '')}${String(counter.value).padStart(4, '0')}`
}

async function setAttachments(tx: Tx, c: Ctx, ids: string[] | undefined, owner: { kind: 'post' | 'reply'; id: string }) {
  if (!ids) return
  const unique = [...new Set(ids)]
  await bindForumAttachments(tx, c, unique, owner)
  await tx.update(forumAttachments).set({ deletedAt: new Date().toISOString() }).where(and(
    eq(forumAttachments.ownerKind, owner.kind), eq(forumAttachments.ownerId, owner.id), isNull(forumAttachments.deletedAt),
    unique.length ? notInArray(forumAttachments.id, unique) : undefined,
  ))
}

async function markRead(tx: Tx, c: Ctx, postId: string, readAt: string) {
  await tx.insert(forumReads).values({ postId, userId: c.me.id, readAt }).onConflictDoUpdate({ target: [forumReads.postId, forumReads.userId], set: { readAt } })
}

const result = (id: string) => ({ id, postId: id })

/** requestId 的去重、内容签名检查及提交后定向 SSE 由 runAction 统一执行。 */
export const FORUM_ACTIONS = {
  'forum.create': act({
    quiet: true,
    schema: z.object({ requestId, category, title, body: body.default(''), feedbackKind: feedbackKind.optional(), private: flag.default(false), attachmentIds: attachments.default([]) }),
    run: async (tx, c, w, input) => {
      if (input.category === 'announcement' && !canAnnounceForum(c)) throw deny(FORUM_COPY.errors.announce)
      if (input.category !== 'feedback' && (input.private || input.feedbackKind)) throw bad(unknown)
      const postId = uid('fp'), now = new Date().toISOString()
      const [post] = await tx.insert(forumPosts).values({
        id: postId, no: await nextForumNo(tx), authorId: c.me.id, category: input.category, title: input.title, body: input.body,
        feedbackKind: input.category === 'feedback' ? input.feedbackKind ?? '问题' : null,
        status: input.category === 'feedback' ? '待处理' : null, private: input.category === 'feedback' && input.private,
        createdAt: now, updatedAt: now, lastActivityAt: now,
      }).returning()
      await setAttachments(tx, c, input.attachmentIds, { kind: 'post', id: postId })
      await markRead(tx, c, postId, now)
      await log(tx, c, { action: 'forum.create', objectType: 'forum', objectId: postId, objectLabel: post.title, to: JSON.stringify({ category: post.category, private: post.private }), note: post.body })
      if (post.category === 'announcement') await notify(tx, forumAudience(post, w), {
        kind: FORUM_COPY.categories.announcement, tab: `page:forum:${postId}`, title: FORUM_COPY.notify.announcementTitle(post.title), body: takeChars(plainText(post.body), 60), actorId: c.me.id, key: `forum:announcement:${postId}`,
      })
      return result(postId)
    },
  }),
  'forum.edit': act({
    quiet: true,
    schema: z.object({ requestId, id, category: category.optional(), title: title.optional(), body: body.optional(), feedbackKind: feedbackKind.optional(), private: flag.optional(), attachmentIds: attachments.optional() }),
    run: async (tx, c, w, input) => {
      const before = await forumPostFor(tx, c, input.id)
      if (before.authorId !== c.me.id && !canManageForum(c)) throw deny(FORUM_COPY.errors.edit)
      const nextCategory = input.category ?? before.category
      // 员工不能通过移出反馈再移回来，把老板设定的处理状态重置为待处理。
      if (before.category === 'feedback' && nextCategory !== 'feedback' && !canManageForum(c)) throw deny(FORUM_COPY.errors.manage)
      if (nextCategory === 'announcement' && !canAnnounceForum(c)) throw deny(FORUM_COPY.errors.announce)
      if (nextCategory !== 'feedback' && (input.private || input.feedbackKind)) throw bad(unknown)
      const now = new Date().toISOString()
      const [post] = await tx.update(forumPosts).set({
        category: nextCategory, title: input.title ?? before.title, body: input.body ?? before.body,
        private: nextCategory === 'feedback' ? input.private ?? before.private : false,
        feedbackKind: nextCategory === 'feedback' ? input.feedbackKind ?? before.feedbackKind ?? '问题' : null,
        status: nextCategory === 'feedback' ? before.status ?? '待处理' : null, updatedAt: now, editedAt: now,
      }).where(eq(forumPosts.id, before.id)).returning()
      await setAttachments(tx, c, input.attachmentIds, { kind: 'post', id: post.id })
      await markRead(tx, c, post.id, now)
      // 公开反馈改成私密后，历史提醒也立即收回。
      if (post.private) {
        const allowed = forumAudience(post, w)
        await tx.delete(notifications).where(and(eq(notifications.tab, `page:forum:${post.id}`), allowed.length ? notInArray(notifications.userId, allowed) : undefined))
      }
      await log(tx, c, { action: 'forum.edit', objectType: 'forum', objectId: post.id, objectLabel: post.title, from: JSON.stringify({ title: before.title, body: before.body, category: before.category, private: before.private, editedAt: before.editedAt }), to: JSON.stringify({ title: post.title, body: post.body, category: post.category, private: post.private, editedAt: now }), note: JSON.stringify({ attachmentIds: input.attachmentIds, feedbackKind: input.feedbackKind }) })
      return result(post.id)
    },
  }),
  'forum.delete': act({
    quiet: true, schema: postInput,
    run: async (tx, c, _w, input) => {
      const post = await forumPostFor(tx, c, input.id)
      if (post.authorId !== c.me.id && !canManageForum(c)) throw deny(FORUM_COPY.errors.pinDelete)
      const now = new Date().toISOString()
      await tx.update(forumPosts).set({ deletedAt: now, updatedAt: now }).where(eq(forumPosts.id, post.id))
      await tx.delete(notifications).where(eq(notifications.tab, `page:forum:${post.id}`))
      await log(tx, c, { action: 'forum.delete', objectType: 'forum', objectId: post.id, objectLabel: post.title })
      // 子记录和文件保留，读取都检查父帖 deletedAt，以便老板在回收站原样恢复。
      return result(post.id)
    },
  }),
  'forum.restore': act({
    quiet: true, schema: postInput,
    run: async (tx, c, _w, input) => {
      if (!canManageForum(c)) throw deny(FORUM_COPY.errors.forbidden)
      const post = await forumPostFor(tx, c, input.id, true)
      if (!post.deletedAt) return result(post.id)
      await tx.update(forumPosts).set({ deletedAt: null, updatedAt: new Date().toISOString() }).where(eq(forumPosts.id, post.id))
      await log(tx, c, { action: 'forum.restore', objectType: 'forum', objectId: post.id, objectLabel: post.title })
      return result(post.id)
    },
  }),
  'forum.pin': act({
    quiet: true, schema: postInput.extend({ pinned: flag }),
    run: async (tx, c, _w, input) => {
      if (!canManageForum(c)) throw deny(FORUM_COPY.errors.pinDelete)
      const post = await forumPostFor(tx, c, input.id)
      await tx.update(forumPosts).set({ pinned: input.pinned }).where(eq(forumPosts.id, post.id))
      await log(tx, c, { action: 'forum.pin', objectType: 'forum', objectId: post.id, objectLabel: post.title, from: String(post.pinned), to: String(input.pinned) })
      return result(post.id)
    },
  }),
  'forum.status': act({
    quiet: true, schema: postInput.extend({ status: z.enum(FEEDBACK_STATUSES, { error: unknown }) }),
    run: async (tx, c, _w, input) => {
      if (!canManageForum(c)) throw deny(FORUM_COPY.errors.manage)
      const post = await forumPostFor(tx, c, input.id)
      if (post.category !== 'feedback') throw bad(unknown)
      if (post.status === input.status) return result(post.id)
      await tx.update(forumPosts).set({ status: input.status, updatedAt: new Date().toISOString() }).where(eq(forumPosts.id, post.id))
      await log(tx, c, { action: 'forum.status', objectType: 'forum', objectId: post.id, objectLabel: post.title, from: post.status ?? '', to: input.status })
      await notify(tx, [post.authorId], { kind: FORUM_COPY.categories.feedback, tab: `page:forum:${post.id}`, title: FORUM_COPY.notify.statusTitle(input.status), body: FORUM_COPY.notify.statusBody(post.title), actorId: c.me.id })
      return result(post.id)
    },
  }),
  'forum.reply': act({
    quiet: true,
    schema: postInput.extend({ body: body.default(''), attachmentIds: attachments.default([]) }).refine(input => !!input.body.trim() || input.attachmentIds.length > 0, unknown),
    run: async (tx, c, _w, input) => {
      const post = await forumPostFor(tx, c, input.id), now = new Date().toISOString(), replyId = uid('fr')
      await tx.insert(forumReplies).values({ id: replyId, postId: post.id, authorId: c.me.id, body: input.body, createdAt: now })
      await setAttachments(tx, c, input.attachmentIds, { kind: 'reply', id: replyId })
      await tx.update(forumPosts).set({ lastActivityAt: now, updatedAt: now }).where(eq(forumPosts.id, post.id))
      await markRead(tx, c, post.id, now)
      await log(tx, c, { action: 'forum.reply', objectType: 'forum', objectId: post.id, objectLabel: post.title, note: input.body, to: replyId })
      await notify(tx, [post.authorId], { kind: FORUM_COPY.categories[post.category], tab: `page:forum:${post.id}`, title: FORUM_COPY.notify.replyTitle(c.me.name), body: FORUM_COPY.notify.replyBody(post.title, plainText(input.body)), actorId: c.me.id })
      return { ...result(post.id), replyId }
    },
  }),
  'forum.editReply': act({
    quiet: true,
    schema: postInput.extend({ replyId: id, body, attachmentIds: attachments.optional() }),
    run: async (tx, c, _w, input) => {
      const post = await forumPostFor(tx, c, input.id)
      const [reply] = await tx.select().from(forumReplies).where(and(eq(forumReplies.id, input.replyId), eq(forumReplies.postId, post.id), isNull(forumReplies.deletedAt)))
      if (!reply) throw notFound(FORUM_COPY.errors.notFound)
      if (reply.authorId !== c.me.id && !canManageForum(c)) throw deny(FORUM_COPY.errors.edit)
      const now = new Date().toISOString()
      await setAttachments(tx, c, input.attachmentIds, { kind: 'reply', id: reply.id })
      if (!input.body.trim()) {
        const [files] = await tx.select({ value: count() }).from(forumAttachments).where(and(eq(forumAttachments.ownerKind, 'reply'), eq(forumAttachments.ownerId, reply.id), isNull(forumAttachments.deletedAt)))
        if (!files.value) throw bad(unknown)
      }
      await tx.update(forumReplies).set({ body: input.body, editedAt: now }).where(eq(forumReplies.id, reply.id))
      await tx.update(forumPosts).set({ updatedAt: now }).where(eq(forumPosts.id, post.id))
      await markRead(tx, c, post.id, now)
      await log(tx, c, { action: 'forum.editReply', objectType: 'forum', objectId: post.id, objectLabel: post.title, from: JSON.stringify({ body: reply.body, editedAt: reply.editedAt }), to: JSON.stringify({ body: input.body, editedAt: now }), note: JSON.stringify({ replyId: reply.id, attachmentIds: input.attachmentIds }) })
      return { ...result(post.id), replyId: reply.id }
    },
  }),
  'forum.like': act({
    quiet: true, schema: postInput.extend({ liked: flag.default(true) }),
    run: async (tx, c, _w, input) => {
      const post = await forumPostFor(tx, c, input.id)
      if (input.liked) await tx.insert(forumLikes).values({ postId: post.id, userId: c.me.id }).onConflictDoNothing()
      else await tx.delete(forumLikes).where(and(eq(forumLikes.postId, post.id), eq(forumLikes.userId, c.me.id)))
      const [likes] = await tx.select({ value: count() }).from(forumLikes).where(eq(forumLikes.postId, post.id))
      await log(tx, c, { action: 'forum.like', objectType: 'forum', objectId: post.id, objectLabel: post.title, to: String(input.liked) })
      return { ...result(post.id), liked: input.liked, likeCount: likes.value }
    },
  }),
  'forum.read': act({
    quiet: true, schema: postInput,
    run: async (tx, c, _w, input) => {
      const post = await forumPostFor(tx, c, input.id), now = new Date().toISOString()
      await markRead(tx, c, post.id, now)
      // 标记已读不写审计：每人每打开一帖就记一条会淹掉日志
      return { ...result(post.id), readAt: now }
    },
  }),
}
