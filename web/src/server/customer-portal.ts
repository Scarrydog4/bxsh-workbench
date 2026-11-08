import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { CUSTOMER_PORTAL_LIMITS as limits, type CustomerPortalInternal, type CustomerPortalView, type CustomerRequest } from '@/shared/customer-portal'
import { can, rowVisible } from '@/shared/perm'
import { db, type DB, type Tx } from './db'
import * as t from './schema'
import { bad, deny, HttpError, json, notFound } from './http'
import { clientIp, type Ctx } from './session'
import { trustedWriteRequest } from './request-security'
import { env } from './env'
import { notify } from './notify'
import { broadcast } from './events'
import { fileResponse } from './range-response'

const uuid = z.string().uuid()
const submission = z.object({
  clientId: uuid,
  requestId: uuid,
  kind: z.enum(['nudge', 'requirement']),
  name: z.string().trim().max(limits.nameLength).default(''),
  body: z.string().trim().max(limits.bodyLength).default(''),
  shots: z.array(z.string().max(limits.requestBytes)).max(limits.images).default([]),
}).strict()
const management = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('revoke') }).strict(),
  z.object({ action: z.literal('resolve'), requestId: uuid, reply: z.string().trim().max(limits.bodyLength).default('') }).strict(),
])
type RequestRow = typeof t.customerRequests.$inferSelect
const unavailable = () => notFound('链接已失效，请联系工作人员获取新的链接')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const nowISO = () => new Date().toISOString()
const imagePath = (id: string) => path.join(env.storageDir, 'customer-images', `${id}.webp`)
const publicHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' }

// 匿名入口独立、短窗口限流；不影响员工接口。实例内只保留固定数量的短期记录。
const buckets = new Map<string, { until: number; count: number }>()
function limitIp(req: Request) {
  const now = Date.now(), write = req.method === 'POST'
  const key = `${write ? 'write' : 'read'}:${clientIp(req).slice(0, 100) || 'unknown'}`
  if (buckets.size >= 5000) for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id)
  const bucket = buckets.get(key)
  if (bucket && bucket.until > now) {
    if (++bucket.count > (write ? 30 : 240)) throw new HttpError(429, '操作较频繁，请稍后再试')
  } else {
    if (buckets.size >= 5000) throw new HttpError(429, '访问较多，请稍后再试')
    buckets.set(key, { until: now + 60_000, count: 1 })
  }
}

/** 匿名路由也执行来源检查；不会放开员工 API 或通用上传入口。 */
export function customerRoute<P>(fn: (req: Request, params: P) => Promise<Response>) {
  return async (req: Request, extra: { params: Promise<P> }) => {
    try {
      if (!trustedWriteRequest(req)) throw deny('请在客户页面内操作')
      limitIp(req)
      const response = await fn(req, await extra.params)
      for (const [key, value] of Object.entries(publicHeaders)) response.headers.set(key, value)
      return response
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Customer portal request failed', error)
      return json({ error: error instanceof HttpError ? error.message : '暂时无法处理，请稍后再试' }, { status: error instanceof HttpError ? error.status : 500, headers: publicHeaders })
    }
  }
}

/** Content-Length 可缺失或被伪造，实际读取也有上限，避免先缓冲任意大小的图片。 */
async function readJson(req: Request, maxBytes: number) {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw bad('请求格式不正确')
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError(413, '图片内容过大，请减少图片或压缩后再试')
  const reader = req.body?.getReader()
  if (!reader) throw bad('请填写提交内容')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new HttpError(413, '图片内容过大，请减少图片或压缩后再试')
    }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { throw bad('请求格式不正确') }
}

function parseClient(value: string | null) {
  const parsed = uuid.safeParse(value)
  if (!parsed.success) throw bad('请刷新页面后重试')
  return parsed.data
}

async function orderRow(database: DB | Tx, orderId: string, lock = false) {
  const query = database.select({ id: t.orders.id, title: t.orders.title, status: t.orders.status, dueDate: t.orders.dueDate, ownerId: t.orders.ownerId })
    .from(t.orders).where(and(eq(t.orders.id, orderId), isNull(t.orders.deletedAt))).limit(1)
  const [order] = await (lock ? query.for('update') : query)
  if (!order) throw unavailable()
  const assignees = await database.select({ userId: t.orderWriters.userId }).from(t.orderWriters).where(eq(t.orderWriters.orderId, orderId))
  return { ...order, assignees }
}

