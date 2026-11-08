import { afterAll, beforeAll, expect, test } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { loginRecords, sessions, users } from '@/server/schema'
import { LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS } from '@/server/login-throttle'
import { POST as login } from '@/app/api/auth/login/route'
import { closeDb, resetDb, PW } from './helpers'

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL?.includes('/workbench_security_test_')) throw new Error('请使用独立安全测试库')
  await resetDb()
})
afterAll(closeDb)

const attempt = (ip: string, account: string, password = PW) => login(new Request('http://test.local/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ account, password }),
}))

test('同一办公 IP 下不同员工正常登录，成功/失败各只写一条登录记录', async () => {
  const ip = '192.0.2.10'
  for (const account of ['boss', 'acheng', 'xiaoyang', 'xiaosenkai']) expect((await attempt(ip, account)).status).toBe(200)
  expect((await attempt(ip, 'not-a-real-account')).status).toBe(401)
  const records = await db.select().from(loginRecords).where(eq(loginRecords.ip, ip))
  expect(records).toHaveLength(5)
  expect(records.filter(row => row.ok)).toHaveLength(4)
  expect(records.filter(row => !row.ok)[0].reason).toBe('账号不存在或已停用')
})

test('换用户名和并发请求共享 IP 名额，超过限制不建会话、不继续增加记录', async () => {
  const ip = '192.0.2.11'
  await db.insert(loginRecords).values(Array.from({ length: LOGIN_IP_LIMIT - 2 }, (_, n) => ({ account: `previous-${n}`, ip, ok: false })))
  const results = await Promise.all(Array.from({ length: 10 }, (_, n) => attempt(ip, `unknown-${n}`)))
  expect(results.filter(r => r.status === 401)).toHaveLength(2)
  expect(results.filter(r => r.status === 429)).toHaveLength(8)
  expect(results.filter(r => r.status === 429).every(r => Number(r.headers.get('retry-after')) > 0)).toBe(true)
  const before = await db.select().from(sessions)
  const rejected = await attempt(ip, 'boss')
  expect(rejected.status).toBe(429)
  expect(rejected.headers.get('set-cookie')).toBeNull()
  expect(await db.select().from(sessions)).toEqual(before)
  expect(await db.select().from(loginRecords).where(eq(loginRecords.ip, ip))).toHaveLength(LOGIN_IP_LIMIT)
  // A different source is not penalized for the rejected IP.
  expect((await attempt('192.0.2.12', 'boss')).status).toBe(200)
})

test('窗口过后恢复登录，原有账号密码锁定仍然生效', async () => {
  const ip = '192.0.2.13'
  await db.insert(loginRecords).values(Array.from({ length: LOGIN_IP_LIMIT }, (_, n) => ({ account: `old-${n}`, ip, ok: false, at: new Date(Date.now() - LOGIN_IP_WINDOW_MS - 1_000).toISOString() })))
  expect((await attempt(ip, 'acheng')).status).toBe(200)
  for (let n = 0; n < 5; n++) expect((await attempt(ip, 'xiaosenkai', 'wrong-password')).status).toBe(401)
  expect((await attempt(ip, 'xiaosenkai')).status).toBe(429)
  const [writer] = await db.select().from(users).where(eq(users.id, 'u-xiao'))
  expect(new Date(writer.lockedUntil!).getTime()).toBeGreaterThan(Date.now())
  expect(await db.select().from(loginRecords).where(and(eq(loginRecords.ip, ip), eq(loginRecords.account, 'acheng'), eq(loginRecords.ok, true)))).toHaveLength(1)
})
