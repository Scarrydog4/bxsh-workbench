import { fuzzySearchSql } from '@/server/search'
import { and, eq, ne } from 'drizzle-orm'
import { avatarFrame } from '@/shared/avatar-frames'
import { db } from '@/server/db'
import { json, forumRoute as route } from '@/server/http'
import { users } from '@/server/schema'

export const GET = route(async (req, c) => {
  const query = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 200)
  const rows = await db.select({ id: users.id, name: users.name, hue: users.hue, avatar: users.avatar, frame: users.avatarFrame, active: users.active }).from(users)
    .where(and(eq(users.active, true), ne(users.id, c.me.id), fuzzySearchSql(query, [users.name]))).orderBy(users.name, users.id)
  return json({ rows: rows.map(row => ({ ...row, avatar: row.avatar ?? undefined, frame: avatarFrame(row.frame) })) })
})
