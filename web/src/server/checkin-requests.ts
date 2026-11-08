import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { CHECKIN_REQUEST_KINDS } from '@/shared/checkin-requests'
import type { CheckinRequestList, CheckinRequestRecord, CheckinRequestResult } from '@/shared/checkin-requests'
import type { CheckinScope } from '@/shared/checkin'
import { businessDate } from '@/shared/format'
import { db } from './db'
import { bad, deny, notFound } from './http'
import { checkinRequests, users } from './schema'
import type { Ctx } from './session'

const inputSchema = z.object({
  requestId: z.uuid(), kind: z.enum(CHECKIN_REQUEST_KINDS),
  startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(1000),
}).strict()
const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']), decisionReason: z.string().trim().max(1000).optional(),
}).strict()

type RequestRow = typeof checkinRequests.$inferSelect
type Person = { name: string; hue: number; avatar?: string | null }
const personColumns = { name: users.name, hue: users.hue, avatar: users.avatar }

function record(row: RequestRow, person: Person): CheckinRequestRecord {
  return {
    id: row.id, userId: row.userId, name: person.name, avatar: person.avatar ?? undefined, hue: person.hue,
    kind: row.kind, startAt: new Date(row.startAt).toISOString(), endAt: new Date(row.endAt).toISOString(),
    reason: row.reason, status: row.status, createdAt: new Date(row.createdAt).toISOString(),
    decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
    decidedBy: row.decidedBy, decisionReason: row.decisionReason,
  }
}

export async function listCheckinRequests(c: Ctx, options: { month?: string; scope: CheckinScope; status?: 'pending'; limit?: number; offset?: number }): Promise<CheckinRequestList> {
  const { scope, status, limit = 100, offset = 0 } = options
  if (scope !== 'mine' && scope !== 'team') throw bad('申请查询范围不正确')
  if (status !== undefined && status !== 'pending') throw bad('申请状态条件不正确')
  if (scope === 'team' && !c.role.locked) throw deny('只有老板可以查看全员申请')
  if (status === 'pending' && (!c.role.locked || scope !== 'team')) throw deny('只有老板可以查看全部待审批申请')
  const month = options.month ?? businessDate(new Date()).slice(0, 7)
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) throw bad('请选择有效月份')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw bad('申请分页参数不正确')
  const [year, monthNumber] = month.split('-').map(Number)
  const start = new Date(`${month}-01T00:00:00+08:00`)
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1) - 8 * 3_600_000)
  const where = and(status === 'pending' ? eq(checkinRequests.status, 'pending') : and(gte(checkinRequests.startAt, start.toISOString()), lt(checkinRequests.startAt, nextMonth.toISOString())),
    scope === 'mine' ? eq(checkinRequests.userId, c.me.id) : undefined)
  const [rows, [summary]] = await Promise.all([
    db.select({ request: checkinRequests, person: personColumns }).from(checkinRequests)
      .innerJoin(users, eq(users.id, checkinRequests.userId)).where(where)
      .orderBy(status === 'pending' ? asc(checkinRequests.startAt) : desc(checkinRequests.startAt), desc(checkinRequests.createdAt), checkinRequests.id).limit(limit + 1).offset(offset),
    db.select({ total: count() }).from(checkinRequests)
      .innerJoin(users, eq(users.id, checkinRequests.userId)).where(where),
  ])
  return { month: status === 'pending' ? null : month, scope, rows: rows.slice(0, limit).map(row => record(row.request, row.person)), total: summary.total, next: rows.length > limit ? offset + limit : null }
}

export async function createCheckinRequest(c: Ctx, body: unknown): Promise<CheckinRequestResult> {
  const parsed = inputSchema.safeParse(body)
  if (!parsed.success) throw bad('请填写申请类型、带时区的起止时间和申请原因（最多1000字）')
  const input = parsed.data
  const start = new Date(input.startAt), end = new Date(input.endAt)
  if (end.getTime() <= start.getTime()) throw bad('结束时间必须晚于开始时间')
  if (businessDate(start) !== businessDate(end)) throw bad('一次申请请选择北京时间同一天的起止时间，跨天请分别申请')
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`checkin-request:${c.me.id}:${input.requestId}`}, 0))`)
    const [existing] = await tx.select().from(checkinRequests)
      .where(and(eq(checkinRequests.userId, c.me.id), eq(checkinRequests.requestId, input.requestId))).limit(1)
    if (existing) {
      if (existing.kind !== input.kind || new Date(existing.startAt).getTime() !== start.getTime() || new Date(existing.endAt).getTime() !== end.getTime() || existing.reason !== input.reason) throw bad('这次提交已使用，请刷新后重新申请')
      // 请求重试可晚于申请开始时间，但不能新增或改写原申请。
      return { record: record(existing, c.me), created: false }
    }
    const now = new Date()
    if (start.getTime() < now.getTime()) throw bad('特殊情况需要提前申请，请选择尚未开始的时间')
    const [row] = await tx.insert(checkinRequests).values({
      id: randomUUID(), userId: c.me.id, requestId: input.requestId, kind: input.kind,
      startAt: start.toISOString(), endAt: end.toISOString(), reason: input.reason, createdAt: now.toISOString(),
    }).returning()
    return { record: record(row, c.me), created: true }
  })
}

export async function decideCheckinRequest(c: Ctx, id: string, body: unknown): Promise<{ record: CheckinRequestRecord }> {
  if (!c.role.locked) throw deny('只有老板可以审批申请')
  const parsed = decisionSchema.safeParse(body)
  if (!parsed.success) throw bad('请选择批准或拒绝，说明最多1000字')
  const { decision, decisionReason } = parsed.data
  const reason = decisionReason || null
  if (decision === 'rejected' && !reason) throw bad('请填写拒绝原因')
  return db.transaction(async tx => {
    const [row] = await tx.select().from(checkinRequests).where(eq(checkinRequests.id, id)).for('update').limit(1)
    if (!row) throw notFound()
    const [person] = await tx.select(personColumns).from(users).where(eq(users.id, row.userId)).limit(1)
    if (row.status !== 'pending') {
      if (row.status !== decision || row.decisionReason !== reason) throw bad('这条申请已经审批，不能覆盖原审批结果')
      return { record: record(row, person) }
    }
    // 只要求员工提前提交；老板可稍后审批，并保留真实审批时间。
    const [updated] = await tx.update(checkinRequests).set({ status: decision, decisionReason: reason, decidedAt: new Date().toISOString(), decidedBy: c.me.id })
      .where(eq(checkinRequests.id, id)).returning()
    return { record: record(updated, person) }
  })
}

/** 与打卡相同的来源校验，支持反向代理保留的 Host 和原生 App 请求。 */
export async function checkinRequestBody(req: Request): Promise<unknown> {
  if (new URL(req.url).search) throw bad('申请操作不接受额外参数')
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw deny('请在平台内提交申请')
  const origin = req.headers.get('origin')
  if (origin) {
    let source: URL
    try { source = new URL(origin) } catch { throw deny('请在平台内提交申请') }
    const host = req.headers.get('host') ?? new URL(req.url).host
    if (!['http:', 'https:'].includes(source.protocol) || source.host !== host) throw deny('请在平台内提交申请')
  }
  const text = await req.text()
  if (text.length > 12_000) throw bad('申请内容过长')
  try { return JSON.parse(text) } catch { throw bad('申请信息格式不正确') }
}
