import { and, count, desc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import { avatarFrame } from '@/shared/avatar-frames'
import { FORUM_COPY } from '@/shared/copy/forum'
import type { DmMessage, DmMessagePage, DmPerson, DmThread, DmThreadList } from '@/shared/dm'
import { db, type DB, type Tx } from './db'
import { forumAttachmentViews } from './forum-files'
import { bad, notFound } from './http'
import { audit, dmMessages, dmReads, dmThreads, users } from './schema'
import type { Ctx } from './session'

export type DmThreadRow = typeof dmThreads.$inferSelect
export type DmMessageRow = typeof dmMessages.$inferSelect
type Query = DB | Tx
export const isDmParticipant = (row: Pick<DmThreadRow, 'participantA' | 'participantB'>, userId: string) => row.participantA === userId || row.participantB === userId
/** A custom permission on an employee role must never grant access to other employees' DMs. */
export const canDmViewAll = (c: Ctx) => c.role.locked
export const canViewDmThread = (row: Pick<DmThreadRow, 'participantA' | 'participantB'>, c: Ctx) => isDmParticipant(row, c.me.id) || canDmViewAll(c)
export const dmTab = (threadId: string) => `page:dm:${threadId}`

export function dmAuditVisibility(c: Ctx) {
  return canDmViewAll(c) ? undefined : sql`(${audit.objectType} <> 'dm' OR EXISTS (
    SELECT 1 FROM ${dmThreads} WHERE ${dmThreads.id} = ${audit.objectId}
      AND (${dmThreads.participantA} = ${c.me.id} OR ${dmThreads.participantB} = ${c.me.id})
  ))`
}

export async function dmThreadFor(q: Query, c: Ctx, id: string) {
  const [row] = await q.select().from(dmThreads).where(eq(dmThreads.id, id))
  if (!row || !canViewDmThread(row, c)) throw notFound(FORUM_COPY.errors.notFound)
  return row
}

export async function dmPeople(q: Query, ids?: string[]): Promise<DmPerson[]> {
  if (ids && !ids.length) return []
  const rows = await q.select({ id: users.id, name: users.name, hue: users.hue, avatar: users.avatar, frame: users.avatarFrame, active: users.active }).from(users).where(ids ? inArray(users.id, ids) : undefined).orderBy(users.name, users.id)
  return rows.map(person => ({ ...person, avatar: person.avatar ?? undefined, frame: avatarFrame(person.frame) }))
}

export async function dmMessageView(q: Query, row: DmMessageRow): Promise<DmMessage> {
  return { ...row, body: row.retractedAt ? '' : row.body, attachments: row.retractedAt ? [] : await forumAttachmentViews(q, 'dm', row.id) }
}

export function dmMessagePreview(message: DmMessage | null) {
  if (!message) return ''
  if (message.retractedAt) return FORUM_COPY.dm.retracted
  if (message.body) return [...message.body].slice(0, 40).join('')
  const file = message.attachments[0]
  return !file ? '' : file.mime.startsWith('image/') ? FORUM_COPY.dm.image : FORUM_COPY.dm.file(file.name)
}

function ownThreadFilter(c: Ctx) {
  return or(eq(dmThreads.participantA, c.me.id), eq(dmThreads.participantB, c.me.id))!
}

export async function dmThreadViews(q: Query, c: Ctx, rows: DmThreadRow[]): Promise<DmThread[]> {
  if (!rows.length) return []
  const ids = rows.map(row => row.id)
  const [people, reads, lastRows, counts] = await Promise.all([
    dmPeople(q, [...new Set(rows.flatMap(row => [row.participantA, row.participantB]))]),
    q.select().from(dmReads).where(inArray(dmReads.threadId, ids)),
    q.selectDistinctOn([dmMessages.threadId]).from(dmMessages).where(inArray(dmMessages.threadId, ids)).orderBy(dmMessages.threadId, desc(dmMessages.createdAt), desc(dmMessages.id)),
    q.select({ threadId: dmMessages.threadId, value: count() }).from(dmMessages).where(and(
      inArray(dmMessages.threadId, rows.filter(row => isDmParticipant(row, c.me.id)).map(row => row.id)),
      ne(dmMessages.senderId, c.me.id), isNull(dmMessages.retractedAt),
      sql`${dmMessages.createdAt} > coalesce((SELECT ${dmReads.readAt} FROM ${dmReads} WHERE ${dmReads.threadId} = ${dmMessages.threadId} AND ${dmReads.userId} = ${c.me.id}), '-infinity'::timestamptz)`,
    )).groupBy(dmMessages.threadId),
  ])
  const peopleById = new Map(people.map(person => [person.id, person]))
  const lastMessages = new Map((await Promise.all(lastRows.map(row => dmMessageView(q, row)))).map(row => [row.threadId, row]))
  return rows.map(row => {
    // Foreign keys ensure both historical participants still exist, including disabled accounts.
    const participants: [DmPerson, DmPerson] = [peopleById.get(row.participantA)!, peopleById.get(row.participantB)!]
    const participant = isDmParticipant(row, c.me.id)
    const counterpart = participant ? participants.find(person => person.id !== c.me.id)! : null
    const lastMessage = lastMessages.get(row.id) ?? null
    return { id: row.id, participants, counterpart, readOnly: !participant, canSend: participant && participants.every(person => person.active), createdAt: row.createdAt, updatedAt: row.updatedAt,
      lastMessage, lastMessagePreview: dmMessagePreview(lastMessage), unreadCount: counts.find(value => value.threadId === row.id)?.value ?? 0,
      readAt: participant ? reads.find(read => read.threadId === row.id && read.userId === c.me.id)?.readAt ?? null : null,
      counterpartReadAt: counterpart ? reads.find(read => read.threadId === row.id && read.userId === counterpart.id)?.readAt ?? null : null }
  })
}

export async function dmThreadList(c: Ctx, limit = 50, mineOffset = 0, othersOffset = 0): Promise<DmThreadList> {
  const own = ownThreadFilter(c)
  const [mine, others, [unread]] = await Promise.all([
    db.select().from(dmThreads).where(own).orderBy(desc(dmThreads.updatedAt), desc(dmThreads.id)).limit(limit + 1).offset(mineOffset),
    canDmViewAll(c) ? db.select().from(dmThreads).where(and(ne(dmThreads.participantA, c.me.id), ne(dmThreads.participantB, c.me.id))).orderBy(desc(dmThreads.updatedAt), desc(dmThreads.id)).limit(limit + 1).offset(othersOffset) : Promise.resolve([]),
    db.select({ value: count() }).from(dmMessages).innerJoin(dmThreads, eq(dmMessages.threadId, dmThreads.id)).where(and(own, ne(dmMessages.senderId, c.me.id), isNull(dmMessages.retractedAt),
      sql`${dmMessages.createdAt} > coalesce((SELECT ${dmReads.readAt} FROM ${dmReads} WHERE ${dmReads.threadId} = ${dmMessages.threadId} AND ${dmReads.userId} = ${c.me.id}), '-infinity'::timestamptz)`)),
  ])
  return { mine: await dmThreadViews(db, c, mine.slice(0, limit)), others: await dmThreadViews(db, c, others.slice(0, limit)), totalUnread: unread.value,
    next: { mine: mine.length > limit ? mineOffset + limit : null, others: others.length > limit ? othersOffset + limit : null } }
}

const messageCursor = (row: DmMessageRow) => Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url')
function beforeFilter(cursor: string): SQL {
  try {
    if (cursor.length > 512) throw new Error()
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string' || !Number.isFinite(Date.parse(value[0])) || !value[1] || value[1].length > 100) throw new Error()
    return or(lt(dmMessages.createdAt, value[0]), and(eq(dmMessages.createdAt, value[0]), lt(dmMessages.id, value[1])))!
  } catch { throw bad(FORUM_COPY.errors.unknown) }
}

export async function dmMessagePage(c: Ctx, threadId: string, before: string | null, limit = 50): Promise<DmMessagePage> {
  const row = await dmThreadFor(db, c, threadId)
  const [messages, [thread], own] = await Promise.all([
    db.select().from(dmMessages).where(and(eq(dmMessages.threadId, row.id), before ? beforeFilter(before) : undefined)).orderBy(desc(dmMessages.createdAt), desc(dmMessages.id)).limit(limit + 1),
    dmThreadViews(db, c, [row]),
    isDmParticipant(row, c.me.id) ? db.select().from(dmMessages).where(and(eq(dmMessages.threadId, row.id), eq(dmMessages.senderId, c.me.id), isNull(dmMessages.retractedAt))).orderBy(desc(dmMessages.createdAt), desc(dmMessages.id)).limit(1) : Promise.resolve([]),
  ])
  const page = messages.slice(0, limit)
  return { thread, rows: await Promise.all(page.reverse().map(message => dmMessageView(db, message))), next: messages.length > limit ? messageCursor(messages[limit - 1]) : null,
    lastOwnMessageId: own[0]?.id ?? null, lastOwnMessageRead: !!(own[0] && thread.counterpartReadAt && Date.parse(thread.counterpartReadAt) >= Date.parse(own[0].createdAt)) }
}
