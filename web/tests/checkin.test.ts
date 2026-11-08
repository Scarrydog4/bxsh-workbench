import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { GET, POST } from '@/app/api/checkins/route'
import { GET as photoGet } from '@/app/api/checkins/[id]/photo/route'
import type { CheckinList, CheckinResult } from '@/shared/checkin'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, writer: Client, sales: Client, other: Client
const params = { params: Promise.resolve({}) }
const initialTime = '2026-10-25T01:02:03.000Z'
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='
const photosDir = path.join(process.env.TEST_STORAGE_DIR!, 'checkin-photos')
const files = async () => (await readdir(photosDir).catch(() => [] as string[])).sort()
const request = (client: Client | null, path: string, init: RequestInit = {}) => new Request(`http://test.local${path}`, {
  ...init, headers: { ...(client ? { cookie: client.cookie } : {}), 'content-type': 'application/json', ...init.headers },
})
async function post(client: Client | null, body: unknown = { kind: 'in', photo: image }, headers?: Record<string, string>) {
  const r = await POST(request(client, '/api/checkins', { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers }), params)
  return { status: r.status, body: await r.json() as CheckinResult }
}
async function list(client: Client | null, query = '') {
  const r = await GET(request(client, `/api/checkins${query ? '?' + query : ''}`), params)
  return { status: r.status, body: await r.json() as CheckinList }
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(initialTime))
  await resetDb()
  boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng'); other = await as('xiaoyang')
})
beforeEach(async () => {
  vi.setSystemTime(new Date(initialTime))
  await db.delete(t.dailyCheckins)
})
afterAll(async () => { vi.useRealTimers(); await closeDb() })

it('必须登录；账号禁用或要求改密码时不能打卡或读取记录', async () => {
  expect((await list(null)).status).toBe(401)
  expect((await post(null)).status).toBe(401)
  await db.update(t.users).set({ active: false }).where(eq(t.users.id, 'u-xiao'))
  expect((await post(writer)).status).toBe(401)
  expect((await list(writer)).status).toBe(401)
  await db.update(t.users).set({ active: true, mustChangePassword: true }).where(eq(t.users.id, 'u-xiao'))
  expect((await post(writer)).status).toBe(403)
  expect((await list(writer)).status).toBe(403)
  await db.update(t.users).set({ mustChangePassword: false }).where(eq(t.users.id, 'u-xiao'))
})

it('上下班并发重试只保留各自首次时间和照片，不重复新增图片', async () => {
  const filesBefore = await files()
  const attempts = await Promise.all(Array.from({ length: 6 }, () => post(writer)))
  expect(attempts.map(r => r.status)).toEqual(Array(6).fill(200))
  expect(attempts.filter(r => r.body.created)).toHaveLength(1)
  expect(new Set(attempts.map(r => r.body.record.id)).size).toBe(1)
  expect(attempts[0].body.record).toMatchObject({ userId: 'u-xiao', name: '肖森凯', day: '2026-10-25', clockInAt: initialTime, clockOutAt: null })
  expect((await files()).length).toBe(filesBefore.length + 1)
  const newFile = (await files()).find(f => !filesBefore.includes(f))!, originalPhoto = await readFile(path.join(photosDir, newFile))
  vi.setSystemTime(new Date('2026-10-25T14:59:00Z'))
  const retry = await post(writer)
  expect(retry.body).toEqual({ created: false, record: attempts[0].body.record })
  const outs = await Promise.all(Array.from({ length: 6 }, () => post(writer, { kind: 'out', photo: image })))
  expect(outs.filter(r => r.body.created)).toHaveLength(1)
  expect(outs.every(r => r.body.record.clockOutAt === '2026-10-25T14:59:00.000Z')).toBe(true)
  const filesAfter = await files()
  expect(filesAfter.length).toBe(filesBefore.length + 2)
  vi.setSystemTime(new Date('2026-10-25T15:59:00Z'))
  expect((await post(writer, { kind: 'out', photo: image })).body).toEqual({ created: false, record: outs[0].body.record })
  expect(await files()).toEqual(filesAfter)
  expect(await readFile(path.join(photosDir, newFile))).toEqual(originalPhoto)
  expect(await db.select().from(t.dailyCheckins)).toHaveLength(1)
  expect(await db.select().from(t.audit).where(eq(t.audit.objectType, 'checkin'))).toHaveLength(0)
})

