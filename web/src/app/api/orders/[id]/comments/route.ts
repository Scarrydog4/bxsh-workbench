import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '@/server/db'
import { comments } from '@/server/schema'
import { loadWorld } from '@/server/repo'
import { json, notFound, route } from '@/server/http'
import { can, rowVisible } from '@/shared/perm'

/** 订单评论：看得到这单的人都能看 */
export const GET = route<{ id: string }>(async (_req, c, p) => {
  const w = await loadWorld(db)
  const o = w.orders.find((x) => x.id === p.id)
  if (!o || !rowVisible(o, c.me, c.role) || !can(c.role, 'order.view')) throw notFound()
  const rows = await db.select().from(comments).where(and(eq(comments.orderId, o.id), isNull(comments.deletedAt))).orderBy(asc(comments.at))
  return json(rows.map((m) => ({ id: m.id, by: m.by, body: m.body, images: m.images, mentions: m.mentions, at: m.at })))
})
