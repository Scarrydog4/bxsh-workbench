import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '@/server/db'
import { loginRecords } from '@/server/schema'
import { json, route } from '@/server/http'

export const GET = route(async (_req, c) => {
  const rows = await db.select().from(loginRecords).where(and(eq(loginRecords.userId, c.me.id), gte(loginRecords.at, new Date(Date.now() - 30 * 86400_000).toISOString()))).orderBy(desc(loginRecords.id)).limit(1000)
  return json(rows.map((r) => ({ at: r.at, ok: r.ok, reason: r.reason, ip: r.ip, ua: r.ua })))
})
