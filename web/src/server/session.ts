import { avatarFrame } from '@/shared/avatar-frames'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, gt } from 'drizzle-orm'
import { db } from './db'
import { roles, sessions, users } from './schema'
import { env } from './env'
import type { Role, User } from '@/shared/types'

export const COOKIE = 'bxsh_session'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export function clientIp(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || ''
}

export async function createSession(userId: string, req: Request) {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + env.sessionDays * 86400_000)
  await db.insert(sessions).values({
    id: hash(token),
    userId,
    expiresAt: expires.toISOString(),
    ip: clientIp(req),
    ua: req.headers.get('user-agent')?.slice(0, 300) ?? '',
  })
  return { token, expires }
}

export function sessionCookie(token: string, expires: Date) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${expires.toUTCString()}`]
  if (env.secureCookie) parts.push('Secure')
  return parts.join('; ')
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${env.secureCookie ? '; Secure' : ''}`
}

function tokenOf(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  const cookie = req.headers.get('cookie') ?? ''
  const m = cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`))
  return m?.[1] ?? null
}

export interface Ctx {
  me: User & { mustChangePassword: boolean }
  role: Role
  sessionId: string
  ip: string
}

/** 认出当前账号：cookie（网页）或 Authorization: Bearer（以后的桌面端） */
export async function getCtx(req: Request): Promise<Ctx | null> {
  const token = tokenOf(req)
  if (!token) return null
  const id = hash(token)
  const now = new Date().toISOString()
  const rows = await db
    .select({ s: sessions, u: users, r: roles })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1)
  const row = rows[0]
  if (!row || !row.u.active) return null
  // 每 5 分钟最多记一次活跃时间，避免每个请求都写库
  if (Date.now() - new Date(row.s.lastSeenAt).getTime() > 300_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id))
  }
  return {
    me: {
      id: row.u.id,
      name: row.u.name,
      account: row.u.account,
      roleId: row.u.roleId,
      hue: row.u.hue,
      commissionRate: row.u.commissionRate,
      salesMode: row.u.salesMode,
      avatar: row.u.avatar ?? undefined,
      frame: avatarFrame(row.u.avatarFrame),
      canWrite: row.u.canWrite,
      active: row.u.active,
      mustChangePassword: row.u.mustChangePassword,
    },
    role: {
      id: row.r.id,
      name: row.r.name,
      locked: row.r.locked,
      preset: row.r.preset,
      perms: row.r.perms as Role['perms'],
      fields: row.r.fields as unknown as Role['fields'],
      rowScope: row.r.rowScope as Role['rowScope'],
    },
    sessionId: id,
    ip: clientIp(req),
  }
}

export async function revokeSession(id: string) {
  await db.update(sessions).set({ revokedAt: new Date().toISOString() }).where(eq(sessions.id, id))
}

export async function revokeAllSessions(userId: string) {
  await db.update(sessions).set({ revokedAt: new Date().toISOString() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
}