it('员工只见本人；老板默认也看本人，明确选择全员才能看到所有人', async () => {
  await post(writer); await post(sales); await post(other)
  expect((await list(writer)).body.rows.map(r => r.userId)).toEqual(['u-xiao'])
  expect((await list(sales)).body.rows.map(r => r.userId)).toEqual(['u-acheng'])
  expect((await list(other)).body.rows.map(r => r.userId)).toEqual(['u-yang'])
  expect((await list(boss)).body.rows).toEqual([])
  for (const employee of [writer, sales, other]) expect((await list(employee, 'scope=team')).status).toBe(403)
  const team = (await list(boss, 'scope=team')).body
  expect(team.rows.map(r => r.userId).sort()).toEqual(['u-acheng', 'u-xiao', 'u-yang'])
  expect(team).toMatchObject({ today: '2026-10-25', month: '2026-10', todayRecord: null, summary: { recordCount: 3, peopleCount: 3, myDays: 0 } })
  expect(Object.keys(team.rows[0]).sort()).toEqual(['breakEndAt', 'breakMinutes', 'breakOvertimeMinutes', 'breakStartAt', 'clockInAt', 'clockInPhoto', 'clockOutAt', 'clockOutPhoto', 'day', 'earlyLeave', 'hue', 'id', 'isWorkday', 'late', 'name', 'overtimeMinutes', 'userId'])
})

it('给员工角色附加其他管理员权限，也不能读取全员打卡', async () => {
  const [role] = await db.select().from(t.roles).where(eq(t.roles.id, 'r-sales'))
  await db.update(t.roles).set({ perms: [...role.perms, 'audit.view', 'user.manage', 'income.all'], rowScope: 'all' }).where(eq(t.roles.id, 'r-sales'))
  expect((await list(sales, 'scope=team')).status).toBe(403)
  await db.update(t.roles).set({ perms: role.perms, rowScope: role.rowScope }).where(eq(t.roles.id, 'r-sales'))
})

it('北京时间午夜切换日期，次日下班不能补到前一天；查看旧月不影响今日状态', async () => {
  vi.setSystemTime(new Date('2026-10-31T15:59:59Z'))
  const before = await post(writer)
  expect(before.body.record.day).toBe('2026-10-31')
  vi.setSystemTime(new Date('2026-10-31T16:00:01Z'))
  expect((await post(writer, { kind: 'out', photo: image })).status).toBe(400)
  const after = await post(writer)
  expect(after.body.record.day).toBe('2026-11-01')
  expect(after.body.created).toBe(true)
  const oldMonth = (await list(writer, 'month=2026-10')).body
  expect(oldMonth.rows.map(r => r.day)).toEqual(['2026-10-31'])
  expect(oldMonth.rows[0].clockOutAt).toBe(null)
  expect(oldMonth.todayRecord).toEqual(after.body.record)
  expect((await list(writer)).body).toMatchObject({ month: '2026-11', today: '2026-11-01', rows: [after.body.record] })
})

it('不能伪造用户、日期或时间；拒绝非法正文和额外查询条件', async () => {
  for (const patch of [{ userId: 'u-boss' }, { day: '2026-01-01' }, { at: '2026-01-01T00:00:00Z' }, { clockInAt: initialTime }, { created: false }]) {
    expect((await post(writer, { kind: 'in', photo: image, ...patch })).status).toBe(400)
  }
  for (const body of [{}, { kind: 'in' }, { kind: 'out' }, { kind: 'in', photo: '' }, { kind: 'other', photo: image }, [], null, '']) {
    expect((await post(writer, body)).status).toBe(400)
  }
  expect((await POST(request(writer, '/api/checkins', { method: 'POST', body: '{' }), params)).status).toBe(400)
  expect((await POST(request(writer, '/api/checkins?userId=u-boss', { method: 'POST' }), params)).status).toBe(400)
  for (const query of ['userId=u-boss', 'scope=all', 'month=2026-00', 'month=2026-13', 'month=0000-01', 'month=2026-2', 'month=', 'month=2026-10&month=2026-11']) {
    expect((await list(writer, query)).status, query).toBe(400)
  }
  expect(await db.select().from(t.dailyCheckins)).toHaveLength(0)
})

