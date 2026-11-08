import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET, POST } from '@/app/api/checkin-requests/route'
import { PATCH } from '@/app/api/checkin-requests/[id]/route'
import type { CheckinRequestList, CheckinRequestResult } from '@/shared/checkin-requests'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, writer: Client, sales: Client, other: Client
const now = '2026-10-25T00:00:00.000Z'
const params = { params: Promise.resolve({}) }
const draft = (patch: Record<string, unknown> = {}) => ({ requestId: randomUUID(), kind: 'late', startAt: '2026-10-26T10:00:00+08:00', endAt: '2026-10-26T11:00:00+08:00', reason: '预约看医生', ...patch })
const request = (client: Client | null, url: string, init: RequestInit = {}) => new Request(`http://test.local${url}`, {
  ...init, headers: { ...(client ? { cookie: client.cookie } : {}), 'content-type': 'application/json', ...init.headers },
})
async function post(client: Client | null, body: unknown = draft(), headers?: Record<string, string>) {
  const r = await POST(request(client, '/api/checkin-requests', { method: 'POST', body: JSON.stringify(body), headers }), params)
  return { status: r.status, body: await r.json() as CheckinRequestResult & { error?: string } }
}
async function list(client: Client | null, query = '') {
  const r = await GET(request(client, `/api/checkin-requests${query ? '?' + query : ''}`), params)
  return { status: r.status, body: await r.json() as CheckinRequestList }
}
async function decide(client: Client | null, id: string, body: unknown = { decision: 'approved' }, headers?: Record<string, string>) {
  const r = await PATCH(request(client, `/api/checkin-requests/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers }), { params: Promise.resolve({ id }) })
  return { status: r.status, body: await r.json() as Omit<CheckinRequestResult, 'created'> & { error?: string } }
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now))
  await resetDb()
  boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng'); other = await as('xiaoyang')
})
beforeEach(async () => { vi.setSystemTime(new Date(now)); await db.delete(t.checkinRequests) })
afterAll(async () => { vi.useRealTimers(); await closeDb() })

it('必须登录；停用账号和未改初始密码账号不能提交、读取或审批', async () => {
  expect((await post(null)).status).toBe(401)
  expect((await list(null)).status).toBe(401)
  expect((await decide(null, 'missing')).status).toBe(401)
  await db.update(t.users).set({ active: false }).where(eq(t.users.id, 'u-xiao'))
  expect((await post(writer)).status).toBe(401)
  await db.update(t.users).set({ active: true, mustChangePassword: true }).where(eq(t.users.id, 'u-xiao'))
  expect((await post(writer)).status).toBe(403)
  expect((await list(writer)).status).toBe(403)
  await db.update(t.users).set({ mustChangePassword: false }).where(eq(t.users.id, 'u-xiao'))
})

it('五种申请均记录真实申请人和服务器时间，默认待审批且不修改打卡或工资账目', async () => {
  for (const kind of ['late', 'early', 'leave', 'overtime', 'weekend']) {
    const result = await post(writer, draft({ kind }))
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ created: true, record: { userId: 'u-xiao', name: '肖森凯', kind, createdAt: now, status: 'pending', decidedAt: null, decidedBy: null, decisionReason: null, startAt: '2026-10-26T02:00:00.000Z', endAt: '2026-10-26T03:00:00.000Z' } })
    expect(Object.keys(result.body.record).sort()).toEqual(['id', 'userId', 'name', 'hue', 'kind', 'startAt', 'endAt', 'reason', 'status', 'createdAt', 'decidedAt', 'decidedBy', 'decisionReason'].sort())
  }
  expect(await db.select().from(t.dailyCheckins)).toHaveLength(0)
  expect(await db.select().from(t.settlements)).toHaveLength(0)
})

it('员工仅能看本人；只有锁定老板能读取全员，通用权限不能绕过隔离', async () => {
  await post(writer); await post(sales); await post(other)
  for (const [employee, userId] of [[writer, 'u-xiao'], [sales, 'u-acheng'], [other, 'u-yang']] as const) {
    const own = (await list(employee)).body
    expect(own.rows.map(r => r.userId)).toEqual([userId])
    expect(own.total).toBe(1)
  }
  expect((await list(boss)).body).toMatchObject({ rows: [], total: 0 })
  const team = (await list(boss, 'scope=team')).body
  expect(team.rows.map(r => r.userId).sort()).toEqual(['u-acheng', 'u-xiao', 'u-yang'])
  expect(team.total).toBe(3)
  const [role] = await db.select().from(t.roles).where(eq(t.roles.id, 'r-sales'))
  await db.update(t.roles).set({ perms: [...role.perms, 'user.manage', 'income.all', 'audit.view'], rowScope: 'all' }).where(eq(t.roles.id, role.id))
  for (const employee of [writer, sales, other]) expect((await list(employee, 'scope=team')).status).toBe(403)
  await db.update(t.roles).set({ perms: role.perms, rowScope: role.rowScope }).where(eq(t.roles.id, role.id))
})

it('并发同一请求只新增一次；重试保留原记录且拒绝用同一编号改内容', async () => {
  const body = draft()
  const results = await Promise.all(Array.from({ length: 6 }, () => post(writer, body)))
  expect(results.map(r => r.status)).toEqual(Array(6).fill(200))
  expect(results.filter(r => r.body.created)).toHaveLength(1)
  expect(new Set(results.map(r => r.body.record.id)).size).toBe(1)
  expect(await db.select().from(t.checkinRequests)).toHaveLength(1)
  // 标准化时区和首尾空白后仍视为同一申请。
  const retry = await post(writer, { ...body, reason: ` ${body.reason} `, startAt: '2026-10-26T02:00:00Z' })
  expect(retry.body).toEqual({ created: false, record: results[0].body.record })
  for (const patch of [{ kind: 'leave' }, { reason: '换一个原因' }, { endAt: '2026-10-26T12:00:00+08:00' }]) expect((await post(writer, { ...body, ...patch })).status).toBe(400)
  // 结束后重试不能误作新的过期申请，也不会新增记录。
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'))
  expect((await post(writer, body)).body).toEqual({ created: false, record: results[0].body.record })
  expect((await post(sales, body)).status).toBe(400)
})

it('必须提前申请，结束晚于开始且北京时间同一天；拒绝无时区或伪造字段', async () => {
  const invalid = [
    { startAt: '2026-10-24T10:00:00+08:00', endAt: '2026-10-24T11:00:00+08:00' },
    { endAt: '2026-10-26T10:00:00+08:00' }, { endAt: '2026-10-26T09:00:00+08:00' },
    { startAt: '2026-10-26T10:00:00' }, { startAt: '2026-02-30T10:00:00+08:00' },
    { startAt: '2026-10-26T15:30:00Z', endAt: '2026-10-26T16:00:00Z' },
    { reason: ' ' }, { reason: '字'.repeat(1001) }, { requestId: 'abc' }, { kind: 'anything' },
    { userId: 'u-boss' }, { status: 'approved' }, { createdAt: '2026-10-01T00:00:00Z' },
  ]
  for (const patch of invalid) expect((await post(writer, draft(patch))).status, JSON.stringify(patch)).toBe(400)
  for (const body of [null, {}, [], '']) expect((await post(writer, body)).status).toBe(400)
  expect(await db.select().from(t.checkinRequests)).toHaveLength(0)
  // 跨 UTC 日期但属于同一北京时间日期有效。
  expect((await post(writer, draft({ startAt: '2026-10-25T23:00:00Z', endAt: '2026-10-26T01:00:00Z' }))).status).toBe(200)
})

it('老板可稍后审批提前提交的申请；员工不能审批，批准不改原始起止时间', async () => {
  const original = (await post(writer)).body.record
  for (const employee of [writer, sales, other]) {
    expect((await decide(employee, original.id)).status).toBe(403)
    expect((await decide(employee, 'unknown')).status).toBe(403)
  }
  expect((await decide(boss, original.id, { decision: 'approved', startAt: now })).status).toBe(400)
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'))
  const approved = await decide(boss, original.id, { decision: 'approved', decisionReason: '已提前沟通' })
  expect(approved.status).toBe(200)
  expect(approved.body.record).toEqual({ ...original, status: 'approved', decisionReason: '已提前沟通', decidedAt: '2026-10-27T00:00:00.000Z', decidedBy: 'u-boss' })
  vi.setSystemTime(new Date('2026-10-27T01:00:00Z'))
  expect((await decide(boss, original.id, { decision: 'approved', decisionReason: '已提前沟通' })).body).toEqual(approved.body)
  expect((await decide(boss, original.id, { decision: 'rejected', decisionReason: '改变主意' })).status).toBe(400)
  expect((await list(writer)).body.rows[0]).toEqual(approved.body.record)
})

it('拒绝原因必填，审批并发冲突只能保留一种结果', async () => {
  const original = (await post(sales)).body.record
  expect((await decide(boss, original.id, { decision: 'rejected' })).status).toBe(400)
  expect((await decide(boss, original.id, { decision: 'rejected', decisionReason: ' ' })).status).toBe(400)
  expect((await decide(boss, original.id, { decision: 'pending' })).status).toBe(400)
  const results = await Promise.all([
    decide(boss, original.id, { decision: 'approved' }),
    decide(boss, original.id, { decision: 'rejected', decisionReason: '请调整安排' }),
  ])
  expect(results.map(r => r.status).sort()).toEqual([200, 400])
  expect((await list(sales)).body.rows[0]).toEqual(results.find(r => r.status === 200)!.body.record)
  expect((await decide(boss, 'unknown')).status).toBe(404)
})

it('月份按北京时间的开始时间过滤，月末不丢记录；分页稳定且不串人', async () => {
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const dates = ['2026-09-30T23:00:00+08:00', '2026-10-01T00:00:00+08:00', '2026-10-31T23:00:00+08:00', '2026-11-01T00:00:00+08:00']
  for (const startAt of dates) await post(writer, draft({ startAt, endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString() }))
  await post(sales, draft())
  const first = (await list(writer, 'month=2026-10&limit=1')).body
  expect(first.rows).toHaveLength(1); expect(first.next).toBe(1); expect(first.total).toBe(2)
  expect(first.rows[0].startAt).toBe('2026-10-31T15:00:00.000Z')
  const second = (await list(writer, 'month=2026-10&limit=1&offset=1')).body
  expect(second.rows[0].startAt).toBe('2026-09-30T16:00:00.000Z'); expect(second.next).toBe(null); expect(second.total).toBe(2)
  expect((await list(writer, 'month=2026-10&limit=1&offset=2')).body).toMatchObject({ rows: [], next: null, total: 2 })
  const team = (await list(boss, 'month=2026-10&scope=team')).body
  expect(team.rows).toHaveLength(3); expect(team.total).toBe(3)
})

it('老板待审批跨月份读取，先筛选状态再分页；历史仍按月且员工不能使用全员队列', async () => {
  vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
  const previous = (await post(writer, draft({ startAt: '2026-09-30T10:00:00+08:00', endAt: '2026-09-30T11:00:00+08:00' }))).body.record
  const approved = (await post(sales)).body.record
  await decide(boss, approved.id)
  const nextMonth = (await post(other, draft({ startAt: '2026-11-01T10:00:00+08:00', endAt: '2026-11-01T11:00:00+08:00' }))).body.record
  const rejected = (await post(writer)).body.record
  await decide(boss, rejected.id, { decision: 'rejected', decisionReason: '调整安排后再申请' })
  vi.setSystemTime(new Date(now))

  const first = await list(boss, 'scope=team&status=pending&limit=1')
  expect(first.status).toBe(200)
  expect(first.body).toMatchObject({ month: null, scope: 'team', next: 1, total: 2 })
  expect(first.body.rows.map(row => row.id)).toEqual([previous.id])
  const second = (await list(boss, 'scope=team&status=pending&month=2026-10&limit=1&offset=1')).body
  expect(second.rows.map(row => row.id)).toEqual([nextMonth.id])
  expect(second.next).toBe(null); expect(second.total).toBe(2)
  const history = (await list(boss, 'scope=team&month=2026-10')).body
  expect(history.month).toBe('2026-10')
  expect(history.rows.map(row => row.id).sort()).toEqual([approved.id, rejected.id].sort())
  expect(history.total).toBe(2)
  await decide(boss, previous.id)
  expect((await list(boss, 'scope=team&status=pending&limit=1')).body.total).toBe(1)
  for (const employee of [writer, sales, other]) {
    expect((await list(employee, 'scope=team&status=pending')).status).toBe(403)
    expect((await list(employee, 'status=pending')).status).toBe(403)
  }
})

it('查询和变更拒绝未知、重复、超限参数与跨站请求，代理 Host 可正常使用', async () => {
  for (const query of ['userId=u-boss', 'scope=all', 'scope=', 'status=', 'status=approved', 'status=pending&status=pending', 'month=2026-13', 'month=', 'month=0000-01', 'month=2026-10&month=2026-11', 'limit=0', 'limit=201', 'limit=1.5', 'offset=-1', 'offset=100001']) expect((await list(writer, query)).status, query).toBe(400)
  expect((await POST(request(writer, '/api/checkin-requests', { method: 'POST', body: '{' }), params)).status).toBe(400)
  expect((await POST(request(writer, '/api/checkin-requests?x=1', { method: 'POST', body: JSON.stringify(draft()) }), params)).status).toBe(400)
  expect((await post(writer, draft(), { origin: 'https://other.example' })).status).toBe(403)
  expect((await post(writer, draft(), { origin: 'null' })).status).toBe(403)
  expect((await post(writer, draft(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  const original = (await post(writer)).body.record
  expect((await decide(boss, original.id, { decision: 'approved' }, { origin: 'https://other.example' })).status).toBe(403)
  const proxied = await POST(new Request('http://localhost:3000/api/checkin-requests', { method: 'POST', headers: { cookie: other.cookie, host: 'workbench.example.com', origin: 'https://workbench.example.com', 'content-type': 'application/json' }, body: JSON.stringify(draft()) }), params)
  expect(proxied.status).toBe(200)
})
