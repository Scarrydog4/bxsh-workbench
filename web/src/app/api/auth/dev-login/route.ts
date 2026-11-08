import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/server/db'
import { audit, roles, users } from '@/server/schema'
import { clientIp, createSession, sessionCookie } from '@/server/session'
import { json } from '@/server/http'
import { localDevLoginEnabled, trustedWriteRequest } from '@/server/request-security'

/** 仅显式启用的本机 next dev；正式构建和远程访问一律 404。 */
const notFound = () => json({ error: '没有这个接口' }, { status: 404 })

export async function GET(req: Request) {
  if (!localDevLoginEnabled(req)) return notFound()
  const rows = await db.select({ id: users.id, name: users.name, hue: users.hue, frame: users.avatarFrame, account: users.account, roleName: roles.name })
    .from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.active, true)).orderBy(asc(users.createdAt))
  return json({ users: rows })
}

export async function POST(req: Request) {
  if (!localDevLoginEnabled(req)) return notFound()
  if (!trustedWriteRequest(req)) return json({ error: '请在本机预览页面操作' }, { status: 403 })
  const body = z.object({ userId: z.string().min(1) }).safeParse(await req.json().catch(() => null))
  if (!body.success) return json({ error: '选一个账号' }, { status: 400 })
  const [u] = await db.select().from(users).where(eq(users.id, body.data.userId)).limit(1)
  if (!u || !u.active) return json({ error: '账号不存在或已停用' }, { status: 404 })
  const { token, expires } = await createSession(u.id, req)
  await db.insert(audit).values({ actorId: u.id, action: '开发登录', objectType: 'session', objectLabel: u.name, ip: clientIp(req) })
  return json({ ok: true }, { headers: { 'set-cookie': sessionCookie(token, expires) } })
}
