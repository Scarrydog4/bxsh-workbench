import { fuzzySearchSql } from '@/server/search'
import { and, count, desc, eq, type SQL } from 'drizzle-orm'
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, type FeedbackKind, type FeedbackList, type FeedbackStatus } from '@/shared/feedback'
import { db } from '@/server/db'
import { feedbackViews } from '@/server/feedback'
import { bad, json, notFound, route } from '@/server/http'
import { feedback } from '@/server/schema'

export const GET = route(async (req, c) => {
  const params = new URL(req.url).searchParams
  const filters: SQL[] = c.role.locked ? [] : [eq(feedback.authorId, c.me.id)]
  const id = params.get('id'), q = (params.get('q') ?? '').trim().slice(0, 200), status = params.get('status'), kind = params.get('kind')
  if (id) filters.push(eq(feedback.id, id))
  if (q) filters.push(fuzzySearchSql(q, [feedback.title, feedback.body, feedback.no])!)
  if (status) {
    if (!FEEDBACK_STATUSES.includes(status as FeedbackStatus)) throw bad('反馈状态不对')
    filters.push(eq(feedback.status, status as FeedbackStatus))
  }
  if (kind) {
    if (!FEEDBACK_KINDS.includes(kind as FeedbackKind)) throw bad('反馈类型不对')
    filters.push(eq(feedback.kind, kind as FeedbackKind))
  }
  const offsetValue = Number(params.get('offset')), limitValue = Number(params.get('limit'))
  const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.trunc(offsetValue)) : 0
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(100, Math.max(1, Math.trunc(limitValue))) : 50
  const [rows, [total]] = await Promise.all([
    db.select().from(feedback).where(and(...filters)).orderBy(desc(feedback.updatedAt), desc(feedback.id)).limit(limit).offset(offset),
    db.select({ value: count() }).from(feedback).where(and(...filters)),
  ])
  if (id && !rows.length) throw notFound()
  const result: FeedbackList = { rows: await feedbackViews(rows), total: total.value, next: offset + rows.length < total.value ? offset + rows.length : null }
  return json(result)
})
