import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET as internalGet, POST as internalPost } from '@/app/api/orders/[id]/customer/route'
import { GET as customerGet, POST as customerPost } from '@/app/api/customer/[token]/route'
import { GET as customerImage } from '@/app/api/customer/[token]/images/[id]/route'
import { GET as internalImage } from '@/app/api/orders/[id]/customer/images/[imageId]/route'
import type { CustomerPortalInternal, CustomerPortalView, CustomerRequest } from '@/shared/customer-portal'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

const base = 'http://test.local'
const now = '2026-10-26T02:00:00.000Z'
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='
let boss: Client, sales: Client, otherSales: Client, writer: Client, gold: Client, channelId: string
let testNumber = 0

type PublicResult = CustomerPortalView & { request: CustomerRequest; error?: string }
type InternalResult = CustomerPortalInternal & { ok?: boolean; error?: string }
const request = (path: string, client: Client | null = null, body?: unknown) => new Request(`${base}${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(client ? { cookie: client.cookie } : {}), 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${testNumber}` },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const internal = async (client: Client | null, id: string, body?: unknown, offset?: number) => {
  const response = await (body === undefined ? internalGet : internalPost)(request(`/api/orders/${id}/customer${offset === undefined ? '' : `?offset=${offset}`}`, client, body), { params: Promise.resolve({ id }) })
  return { status: response.status, body: await response.json() as InternalResult }
}
const publicRead = async (token: string, clientId = randomUUID()) => {
  const response = await customerGet(request(`/api/customer/${token}?clientId=${encodeURIComponent(clientId)}`), { params: Promise.resolve({ token }) })
  return { status: response.status, headers: response.headers, body: await response.json() as PublicResult }
}
const draft = (clientId = randomUUID(), patch: Record<string, unknown> = {}) => ({ clientId, requestId: randomUUID(), kind: 'requirement', name: '客户甲', body: '请核对第三章的图注。', shots: [] as string[], ...patch })
const submit = async (token: string, body: unknown = draft()) => {
  const response = await customerPost(request(`/api/customer/${token}`, null, body), { params: Promise.resolve({ token }) })
  return { status: response.status, body: await response.json() as PublicResult }
}
const publicImage = (url: string) => {
  const parsed = new URL(url, base), segments = parsed.pathname.split('/')
  return customerImage(request(parsed.pathname + parsed.search), { params: Promise.resolve({ token: segments[3], id: segments[5] }) })
}
const privateImage = (client: Client | null, orderId: string, imageId: string) => internalImage(request(`/api/orders/${orderId}/customer/images/${imageId}`, client), { params: Promise.resolve({ id: orderId, imageId }) })
async function order(assignees = [{ userId: 'u-xiao', pay: 120, rate: null }]) {
  const result = await boss.act('order.create', { title: `客户入口验收 ${randomUUID().slice(0, 8)}`, channelId, ownerId: 'u-acheng', orderDate: '2026-10-26', dueDate: '2026-11-02', basePrice: 1000, assignees, note: '内部备注不可公开', channelNo: 'PRIVATE-CHANNEL-NO' })
  expect(result.status).toBe(200)
  return result.body.id as string
}
async function link(id: string, client = sales) {
  const result = await internal(client, id, { action: 'create' })
  expect(result.status).toBe(200)
  expect(result.body.link.active).toBe(true)
  expect(result.body.link.path).toMatch(/^\/customer\/[^/?#]+$/)
  return result.body.link.path!.split('/').pop()!
}
const at = (value: string | number) => vi.setSystemTime(new Date(value))

beforeAll(async () => {
  // resetDb 会重建 schema；本文件只能在专属合成数据测试库运行。
  const target = new URL(process.env.TEST_DATABASE_URL ?? '')
  if (target.hostname !== '127.0.0.1' || target.port !== '5433' || target.pathname !== '/workbench_customer_portal_test_20261026' || process.env.TEST_STORAGE_DIR !== '/tmp/bxsh-customer-portal-test-20261026') throw new Error('客户入口测试必须使用指定的本地独立数据库及目录')
  vi.useFakeTimers({ toFake: ['Date'] }); at(now)
  await resetDb()
  const [sample] = await db.select().from(t.users).where(eq(t.users.id, 'u-xiao'))
  await db.insert(t.users).values({ id: 'u-gold', account: 'portal-gold', name: '测试 goldcode', roleId: 'r-writer', canWrite: true, passwordHash: sample.passwordHash, mustChangePassword: false })
  boss = await as('boss'); sales = await as('acheng'); otherSales = await as('xiaoyang'); writer = await as('xiaosenkai'); gold = await as('portal-gold')
  const result = await boss.act('channel.create', { name: '客户入口合成测试渠道', ownerId: 'u-acheng' })
  expect(result.status).toBe(200); channelId = result.body.id
})
beforeEach(() => { testNumber++; at(now) })
afterAll(async () => { vi.useRealTimers(); await closeDb() })

it('内部入口要求登录和订单权限，老板及归属销售能管理，写手只能处理本人订单', async () => {
  const id = await order()
  expect((await internal(null, id)).status).toBe(401)
  expect((await internal(null, id, { action: 'create' })).status).toBe(401)
  for (const outsider of [otherSales, gold]) {
    expect((await internal(outsider, id)).status).toBe(404)
    for (const action of ['create', 'revoke', 'resolve']) expect((await internal(outsider, id, { action, ...(action === 'resolve' ? { requestId: randomUUID() } : {}) })).status).toBe(404)
  }
  for (const manager of [boss, sales]) expect((await internal(manager, id)).body).toMatchObject({ canManage: true, canResolve: true, link: { active: false, path: null }, requests: [] })
  expect((await internal(writer, id)).body).toMatchObject({ canManage: false, canResolve: true })
  expect((await internal(writer, id, { action: 'create' })).status).toBe(403)
  expect((await internal(writer, id, { action: 'revoke' })).status).toBe(403)
  const token = await link(id, boss)
  expect((await internal(sales, id)).body.link).toMatchObject({ id: expect.any(String), active: true, path: null })
  const crossSite = await customerPost(new Request(`${base}/api/customer/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://foreign.example', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify(draft()) }), { params: Promise.resolve({ token }) })
  expect(crossSite.status).toBe(403)
  expect((await internal(sales, id)).body.requests).toEqual([])
  const [role] = await db.select().from(t.roles).where(eq(t.roles.id, 'r-sales'))
  try {
    await db.update(t.roles).set({ perms: role.perms.filter(p => p !== 'order.create') }).where(eq(t.roles.id, role.id))
    expect((await internal(sales, id)).body.canManage).toBe(false)
    expect((await internal(sales, id, { action: 'create' })).status).toBe(403)
    expect((await internal(sales, id, { action: 'revoke' })).status).toBe(403)
    expect((await publicRead(token)).status).toBe(200)
  } finally { await db.update(t.roles).set({ perms: role.perms }).where(eq(t.roles.id, role.id)) }
  const linkId = (await internal(sales, id)).body.link.id!
  const historical = Array.from({ length: 101 }, (_, i) => ({ id: randomUUID(), orderId: id, linkId, clientId: randomUUID(), requestId: randomUUID(), payloadHash: 'isolated-pagination-fixture', kind: 'requirement' as const, body: `历史要求 ${i + 1}`, createdAt: new Date(Date.parse(now) - (i + 1) * 86400_000).toISOString() }))
  await db.insert(t.customerRequests).values(historical)
  const firstPage = (await internal(writer, id, undefined, 0)).body
  expect(firstPage).toMatchObject({ hasMore: true, nextOffset: 100 })
  expect(firstPage.requests).toHaveLength(100)
  const lastPage = (await internal(writer, id, undefined, firstPage.nextOffset!)).body
  expect(lastPage).toMatchObject({ hasMore: false, nextOffset: null })
  expect(lastPage.requests).toHaveLength(1)
  expect([...firstPage.requests, ...lastPage.requests].map(r => r.id)).toEqual(historical.map(r => r.id))
})

it('公开页面只返回约定的订单字段，同一链接下不同浏览器看不到对方提交内容', async () => {
  const id = await order(), token = await link(id), a = randomUUID(), b = randomUUID()
  const first = await submit(token, draft(a, { name: '客户甲', body: '仅甲浏览器可见' }))
  const second = await submit(token, draft(b, { name: '客户乙', body: '仅乙浏览器可见' }))
  expect(first.status).toBe(200); expect(second.status).toBe(200)
  expect(Object.keys(first.body.request).sort()).toEqual(['id', 'kind', 'name', 'body', 'shots', 'status', 'reply', 'createdAt', 'handledAt'].sort())
  for (const [clientId, own, hidden] of [[a, first.body.request, '仅乙浏览器可见'], [b, second.body.request, '仅甲浏览器可见']] as const) {
    const result = await publicRead(token, clientId)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.headers.get('referrer-policy')).toBe('no-referrer')
    expect(Object.keys(result.body.order).sort()).toEqual(['dueDate', 'status', 'title'])
    expect(result.body.order).toMatchObject({ status: '未交付', dueDate: '2026-11-02' })
    expect(result.body.requests.map(r => r.id)).toEqual([own.id])
    const serialized = JSON.stringify(result.body)
    for (const secret of [hidden, '内部备注不可公开', 'PRIVATE-CHANNEL-NO', 'basePrice', 'commissionRate', 'payeeId', 'passwordHash', 'u-xiao']) expect(serialized).not.toContain(secret)
  }
  expect((await publicRead(token)).body.requests).toEqual([])
  expect((await internal(writer, id)).body.requests.map(r => r.id).sort()).toEqual([first.body.request.id, second.body.request.id].sort())
})

it('每次生成都轮换链接，旧链接和撤销链接读写均失效，内部保留原提交记录', async () => {
  const id = await order(), a = await link(id), clientId = randomUUID()
  const input = draft(clientId), original = await submit(a, input)
  expect(original.status).toBe(200)
  const b = await link(id)
  expect(b).not.toBe(a)
  expect((await publicRead(a, clientId)).status).toBe(404)
  expect((await submit(a, draft(clientId))).status).toBe(404)
  const afterRotation = await publicRead(b, clientId)
  expect(afterRotation.status).toBe(200)
  expect(afterRotation.body.requests.map(r => r.id)).toEqual([original.body.request.id])
  const retryAfterRotation = await submit(b, input)
  expect(retryAfterRotation.status).toBe(200)
  expect(retryAfterRotation.body.request.id).toBe(original.body.request.id)
  expect((await internal(sales, id)).body.requests.map(r => r.id)).toEqual([original.body.request.id])
  expect((await internal(sales, id, { action: 'revoke' })).body).toEqual({ ok: true })
  expect((await publicRead(b, clientId)).status).toBe(404)
  expect((await submit(b, draft(clientId))).status).toBe(404)
  expect((await internal(boss, id)).body.link).toMatchObject({ active: false, path: null })
})

it('本人订单写手可处理并回复，不能借其他订单入口处理越界请求', async () => {
  const id = await order(), token = await link(id), clientId = randomUUID()
  const submitted = await submit(token, draft(clientId))
  expect(submitted.status).toBe(200)
  const record = submitted.body.request
  expect(record).toMatchObject({ status: 'pending', reply: '', handledAt: null })
  expect(Date.parse(record.createdAt)).toBe(Date.parse(now))
  const anotherId = await order()
  expect((await internal(writer, anotherId, { action: 'resolve', requestId: record.id, reply: '不能串单' })).status).toBe(404)
  expect((await internal(otherSales, id, { action: 'resolve', requestId: record.id })).status).toBe(404)
  at(Date.parse(now) + 60_000)
  expect((await internal(writer, id, { action: 'resolve', requestId: record.id, reply: '已核对并更新图注。' })).body).toEqual({ ok: true })
  const visible = (await publicRead(token, clientId)).body.requests
  expect(visible).toHaveLength(1)
  expect(visible[0]).toMatchObject({ ...record, status: 'handled', reply: '已核对并更新图注。', handledAt: expect.any(String) })
  expect(Date.parse(visible[0].handledAt!)).toBe(Date.parse(now) + 60_000)
  expect((await publicRead(token)).body.requests).toEqual([])
})

it('相同请求并发重试只创建一条记录，内容变化返回409且不重复通知', async () => {
  const id = await order(), token = await link(id), input = draft()
  const before = new Set((await db.select().from(t.notifications).where(eq(t.notifications.orderId, id))).map(n => n.id))
  const repeated = await Promise.all(Array.from({ length: 5 }, () => submit(token, input)))
  expect(repeated.map(r => r.status)).toEqual(Array(5).fill(200))
  expect(new Set(repeated.map(r => r.body.request.id)).size).toBe(1)
  for (const patch of [{ body: '改成别的要求' }, { name: '不同的客户名' }, { kind: 'nudge' }, { shots: [png] }]) expect((await submit(token, { ...input, ...patch })).status).toBe(409)
  expect((await internal(sales, id)).body.requests).toHaveLength(1)
  const notes = (await db.select().from(t.notifications).where(eq(t.notifications.orderId, id))).filter(n => !before.has(n.id))
  expect(notes.map(n => n.userId).sort()).toEqual(['u-acheng', 'u-xiao'])
})

it('催单按整单冷却30分钟、每天最多6次，换浏览器不能绕过且重试不占额度', async () => {
  const id = await order(), token = await link(id), start = Date.parse(now), firstInput = draft(randomUUID(), { kind: 'nudge', body: '' })
  const first = await submit(token, firstInput)
  expect(first.status).toBe(200)
  expect(Date.parse(first.body.nudgeAvailableAt!)).toBe(start + 30 * 60_000)
  expect((await submit(token, firstInput)).status).toBe(200)
  expect((await submit(token, draft(randomUUID(), { kind: 'nudge', body: '' }))).status).toBe(429)
  at(start + 30 * 60_000 - 1)
  expect((await submit(token, draft(randomUUID(), { kind: 'nudge', body: '' }))).status).toBe(429)
  for (let i = 1; i < 6; i++) {
    at(start + i * 30 * 60_000)
    expect((await submit(token, draft(randomUUID(), { kind: 'nudge', body: '' }))).status).toBe(200)
  }
  at(start + 6 * 30 * 60_000)
  expect((await submit(token, draft(randomUUID(), { kind: 'nudge', body: '' }))).status).toBe(429)
  expect((await internal(sales, id)).body.requests).toHaveLength(6)
  // 北京时间跨日后恢复；UTC仍是同一天，避免按服务器时区重置。
  at('2026-10-26T16:00:00.000Z')
  expect((await submit(token, draft(randomUUID(), { kind: 'nudge', body: '' }))).status).toBe(200)
})

it('要求每天最多20条，轮换链接及换浏览器均不重置整单额度', async () => {
  const id = await order(), token = await link(id)
  for (let i = 0; i < 20; i++) expect((await submit(token, draft())).status).toBe(200)
  expect((await submit(token, draft())).status).toBe(429)
  const rotated = await link(id)
  expect((await submit(rotated, draft())).status).toBe(429)
  expect((await internal(sales, id)).body.requests).toHaveLength(20)
  at('2026-10-26T16:00:00.000Z')
  expect((await submit(rotated, draft())).status).toBe(200)
})

it('拒绝无效编号、超长文本、超过3张或总计6MB图片，不创建半条请求', async () => {
  const id = await order(), token = await link(id)
  const malformed = [
    { clientId: 'not-a-uuid' }, { requestId: 'not-a-uuid' }, { kind: 'payment' },
    { body: '字'.repeat(2001) }, { body: '', shots: [] }, { shots: [png, png, png, png] },
    { shots: ['data:image/png;base64,aW52YWxpZA=='] }, { shots: ['https://example.invalid/private.png'] },
  ]
  for (const patch of malformed) expect((await submit(token, draft(randomUUID(), patch))).status, JSON.stringify(patch).slice(0, 150)).toBe(400)
  const tooLargeTogether = `data:image/png;base64,${Buffer.concat([Buffer.from(png.split(',')[1], 'base64'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64')}`
  expect([400, 413]).toContain((await submit(token, draft(randomUUID(), { shots: [tooLargeTogether, tooLargeTogether, tooLargeTogether] }))).status)
  expect((await internal(sales, id)).body.requests).toEqual([])
  expect((await submit(token, draft(randomUUID(), { body: '字'.repeat(2000) }))).status).toBe(200)
  expect((await submit(token, draft(randomUUID(), { body: '', shots: [png, png, png] }))).status).toBe(200)
})

it('截图按客户浏览器隔离，内部走订单权限；换链接、撤销及跨订单访问均不能读取', async () => {
  const id = await order(), token = await link(id), clientId = randomUUID()
  const submitted = await submit(token, draft(clientId, { shots: [png] }))
  expect(submitted.status).toBe(200)
  const publicUrl = new URL(submitted.body.request.shots[0], base)
  expect(publicUrl.pathname).toMatch(new RegExp(`^/api/customer/${token}/images/[^/]+$`))
  expect(publicUrl.searchParams.get('clientId')).toBe(clientId)
  const imageId = publicUrl.pathname.split('/').pop()!
  const image = await publicImage(publicUrl.toString())
  expect(image.status).toBe(200)
  expect(image.headers.get('content-type')).toMatch(/^image\//)
  expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0)
  const wrongBrowser = new URL(publicUrl); wrongBrowser.searchParams.set('clientId', randomUUID())
  expect((await publicImage(wrongBrowser.toString())).status).toBe(404)
  const missingBrowser = new URL(publicUrl); missingBrowser.searchParams.delete('clientId')
  expect((await publicImage(missingBrowser.toString())).status).toBe(400)
  const internalRecord = (await internal(writer, id)).body.requests.find(r => r.id === submitted.body.request.id)!
  expect(internalRecord.shots).toEqual([`/api/orders/${id}/customer/images/${imageId}`])
  for (const colleague of [boss, sales, writer]) expect((await privateImage(colleague, id, imageId)).status).toBe(200)
  for (const outsider of [otherSales, gold]) expect((await privateImage(outsider, id, imageId)).status).toBe(404)
  expect((await privateImage(null, id, imageId)).status).toBe(401)
  const secondId = await order(), secondToken = await link(secondId)
  expect((await privateImage(boss, secondId, imageId)).status).toBe(404)
  expect((await publicImage(`/api/customer/${secondToken}/images/${imageId}?clientId=${clientId}`)).status).toBe(404)
  const currentToken = await link(id)
  expect((await publicImage(publicUrl.toString())).status).toBe(404)
  const currentUrl = `/api/customer/${currentToken}/images/${imageId}?clientId=${clientId}`
  expect((await publicImage(currentUrl)).status).toBe(200)
  expect((await internal(sales, id, { action: 'revoke' })).status).toBe(200)
  expect((await publicImage(currentUrl)).status).toBe(404)
  expect((await privateImage(writer, id, imageId)).status).toBe(200)
})

it('未知链接、退单和软删除订单禁止公开访问，退单内部历史仍可查看及停用', async () => {
  const unknown = randomUUID()
  expect((await publicRead(unknown)).status).toBe(404)
  expect((await submit(unknown)).status).toBe(404)
  for (const patch of [{ status: '退单' }, { deletedAt: now }]) {
    const id = await order(), token = await link(id)
    await db.update(t.orders).set(patch).where(eq(t.orders.id, id))
    expect((await publicRead(token)).status).toBe(404)
    expect((await submit(token)).status).toBe(404)
    if (patch.status === '退单') {
      expect((await internal(sales, id)).status).toBe(200)
      expect((await internal(boss, id, { action: 'create' })).status).toBe(400)
      expect((await internal(sales, id, { action: 'revoke' })).status).toBe(200)
    } else {
      expect((await internal(sales, id)).status).toBe(404)
      expect((await internal(boss, id, { action: 'create' })).status).toBe(404)
    }
  }
})

it('客户要求只通知当前归属销售和写手，提交及处理不改变订单、收款、工资或成本', async () => {
  const id = await order([{ userId: 'u-gold', pay: 120, rate: null }]), token = await link(id)
  await db.insert(t.payments).values({ id: randomUUID(), orderId: id, amount: 300, date: '2026-10-26', tag: '定金', by: 'u-acheng' })
  await db.insert(t.settlements).values({ id: randomUUID(), orderId: id, payeeId: 'u-gold', kind: '写手工资', amount: 60, status: '已确认', confirmedAt: now })
  await db.insert(t.orderCosts).values({ id: randomUUID(), orderId: id, name: '实物外包', amount: 200, date: '2026-10-26', by: 'u-boss' })
  const snapshot = async () => ({
    orders: await db.select().from(t.orders).where(eq(t.orders.id, id)),
    writers: await db.select().from(t.orderWriters).where(eq(t.orderWriters.orderId, id)),
    payments: await db.select().from(t.payments).where(eq(t.payments.orderId, id)),
    settlements: await db.select().from(t.settlements).where(eq(t.settlements.orderId, id)),
    batches: await db.select().from(t.settleBatches),
    costs: await db.select().from(t.orderCosts).where(eq(t.orderCosts.orderId, id)),
    adjustments: await db.select().from(t.adjustments).where(eq(t.adjustments.orderId, id)),
    progress: await db.select().from(t.writerProgress).where(eq(t.writerProgress.orderId, id)),
    aftersales: await db.select().from(t.afterSales).where(eq(t.afterSales.orderId, id)),
  })
  const before = await snapshot(), notificationIds = new Set((await db.select().from(t.notifications).where(eq(t.notifications.orderId, id))).map(n => n.id))
  const submitted = await submit(token, draft())
  expect(submitted.status).toBe(200)
  const notes = (await db.select().from(t.notifications).where(eq(t.notifications.orderId, id))).filter(n => !notificationIds.has(n.id))
  expect(notes.map(n => n.userId).sort()).toEqual(['u-acheng', 'u-gold'])
  expect((await internal(writer, id)).status).toBe(404)
  expect((await internal(gold, id, { action: 'resolve', requestId: submitted.body.request.id, reply: '要求已收到' })).status).toBe(200)
  expect(await snapshot()).toEqual(before)
})
