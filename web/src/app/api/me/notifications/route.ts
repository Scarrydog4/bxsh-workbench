import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { forumNotificationVisibility } from '@/server/forum-visibility'
import { json, route } from '@/server/http'
import * as t from '@/server/schema'

/** 只取提醒：论坛、私信推送后刷新铃铛，不用重新拉整份订单数据。 */
export const GET = route(async (_req, c) => {
  const where = and(eq(t.notifications.userId, c.me.id), forumNotificationVisibility(c))
  const [[count], rows] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(t.notifications).where(and(where, isNull(t.notifications.readAt))),
    db.select().from(t.notifications).where(where).orderBy(desc(t.notifications.id)).limit(20),
  ])
  return json({ unread: Number(count.n), notifications: rows.map(n => ({ id: String(n.id), kind: n.kind, orderId: n.orderId, tab: n.tab, title: n.title, body: n.body, actorId: n.actorId, at: n.at, read: !!n.readAt })) })
})