async function internalOrder(database: DB | Tx, orderId: string, ctx: Ctx, lock = false) {
  const order = await orderRow(database, orderId, lock)
  if (!can(ctx.role, 'order.view') || !rowVisible(order, ctx.me, ctx.role)) throw notFound()
  return {
    ...order,
    canManage: ctx.role.locked || order.ownerId === ctx.me.id && can(ctx.role, 'order.create'),
    canResolve: ctx.role.locked || order.ownerId === ctx.me.id || order.assignees.some(a => a.userId === ctx.me.id),
  }
}

async function tokenLink(database: DB | Tx, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable()
  const [link] = await database.select().from(t.customerLinks).where(and(eq(t.customerLinks.tokenHash, hash(token)), isNull(t.customerLinks.revokedAt))).limit(1)
  if (!link) throw unavailable()
  return link
}

async function publicOrder(database: DB | Tx, token: string, lock = false) {
  let link = await tokenLink(database, token)
  const order = await orderRow(database, link.orderId, lock)
  // 创建、停用、提交共用该订单的行锁；等待锁期间被停用的链接不能继续提交。
  if (lock) link = await tokenLink(database, token)
  if (order.status === '退单') throw unavailable()
  return { order, link }
}

function toRequest(row: RequestRow, imageUrl: (id: string) => string): CustomerRequest {
  return { id: row.id, kind: row.kind, name: row.name, body: row.body, shots: row.shots.map(imageUrl), status: row.status, reply: row.reply, createdAt: new Date(row.createdAt).toISOString(), handledAt: row.handledAt ? new Date(row.handledAt).toISOString() : null }
}
const publicImageUrl = (token: string, clientId: string) => (id: string) => `/api/customer/${token}/images/${id}?clientId=${encodeURIComponent(clientId)}`
const internalImageUrl = (orderId: string) => (id: string) => `/api/orders/${encodeURIComponent(orderId)}/customer/images/${id}`

function dayBounds(now: number) {
  const offset = 8 * 3600_000
  const start = Math.floor((now + offset) / 86400_000) * 86400_000 - offset
  return { start: new Date(start).toISOString(), end: new Date(start + 86400_000).toISOString() }
}
async function quotas(database: DB | Tx, orderId: string) {
  const now = Date.now(), day = dayBounds(now)
  const [counts, latest] = await Promise.all([
    database.select({ kind: t.customerRequests.kind, count: sql<number>`count(*)::int` }).from(t.customerRequests)
      .where(and(eq(t.customerRequests.orderId, orderId), gte(t.customerRequests.createdAt, day.start))).groupBy(t.customerRequests.kind),
    database.select({ at: t.customerRequests.createdAt }).from(t.customerRequests)
      .where(and(eq(t.customerRequests.orderId, orderId), eq(t.customerRequests.kind, 'nudge'))).orderBy(desc(t.customerRequests.createdAt)).limit(1),
  ])
  const nudges = counts.find(c => c.kind === 'nudge')?.count ?? 0
  const requirements = counts.find(c => c.kind === 'requirement')?.count ?? 0
  const cooldown = latest[0] ? new Date(latest[0].at).getTime() + limits.nudgeCooldownMinutes * 60_000 : 0
  const available = Math.max(cooldown, nudges >= limits.nudgesPerDay ? new Date(day.end).getTime() : 0)
  return { nudges, requirements, nudgeAvailableAt: available > now ? new Date(available).toISOString() : null }
}

export async function getCustomerPortal(req: Request, token: string): Promise<CustomerPortalView> {
  const clientId = parseClient(new URL(req.url).searchParams.get('clientId'))
  const { order } = await publicOrder(db, token)
  const [requests, quota] = await Promise.all([
    db.select().from(t.customerRequests).where(and(eq(t.customerRequests.orderId, order.id), eq(t.customerRequests.clientId, clientId))).orderBy(desc(t.customerRequests.createdAt), desc(t.customerRequests.id)).limit(100),
    quotas(db, order.id),
  ])
  return { order: { title: order.title, status: order.status, dueDate: order.dueDate }, requests: requests.map(row => toRequest(row, publicImageUrl(token, clientId))), nudgeAvailableAt: quota.nudgeAvailableAt }
}

