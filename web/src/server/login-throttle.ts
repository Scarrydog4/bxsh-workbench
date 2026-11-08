import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { db } from './db'
import { loginRecords } from './schema'

export const LOGIN_IP_LIMIT = 60
export const LOGIN_IP_WINDOW_MS = 60_000

/** Reuse the login audit table; reserve before password hashing so parallel requests share the limit. */
export async function reserveLoginAttempt(input: { account: string; ip: string; ua: string }) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`login-ip:${input.ip}`}, 0))`)
    const now = Date.now()
    const recent = await tx.select({ at: loginRecords.at }).from(loginRecords)
      .where(and(eq(loginRecords.ip, input.ip), gt(loginRecords.at, new Date(now - LOGIN_IP_WINDOW_MS).toISOString())))
      .orderBy(desc(loginRecords.at)).limit(LOGIN_IP_LIMIT)
    if (recent.length >= LOGIN_IP_LIMIT) {
      return { recordId: null, retryAfter: Math.max(1, Math.ceil((new Date(recent[recent.length - 1].at).getTime() + LOGIN_IP_WINDOW_MS - now) / 1000)) }
    }
    const [attempt] = await tx.insert(loginRecords).values({ ...input, ok: false, reason: '登录校验未完成', userId: null, at: new Date(now).toISOString() }).returning({ id: loginRecords.id })
    return { recordId: attempt.id, retryAfter: 0 }
  })
}
