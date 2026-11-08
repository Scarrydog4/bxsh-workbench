import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { FORUM_COPY } from '@/shared/copy/forum'
import { DM_BODY_LIMIT, DM_RETRACT_MS } from '@/shared/dm'
import { act, log } from './actions'
import { dmMessagePreview, dmMessageView, dmTab, dmThreadFor, isDmParticipant } from './dm'
import { bindForumAttachments, retractDmAttachments } from './forum-files'
import { bad, deny, notFound } from './http'
import { uid } from './ids'
import { notify } from './notify'
import { dmMessages, dmReads, dmThreads, notifications, users } from './schema'

const error = FORUM_COPY.errors.unknown
const requestId = z.string({ error }).uuid(error)
const id = z.string({ error }).min(1, error).max(100, error)
const attachmentIds = z.array(id, { error }).max(100, error).default([])

export const DM_ACTIONS = {
  'dm.start': act({
    quiet: true,
    schema: z.object({ requestId, userId: id }, { error }),
    run: async (tx, c, _w, input) => {
      if (input.userId === c.me.id) throw bad(error)
      const [person] = await tx.select().from(users).where(eq(users.id, input.userId))
      if (!person) throw notFound(FORUM_COPY.errors.notFound)
      const [participantA, participantB] = [c.me.id, person.id].sort()
      const [old] = await tx.select().from(dmThreads).where(and(eq(dmThreads.participantA, participantA), eq(dmThreads.participantB, participantB)))
      // A disabled account's existing conversation stays accessible.
      if (old) return { id: old.id, threadId: old.id }
      if (!person.active) throw bad(FORUM_COPY.errors.accountInactive(person.name))
      const threadId = uid('dm')
      await tx.insert(dmThreads).values({ id: threadId, participantA, participantB })
      await log(tx, c, { action: 'dm.start', objectType: 'dm', objectId: threadId })
      return { id: threadId, threadId }
    },
  }),
  'dm.send': act({
    quiet: true,
    schema: z.object({ requestId, threadId: id, body: z.string({ error }).refine(value => [...value].length <= DM_BODY_LIMIT, error).default(''), attachmentIds }, { error })
      .refine(input => input.body.trim().length > 0 || input.attachmentIds.length > 0, error),
    run: async (tx, c, _w, input) => {
      const thread = await dmThreadFor(tx, c, input.threadId)
      if (!isDmParticipant(thread, c.me.id)) throw deny(FORUM_COPY.errors.observer)
      const recipientId = thread.participantA === c.me.id ? thread.participantB : thread.participantA
      const [recipient] = await tx.select().from(users).where(eq(users.id, recipientId))
      if (!recipient.active) throw bad(FORUM_COPY.errors.accountInactive(recipient.name))
      const reads = await tx.select().from(dmReads).where(eq(dmReads.threadId, thread.id))
      // Distinct message/read cursors even when requests complete in the same millisecond.
      const id = uid('dmmsg'), now = new Date(Math.max(Date.now(), Date.parse(thread.updatedAt) + 1, ...reads.map(read => Date.parse(read.readAt) + 1))).toISOString()
      const [message] = await tx.insert(dmMessages).values({ id, threadId: thread.id, senderId: c.me.id, body: input.body, createdAt: now }).returning()
      await bindForumAttachments(tx, c, input.attachmentIds, { kind: 'dm', id })
      await tx.update(dmThreads).set({ updatedAt: now }).where(eq(dmThreads.id, thread.id))
      const read = reads.find(read => read.userId === recipientId)
      await notify(tx, [recipientId], { kind: 'dm', tab: dmTab(thread.id), title: FORUM_COPY.notify.dmTitle(c.me.name), body: dmMessagePreview(await dmMessageView(tx, message)), actorId: c.me.id, key: `dm:${thread.id}:${read?.readAt ?? 'never'}` })
      // The audit is deliberately metadata-only: no message text, filenames, or attachment URLs.
      await log(tx, c, { action: 'dm.send', objectType: 'dm', objectId: thread.id })
      return { id, threadId: thread.id }
    },
  }),
  'dm.retract': act({
    quiet: true,
    schema: z.object({ requestId, id }, { error }),
    run: async (tx, c, _w, input) => {
      const [message] = await tx.select().from(dmMessages).where(eq(dmMessages.id, input.id))
      if (!message) throw notFound(FORUM_COPY.errors.notFound)
      const thread = await dmThreadFor(tx, c, message.threadId)
      if (!isDmParticipant(thread, c.me.id)) throw deny(FORUM_COPY.errors.observer)
      if (message.senderId !== c.me.id) throw deny(FORUM_COPY.errors.forbidden)
      if (message.retractedAt) return { id: message.id, threadId: thread.id }
      if (Date.now() - Date.parse(message.createdAt) > DM_RETRACT_MS) throw bad(FORUM_COPY.errors.retractExpired)
      const preview = dmMessagePreview(await dmMessageView(tx, message))
      const now = new Date().toISOString()
      await tx.update(dmMessages).set({ body: '', retractedAt: now }).where(eq(dmMessages.id, message.id))
      await retractDmAttachments(tx, message.id)
      // A reminder may quote the retracted text or filename. Remove stale copies too.
      await tx.update(notifications).set({ body: FORUM_COPY.dm.retracted }).where(and(eq(notifications.tab, dmTab(thread.id)), eq(notifications.actorId, message.senderId), eq(notifications.body, preview)))
      await log(tx, c, { action: 'dm.retract', objectType: 'dm', objectId: thread.id })
      return { id: message.id, threadId: thread.id }
    },
  }),
  'dm.read': act({
    quiet: true,
    schema: z.object({ requestId, threadId: id }, { error }),
    run: async (tx, c, _w, input) => {
      const thread = await dmThreadFor(tx, c, input.threadId)
      if (!isDmParticipant(thread, c.me.id)) return { id: thread.id, threadId: thread.id, readOnly: true }
      const now = new Date(Math.max(Date.now(), Date.parse(thread.updatedAt))).toISOString()
      await tx.insert(dmReads).values({ threadId: thread.id, userId: c.me.id, readAt: now }).onConflictDoUpdate({ target: [dmReads.threadId, dmReads.userId], set: { readAt: now } })
      await tx.update(notifications).set({ readAt: now }).where(and(eq(notifications.tab, dmTab(thread.id)), eq(notifications.userId, c.me.id), isNull(notifications.readAt)))
      return { id: thread.id, threadId: thread.id, readAt: now }
    },
  }),
}