async function saveImage(data: string, written: string[]) {
  const match = /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data)
  if (!match) throw bad('只能上传图片，请重新选择截图')
  const bytes = Buffer.from(match[1], 'base64')
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw bad('单张图片请小于 4 MB')
  let output: Buffer
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000 })
    const info = await image.metadata()
    if (!['png', 'jpeg', 'webp', 'gif'].includes(info.format ?? '') || (info.pages ?? 1) > 1) throw new Error('Unsupported image')
    output = await image.rotate().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer()
  } catch { throw bad('图片无法读取，请换一张截图') }
  const id = randomUUID(), target = imagePath(id)
  await mkdir(path.dirname(target), { recursive: true })
  written.push(target)
  await writeFile(target, output, { flag: 'wx' })
  return id
}

export async function submitCustomerRequest(req: Request, token: string) {
  // 先验证令牌，再读取和解码外部图片。
  await publicOrder(db, token)
  const parsed = submission.safeParse(await readJson(req, limits.requestBytes))
  if (!parsed.success) throw bad('提交内容不完整或过长，请检查后再试')
  const input = parsed.data
  if (input.kind === 'requirement' && !input.body && !input.shots.length) throw bad('请填写补充要求或添加图片')
  const payloadHash = hash(JSON.stringify(input)), written: string[] = []
  let changedOrder: string | null = null
  let result: { request: CustomerRequest; nudgeAvailableAt: string | null }
  try {
    result = await db.transaction(async tx => {
      const { order, link } = await publicOrder(tx, token, true)
      const [existing] = await tx.select().from(t.customerRequests).where(and(eq(t.customerRequests.orderId, order.id), eq(t.customerRequests.clientId, input.clientId), eq(t.customerRequests.requestId, input.requestId))).limit(1)
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new HttpError(409, '这次提交已经记录，请刷新后再补充')
        return { request: toRequest(existing, publicImageUrl(token, input.clientId)), nudgeAvailableAt: (await quotas(tx, order.id)).nudgeAvailableAt }
      }
      const quota = await quotas(tx, order.id)
      if (input.kind === 'nudge' && quota.nudgeAvailableAt) throw new HttpError(429, '这单已经提醒过工作人员，请稍后再催单')
      if (input.kind === 'requirement' && quota.requirements >= limits.requirementsPerDay) throw new HttpError(429, '这单今天已提交较多要求，请明天再补充或联系工作人员')
      const shots: string[] = []
      for (const shot of input.shots) shots.push(await saveImage(shot, written))
      const [row] = await tx.insert(t.customerRequests).values({
        id: randomUUID(), orderId: order.id, linkId: link.id, clientId: input.clientId, requestId: input.requestId,
        payloadHash, kind: input.kind, name: input.name, body: input.body, shots, createdAt: nowISO(),
      }).returning()
      await notify(tx, [order.ownerId, ...order.assignees.map(a => a.userId)], {
        kind: input.kind === 'nudge' ? '客户催单' : '客户补充', orderId: order.id, tab: 'customer',
        title: `${input.kind === 'nudge' ? '客户催单' : '客户补充要求'} · ${order.title}`,
        body: input.body.slice(0, 300) || (input.kind === 'nudge' ? '客户希望了解订单进展' : '客户补充了图片，请查看'),
        key: `customer-request:${row.id}`,
      })
      changedOrder = order.id
      return { request: toRequest(row, publicImageUrl(token, input.clientId)), nudgeAvailableAt: (await quotas(tx, order.id)).nudgeAvailableAt }
    })
  } catch (error) {
    await Promise.all(written.map(file => unlink(file).catch(() => {})))
    throw error
  }
  if (changedOrder) broadcast('changed', [changedOrder])
  return result
}

