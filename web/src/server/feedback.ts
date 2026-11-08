import { inArray, sql } from 'drizzle-orm'
import type { Feedback, FeedbackAuthor } from '@/shared/feedback'
import { avatarFrame } from '@/shared/avatar-frames'
import type { Ctx } from './session'
import { db } from './db'
import { audit, feedback, users } from './schema'

export type FeedbackRow = typeof feedback.$inferSelect
export const canViewFeedback = (row: Pick<FeedbackRow, 'authorId'>, c: Ctx) => c.role.locked || row.authorId === c.me.id
export const feedbackShots = (row: FeedbackRow) => [...new Set([...row.shots, ...row.replies.flatMap(reply => reply.shots)])]

/** 即使员工拥有审计权限，反馈内容也保持本人和老板可见。 */
export function feedbackAuditVisibility(c: Ctx) {
  return c.role.locked ? undefined : sql`(
    ${audit.objectType} <> 'feedback' OR EXISTS (
      SELECT 1 FROM ${feedback}
      WHERE ${feedback.id} = ${audit.objectId} AND ${feedback.authorId} = ${c.me.id}
    )
  )`
}

export async function feedbackViews(rows: FeedbackRow[]): Promise<Feedback[]> {
  if (!rows.length) return []
  const ids = [...new Set(rows.flatMap(row => [row.authorId, ...row.replies.map(reply => reply.by)]))]
  const people = await db.select({ id: users.id, name: users.name, hue: users.hue, avatar: users.avatar, frame: users.avatarFrame }).from(users).where(inArray(users.id, ids))
  const authors = new Map<string, FeedbackAuthor>(people.map(person => [person.id, { ...person, avatar: person.avatar ?? undefined, frame: avatarFrame(person.frame) }]))
  const author = (id: string): FeedbackAuthor => authors.get(id) ?? { id, name: '已停用账号', hue: 0 }
  return rows.map(({ requests: _requests, ...row }) => ({ ...row, author: author(row.authorId), replies: row.replies.map(reply => ({ ...reply, author: author(reply.by) })) }))
}
