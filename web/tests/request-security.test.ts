import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { sessions } from '@/server/schema'
import { localDevLoginEnabled, trustedWriteRequest } from '@/server/request-security'
import { GET as devGet, POST as devPost } from '@/app/api/auth/dev-login/route'
import { POST as login } from '@/app/api/auth/login/route'
import { POST as logout } from '@/app/api/auth/logout/route'
import { POST as prefs } from '@/app/api/prefs/route'
import { GET as boot } from '@/app/api/bootstrap/route'
import { as, closeDb, resetDb, PW } from './helpers'

const params = { params: Promise.resolve({}) }
let boss: Awaited<ReturnType<typeof as>>
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL?.includes('/workbench_security_test_')) throw new Error('请使用独立安全测试库')
  await resetDb()
  boss = await as('boss')
})
afterEach(() => vi.unstubAllEnvs())
afterAll(closeDb)

const request = (headers: Record<string, string> = {}, method = 'POST') => new Request('https://work.example/api/prefs', { method, headers })

test.each<Record<string, string>>([
  { origin: 'https://attacker.example' },
  { origin: 'https://sub.work.example', 'sec-fetch-site': 'same-site' },
  { origin: 'null' },
  { origin: 'https://work.example.attacker.example' },
  { referer: 'https://attacker.example/form' },
  { 'sec-fetch-site': 'cross-site' },
  { 'sec-fetch-site': 'same-site' },
  { 'content-type': 'text/plain' },
  { 'content-type': 'application/x-www-form-urlencoded' },
  { 'content-type': 'multipart/form-data; boundary=abc' },
])('拒绝外站与无来源的表单写入 %#', headers => {
  expect(trustedWriteRequest(request(headers))).toBe(false)
})

test('保留同源网页、代理后的 HTTPS、原生 JSON/Bearer 和分片上传', () => {
  expect(trustedWriteRequest(request({ origin: 'https://work.example' }))).toBe(true)
  expect(trustedWriteRequest(request({ referer: 'https://work.example/orders', 'content-type': 'multipart/form-data' }))).toBe(true)
  expect(trustedWriteRequest(new Request('http://localhost:3100/api/prefs', { method: 'POST', headers: { host: 'work.example', origin: 'https://work.example', 'x-forwarded-proto': 'https' } }))).toBe(true)
  expect(trustedWriteRequest(request({ 'content-type': 'application/json' }))).toBe(true)
  expect(trustedWriteRequest(request({ authorization: 'Bearer native-token' }))).toBe(true)
  expect(trustedWriteRequest(request({ 'content-type': 'application/octet-stream' }, 'PUT'))).toBe(true)
  expect(trustedWriteRequest(request({ 'sec-fetch-site': 'cross-site' }, 'GET'))).toBe(true)
})

test('HTTPS 外部协议不能用 HTTP 来源绕过', () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('INSECURE_COOKIE', '')
  expect(trustedWriteRequest(request({ origin: 'http://work.example' }))).toBe(false)
  expect(trustedWriteRequest(request({ origin: 'https://work.example', 'x-forwarded-proto': 'http' }))).toBe(false)
})

test('统一 API 和登录拒绝外站来源，拒绝登出不会撤销当前会话', async () => {
  const foreign = { origin: 'https://attacker.example', cookie: boss.cookie, 'content-type': 'application/json' }
  const r = await prefs(new Request('http://test.local/api/prefs', { method: 'POST', headers: foreign, body: JSON.stringify({ key: 'attack', value: true }) }), params)
  expect(r.status).toBe(403)
  expect((await logout(new Request('http://test.local/api/auth/logout', { method: 'POST', headers: foreign }))).status).toBe(403)
  expect((await boot(new Request('http://test.local/api/bootstrap', { headers: { cookie: boss.cookie } }), params)).status).toBe(200)
  const before = await db.select().from(sessions).where(eq(sessions.userId, 'u-boss'))
  const signIn = await login(new Request('http://test.local/api/auth/login', { method: 'POST', headers: foreign, body: JSON.stringify({ account: 'boss', password: PW }) }))
  expect(signIn.status).toBe(403)
  expect(signIn.headers.get('set-cookie')).toBeNull()
  expect(await db.select().from(sessions).where(eq(sessions.userId, 'u-boss'))).toEqual(before)
})

test('开发免密入口默认关闭，显式开启也只允许本机来源', async () => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('NEXT_PUBLIC_DEV_LOGIN', '')
  const local = new Request('http://127.0.0.1:3100/api/auth/dev-login')
  expect((await devGet(local)).status).toBe(404)
  vi.stubEnv('NEXT_PUBLIC_DEV_LOGIN', '1')
  expect(localDevLoginEnabled(local)).toBe(true)
  for (const remote of [
    new Request('http://192.0.2.1:3100/api/auth/dev-login'),
    new Request(local, { headers: { host: 'work.example' } }),
    new Request(local, { headers: { origin: 'https://attacker.example' } }),
    new Request(local, { headers: { 'sec-fetch-site': 'cross-site' } }),
    new Request(local, { headers: { 'x-forwarded-for': '192.0.2.1' } }),
  ]) {
    expect((await devGet(remote)).status).toBe(404)
    expect((await devPost(new Request(remote, { method: 'POST', body: JSON.stringify({ userId: 'u-boss' }) }))).status).toBe(404)
  }
  vi.stubEnv('NODE_ENV', 'production')
  expect((await devGet(local)).status).toBe(404)
  expect((await devPost(new Request(local, { method: 'POST', body: JSON.stringify({ userId: 'u-boss' }) }))).status).toBe(404)
})