it('拒绝跨站触发打卡，平台网页与无 Origin 原生请求都能使用', async () => {
  expect((await post(writer, undefined, { origin: 'https://other.example' })).status).toBe(403)
  expect((await post(writer, undefined, { origin: 'null' })).status).toBe(403)
  expect((await post(writer, undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  expect((await post(writer, undefined, { origin: 'http://test.local', 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  expect((await post(sales)).status).toBe(200)
  // 经 Caddy 转发后内部 URL 是 localhost，仍按原始 Host 验证来源。
  const proxied = await POST(new Request('http://localhost:3000/api/checkins', { method: 'POST', headers: { cookie: other.cookie, host: 'workbench.example.com', origin: 'https://workbench.example.com', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'in', photo: image }) }), params)
  expect(proxied.status).toBe(200)
})

it('月份范围保留闰日，停用员工的旧记录仍可供老板查看', async () => {
  await db.insert(t.dailyCheckins).values([
    { id: 'leap', userId: 'u-xiao', day: '2024-02-29', clockInAt: '2024-02-29T01:00:00Z', clockInPhoto: 'test-fixture' },
    { id: 'march', userId: 'u-xiao', day: '2024-03-01', clockInAt: '2024-03-01T01:00:00Z', clockInPhoto: 'test-fixture' },
  ])
  await db.update(t.users).set({ active: false }).where(eq(t.users.id, 'u-xiao'))
  const feb = (await list(boss, 'month=2024-02&scope=team')).body
  expect(feb.rows.map(r => r.id)).toEqual(['leap'])
  expect(feb.summary).toEqual({ recordCount: 1, peopleCount: 1, myDays: 0 })
  await db.update(t.users).set({ active: true }).where(eq(t.users.id, 'u-xiao'))
})

it('两次均需真实图片；未上班不能下班，失败不留下记录或文件', async () => {
  const before = await files()
  expect((await post(writer, { kind: 'out', photo: image })).status).toBe(400)
  for (const photo of ['https://example.com/photo.jpg', 'data:image/png;base64,bm90IGFuIGltYWdl', 'data:image/png;base64,%%%']) {
    expect((await post(writer, { kind: 'in', photo })).status).toBe(400)
  }
  expect(await db.select().from(t.dailyCheckins)).toHaveLength(0)
  expect(await files()).toEqual(before)
  await post(writer)
  expect((await post(writer, { kind: 'out', photo: 'data:image/png;base64,bm90IGFuIGltYWdl' })).status).toBe(400)
  expect((await list(writer)).body.todayRecord?.clockOutAt).toBeNull()
})

it('上下班照片私有鉴权并重编码为 WebP；员工不能查看他人照片', async () => {
  const source = await sharp(Buffer.from(image.split(',')[1], 'base64')).jpeg().withMetadata({ exif: { IFD0: { Artist: 'private-camera-owner' } } }).toBuffer()
  expect((await sharp(source).metadata()).exif).toBeDefined()
  const result = await post(writer, { kind: 'in', photo: 'data:image/jpeg;base64,' + source.toString('base64') }), id = result.body.record.id
  const get = (client: Client | null, kind: string) => photoGet(request(client, `/api/checkins/${id}/photo?kind=${kind}`), { params: Promise.resolve({ id }) })
  expect((await get(null, 'in')).status).toBe(401)
  for (const employee of [sales, other]) expect((await get(employee, 'in')).status).toBe(404)
  expect((await get(writer, 'out')).status).toBe(404)
  const own = await get(writer, 'in'), admin = await get(boss, 'in')
  expect(own.status).toBe(200); expect(admin.status).toBe(200)
  expect(own.headers.get('cache-control')).toBe('private, no-store')
  const bytes = Buffer.from(await own.arrayBuffer())
  expect(bytes.toString('ascii', 8, 12)).toBe('WEBP')
  expect((await sharp(bytes).metadata()).exif).toBeUndefined()
  expect(JSON.stringify(result.body)).not.toContain(photosDir)
  expect(JSON.stringify(result.body)).not.toContain('data:image')
  await post(writer, { kind: 'out', photo: image })
  expect((await get(writer, 'out')).status).toBe(200)
  expect((await get(sales, 'out')).status).toBe(404)
})

it('工作日按北京时间10:00和20:00标迟到早退，周末不标且没有工资处罚', async () => {
  vi.setSystemTime(new Date('2026-10-25T02:30:00Z'))
  expect((await post(other)).body.record).toMatchObject({ isWorkday: false, late: false })
  vi.setSystemTime(new Date('2026-10-25T11:00:00Z'))
  expect((await post(other, { kind: 'out', photo: image })).body.record.earlyLeave).toBe(false)
  vi.setSystemTime(new Date('2026-10-26T02:00:00Z'))
  expect((await post(writer)).body.record.late).toBe(false)
  vi.setSystemTime(new Date('2026-10-26T02:00:01Z'))
  expect((await post(sales)).body.record.late).toBe(true)
  vi.setSystemTime(new Date('2026-10-26T11:59:59Z'))
  expect((await post(writer, { kind: 'out', photo: image })).body.record.earlyLeave).toBe(true)
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
  expect((await post(sales, { kind: 'out', photo: image })).body.record.earlyLeave).toBe(false)
  expect((await list(writer)).body.schedule).toMatchObject({ start: '10:00', end: '20:00', timeZone: 'Asia/Shanghai', breakMinutes: 90 })
})

it('午休只点按钮并保留第一次时间，必须按上班、午休开始、午休结束、下班顺序', async () => {
  expect((await post(writer, { kind: 'break-start' })).status).toBe(400)
  expect((await post(writer, { kind: 'break-end' })).status).toBe(400)
  await post(writer)
  expect((await post(writer, { kind: 'break-end' })).status).toBe(400)
  expect((await post(writer, { kind: 'break-start', photo: image })).status).toBe(400)
  const oldFiles = await files()
  vi.setSystemTime(new Date('2026-10-25T04:00:00Z'))
  const starts = await Promise.all([post(writer, { kind: 'break-start' }), post(writer, { kind: 'break-start' })])
  expect(starts.filter(r => r.body.created)).toHaveLength(1)
  expect(starts[0].body.record.breakStartAt).toBe('2026-10-25T04:00:00.000Z')
  expect((await post(writer, { kind: 'out', photo: image })).status).toBe(400)
  vi.setSystemTime(new Date('2026-10-25T05:30:00Z'))
  expect((await list(writer)).body.todayRecord).toMatchObject({ breakMinutes: 90, breakOvertimeMinutes: 0, breakEndAt: null })
  vi.setSystemTime(new Date('2026-10-25T05:31:00Z'))
  const ends = await Promise.all([post(writer, { kind: 'break-end' }), post(writer, { kind: 'break-end' })])
  expect(ends.filter(r => r.body.created)).toHaveLength(1)
  expect(ends[0].body.record).toMatchObject({ breakEndAt: '2026-10-25T05:31:00.000Z', breakMinutes: 91, breakOvertimeMinutes: 1 })
  expect(await files()).toEqual(oldFiles)
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
  expect((await post(writer, { kind: 'out', photo: image })).status).toBe(200)
  expect((await post(writer, { kind: 'break-start' })).body.record.breakStartAt).toBe('2026-10-25T04:00:00.000Z')
  await post(sales)
  await post(sales, { kind: 'out', photo: image })
  expect((await post(sales, { kind: 'break-start' })).status).toBe(400)
})

it('20点后实际在岗时长在下班后才生成，扣除午休重叠，不默认扣90分钟', async () => {
  vi.setSystemTime(new Date('2026-10-26T02:00:00Z'))
  await post(writer)
  expect((await list(writer)).body.todayRecord).toMatchObject({ overtimeMinutes: null, breakMinutes: null, breakOvertimeMinutes: 0 })
  vi.setSystemTime(new Date('2026-10-26T12:15:00Z'))
  await post(writer, { kind: 'break-start' })
  vi.setSystemTime(new Date('2026-10-26T12:45:00Z'))
  await post(writer, { kind: 'break-end' })
  vi.setSystemTime(new Date('2026-10-26T13:00:00Z'))
  expect((await post(writer, { kind: 'out', photo: image })).body.record).toMatchObject({ overtimeMinutes: 30, breakMinutes: 30 })
  vi.setSystemTime(new Date('2026-10-26T14:00:00Z'))
  await post(sales)
  vi.setSystemTime(new Date('2026-10-26T15:00:00Z'))
  expect((await post(sales, { kind: 'out', photo: image })).body.record).toMatchObject({ overtimeMinutes: 60, breakMinutes: null })
})

it('打卡和读取记录不改订单、工资约定、收款或已发工资', async () => {
  await db.insert(t.orders).values({ id: 'kept-order', no: 'TEST-1', title: '隔离库账目', orderDate: '2026-10-01', ownerId: 'u-acheng', creatorId: 'u-boss', basePrice: 1000, status: '已交付', commissionRate: .2 })
  await db.insert(t.orderWriters).values({ orderId: 'kept-order', userId: 'u-xiao', pay: 200, rate: .2 })
  await db.insert(t.settlements).values({ id: 'kept-pay', kind: '写手工资', payeeId: 'u-xiao', orderId: 'kept-order', amount: 100, status: '已确认' })
  const ledger = () => Promise.all([db.select().from(t.orders), db.select().from(t.orderWriters), db.select().from(t.payments), db.select().from(t.settlements), db.select().from(t.settleBatches)])
  const before = await ledger()
  await post(writer); await post(sales); await list(writer); await list(boss, 'scope=team')
  expect(await ledger()).toEqual(before)
})
