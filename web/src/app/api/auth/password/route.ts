import { and, eq, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/server/db'
import { audit, sessions, users } from '@/server/schema'
import { hashPassword, passwordProblem, verifyPassword } from '@/server/password'
import { bad, json, route } from '@/server/http'

export const POST = route(
  async (req, c) => {
    const body = z.object({ current: z.string().min(1), next: z.string().max(200) }).safeParse(await req.json().catch(() => null))
    if (!body.success) throw bad('填一下当前密码和新密码')
    const [u] = await db.select().from(users).where(eq(users.id, c.me.id))
    if (!(await verifyPassword(body.data.current, u.passwordHash))) throw bad('当前密码不对')
    const problem = passwordProblem(body.data.next)
    if (problem) throw bad(problem)
    if (body.data.next === body.data.current) throw bad('新密码不能和当前密码一样')
    await db.update(users).set({ passwordHash: await hashPassword(body.data.next), mustChangePassword: false }).where(eq(users.id, u.id))
    // 改完密码，其他设备上的登录全部失效，只留当前这个
    await db
      .update(sessions)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(sessions.userId, u.id), ne(sessions.id, c.sessionId), isNull(sessions.revokedAt)))
    await db.insert(audit).values({ actorId: u.id, action: '改密码', objectType: 'user', objectId: u.id, objectLabel: u.name, ip: c.ip })
    return json({ ok: true })
  },
  { allowMustChange: true },
)
