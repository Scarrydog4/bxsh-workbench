import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/server/db'
import { audit, loginRecords, users } from '@/server/schema'
import { verifyPassword } from '@/server/password'
import { clientIp, createSession, sessionCookie } from '@/server/session'
import { json } from '@/server/http'
import { trustedWriteRequest } from '@/server/request-security'
import { reserveLoginAttempt } from '@/server/login-throttle'

const LOCK_AFTER = 5
const LOCK_MINUTES = 15

export async function POST(req: Request) {
  if (!trustedWriteRequest(req)) return json({ error: '请在平台登录页面操作' }, { status: 403 })
  const body = z.object({ account: z.string().trim().min(1).max(50), password: z.string().min(1).max(200) }).safeParse(await req.json().catch(() => null))
  if (!body.success) return json({ error: '填一下登录名和密码' }, { status: 400 })
  const { account, password } = body.data
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent')?.slice(0, 300) ?? ''
  const attempt = await reserveLoginAttempt({ account, ip, ua })
  if (attempt.recordId === null) return json({ error: '登录尝试过于频繁，请稍等一分钟再试' }, { status: 429, headers: { 'retry-after': String(attempt.retryAfter) } })
  const record = (ok: boolean, reason: string | null, userId: string | null) => db.update(loginRecords).set({ ok, reason, userId }).where(eq(loginRecords.id, attempt.recordId!))

  const [u] = await db.select().from(users).where(eq(users.account, account)).limit(1)
  if (!u || !u.active) {
    await record(false, '账号不存在或已停用', u?.id ?? null)
    return json({ error: '登录名或密码不对' }, { status: 401 })
  }
  if (u.lockedUntil && new Date(u.lockedUntil) > new Date()) {
    await record(false, '锁定中', u.id)
    const min = Math.ceil((new Date(u.lockedUntil).getTime() - Date.now()) / 60000)
    return json({ error: `连续输错 ${LOCK_AFTER} 次，${min} 分钟后再试` }, { status: 429 })
  }
  if (!(await verifyPassword(password, u.passwordHash))) {
    // 数据库按当前值递增，多个并发请求不能覆盖彼此的失败次数。
    const [updated] = await db.update(users).set({
      failedAttempts: sql`case when ${users.failedAttempts} + 1 >= ${LOCK_AFTER} then 0 else ${users.failedAttempts} + 1 end`,
      lockedUntil: sql`case when ${users.failedAttempts} + 1 >= ${LOCK_AFTER} then ${new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()}::timestamptz else ${users.lockedUntil} end`,
    }).where(eq(users.id, u.id)).returning({ failedAttempts: users.failedAttempts, lockedUntil: users.lockedUntil })
    const n = updated.failedAttempts
    const lock = !!updated.lockedUntil && new Date(updated.lockedUntil) > new Date()
    await record(false, lock ? '密码错误，已锁定' : '密码错误', u.id)
    return json({ error: lock ? `连续输错 ${LOCK_AFTER} 次，账号锁定 ${LOCK_MINUTES} 分钟` : `登录名或密码不对（还能再试 ${LOCK_AFTER - n} 次）` }, { status: 401 })
  }
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, u.id))
  const { token, expires } = await createSession(u.id, req)
  await record(true, null, u.id)
  await db.insert(audit).values({ actorId: u.id, action: '登录', objectType: 'session', objectLabel: u.name, ip })
  // token 也放进返回体，给以后的桌面端用 Authorization: Bearer
  return json({ ok: true, mustChangePassword: u.mustChangePassword, token }, { headers: { 'set-cookie': sessionCookie(token, expires) } })
}