export async function getInternalCustomerPortal(orderId: string, ctx: Ctx, offset = 0): Promise<CustomerPortalInternal> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw bad('页码不正确')
  const order = await internalOrder(db, orderId, ctx)
  const [[link], requests] = await Promise.all([
    db.select({ id: t.customerLinks.id }).from(t.customerLinks).where(and(eq(t.customerLinks.orderId, orderId), isNull(t.customerLinks.revokedAt))).limit(1),
    db.select().from(t.customerRequests).where(eq(t.customerRequests.orderId, orderId))
      .orderBy(sql`case when ${t.customerRequests.status} = 'pending' then 0 else 1 end`, desc(t.customerRequests.createdAt), desc(t.customerRequests.id)).limit(101).offset(offset),
  ])
  return { canManage: order.canManage, canResolve: order.canResolve, link: { id: link?.id ?? null, active: !!link && order.status !== '退单', path: null }, requests: requests.slice(0, 100).map(row => toRequest(row, internalImageUrl(orderId))), hasMore: requests.length > 100, nextOffset: requests.length > 100 ? offset + 100 : null }
}

export async function manageCustomerPortal(req: Request, orderId: string, ctx: Ctx) {
  const parsed = management.safeParse(await readJson(req, 16_384))
  if (!parsed.success) throw bad('操作内容不正确')
  const input = parsed.data
  const result = await db.transaction(async tx => {
    const order = await internalOrder(tx, orderId, ctx, true)
    const at = nowISO()
    if (input.action === 'resolve') {
      if (!order.canResolve) throw deny()
      const [record] = await tx.select().from(t.customerRequests).where(and(eq(t.customerRequests.id, input.requestId), eq(t.customerRequests.orderId, orderId))).limit(1)
      if (!record) throw notFound()
      if (record.status === 'handled') return { ok: true }
      await tx.update(t.customerRequests).set({ status: 'handled', reply: input.reply, handledAt: at, handledBy: ctx.me.id }).where(eq(t.customerRequests.id, record.id))
      await tx.insert(t.audit).values({ actorId: ctx.me.id, action: '处理客户反馈', objectType: 'order', objectId: orderId, objectLabel: order.title, note: input.reply, ip: ctx.ip })
      return { ok: true }
    }
    if (!order.canManage) throw deny()
    if (input.action === 'create' && order.status === '退单') throw bad('退单不能生成客户链接')
    await tx.update(t.customerLinks).set({ revokedAt: at }).where(and(eq(t.customerLinks.orderId, orderId), isNull(t.customerLinks.revokedAt)))
    await tx.insert(t.audit).values({ actorId: ctx.me.id, action: input.action === 'create' ? '生成客户链接' : '停用客户链接', objectType: 'order', objectId: orderId, objectLabel: order.title, ip: ctx.ip })
    if (input.action === 'revoke') return { ok: true }
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    await tx.insert(t.customerLinks).values({ id, orderId, tokenHash: hash(token), createdBy: ctx.me.id, createdAt: at })
    return { link: { id, active: true, path: `/customer/${token}` } }
  })
  broadcast('changed', [orderId])
  return result
}

export async function getPublicCustomerImage(req: Request, token: string, id: string) {
  const clientId = parseClient(new URL(req.url).searchParams.get('clientId'))
  if (!uuid.safeParse(id).success) throw notFound()
  const { order } = await publicOrder(db, token)
  const [record] = await db.select({ id: t.customerRequests.id }).from(t.customerRequests).where(and(
    eq(t.customerRequests.orderId, order.id), eq(t.customerRequests.clientId, clientId), sql`${t.customerRequests.shots} @> ${JSON.stringify([id])}::jsonb`,
  )).limit(1)
  if (!record) throw notFound()
  return fileResponse(req, { id, path: imagePath(id), name: '客户截图.webp', mime: 'image/webp', inline: true, cacheControl: 'no-store' })
}

export async function getInternalCustomerImage(req: Request, orderId: string, id: string, ctx: Ctx) {
  await internalOrder(db, orderId, ctx)
  if (!uuid.safeParse(id).success) throw notFound()
  const [record] = await db.select({ id: t.customerRequests.id }).from(t.customerRequests).where(and(
    eq(t.customerRequests.orderId, orderId), sql`${t.customerRequests.shots} @> ${JSON.stringify([id])}::jsonb`,
  )).limit(1)
  if (!record) throw notFound()
  const response = await fileResponse(req, { id, path: imagePath(id), name: '客户截图.webp', mime: 'image/webp', inline: true, cacheControl: 'no-store' })
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
