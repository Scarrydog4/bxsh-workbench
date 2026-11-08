import { eq, desc } from 'drizzle-orm'
import { db, type DB, type Tx } from './db'
import * as t from './schema'
import type { Ctx } from './session'
import { bad, deny, HttpError, notFound } from './http'
import { can } from '@/shared/perm'
import type { PointsView, ToolPrice } from '@/shared/points'

export async function wallet(tx: DB | Tx, userId: string, lock = false) {
  await tx.insert(t.pointAccounts).values({ userId }).onConflictDoNothing()
  const q = tx.select().from(t.pointAccounts).where(eq(t.pointAccounts.userId, userId))
  return (await (lock ? q.for('update') : q))[0]
}
export async function priceOf(tx: DB | Tx): Promise<ToolPrice | null> {
  const [p] = await tx.select().from(t.toolPrices).where(eq(t.toolPrices.id, 'rewrite'))
  return p ? { points: p.points } : null
}
export async function pointsView(c: Ctx): Promise<PointsView> {
  const manage = can(c.role, 'points.manage')
  const [w, price, entries] = await Promise.all([
    wallet(db, c.me.id), priceOf(db),
    db.select({ id: t.pointEntries.id, kind: t.pointEntries.kind, delta: t.pointEntries.delta, reservedDelta: t.pointEntries.reservedDelta,
      note: t.pointEntries.note, at: t.pointEntries.at, actorName: t.users.name }).from(t.pointEntries)
      .innerJoin(t.users, eq(t.users.id, t.pointEntries.actorId)).where(eq(t.pointEntries.userId, c.me.id)).orderBy(desc(t.pointEntries.at)).limit(50),
  ])
  const accounts = manage ? await db.select({ userId: t.users.id, name: t.users.name, account: t.users.account, active: t.users.active,
    balance: t.pointAccounts.balance, reserved: t.pointAccounts.reserved }).from(t.users).leftJoin(t.pointAccounts, eq(t.pointAccounts.userId, t.users.id)).orderBy(t.users.createdAt) : undefined
  return { balance: w.balance, reserved: w.reserved, available: w.balance - w.reserved, price, manage, entries,
    ...(accounts ? { accounts: accounts.map((a) => ({ ...a, balance: a.balance ?? 0, reserved: a.reserved ?? 0, available: (a.balance ?? 0) - (a.reserved ?? 0) })) } : {}) }
}
export async function allocatePoints(c: Ctx, input: { requestId: string; userId: string; points: number; note: string }) {
  if (!can(c.role, 'points.manage')) throw deny()
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(t.users).where(eq(t.users.id, input.userId))
    if (!user || !user.active) throw notFound('这个账号不存在或已停用')
    const w = await wallet(tx, user.id, true)
    const id = `allocate:${input.requestId}`
    const [prior] = await tx.select().from(t.pointEntries).where(eq(t.pointEntries.id, id))
    if (prior) {
      if (prior.userId !== user.id || prior.actorId !== c.me.id || prior.delta !== input.points || prior.note !== input.note) throw bad('这次分配编号已被使用，请重新打开分配入口')
      return { ok: true, reused: true }
    }
    if (w.balance + input.points > 1_000_000_000) throw bad('积分余额超过允许范围')
    await tx.update(t.pointAccounts).set({ balance: w.balance + input.points }).where(eq(t.pointAccounts.userId, user.id))
    await tx.insert(t.pointEntries).values({ id, userId: user.id, actorId: c.me.id, kind: '分配积分', delta: input.points, note: input.note })
    await tx.insert(t.audit).values({ actorId: c.me.id, action: '分配积分', objectType: 'points', objectId: user.id, objectLabel: user.name,
      from: String(w.balance), to: String(w.balance + input.points), ip: c.ip })
    return { ok: true, reused: false }
  })
}
export async function setToolPrice(c: Ctx, price: ToolPrice) {
  if (!can(c.role, 'points.manage')) throw deny()
  await db.transaction(async (tx) => {
    const old = await priceOf(tx)
    await tx.insert(t.toolPrices).values({ id: 'rewrite', ...price }).onConflictDoUpdate({ target: t.toolPrices.id, set: price })
    await tx.insert(t.audit).values({ actorId: c.me.id, action: '设置双降积分', objectType: 'points', objectLabel: '笔像双降', from: old ? JSON.stringify(old) : null, to: JSON.stringify(price), ip: c.ip })
  })
}
export async function reservePoints(tx: Tx, jobId: string, userId: string, points: number) {
  const w = await wallet(tx, userId, true)
  if (w.balance - w.reserved < points) throw new HttpError(402, `可用积分不足，需要 ${points} 积分，请联系管理员分配`)
  await tx.update(t.pointAccounts).set({ reserved: w.reserved + points }).where(eq(t.pointAccounts.userId, userId))
  await tx.insert(t.pointEntries).values({ id: `reserve:${jobId}`, userId, actorId: userId, kind: '任务预占', reservedDelta: points, jobId, note: '笔像双降提交，预占积分' })
}
/** 和任务状态在同一事务内结算，每个任务只记一次扣除或退回。 */
export async function settlePoints(tx: Tx, jobId: string, completed: boolean) {
  const [job] = await tx.select().from(t.rewriteJobs).where(eq(t.rewriteJobs.id, jobId)).for('update')
  if (!job || job.pointStatus !== 'reserved') return
  const w = await wallet(tx, job.userId, true)
  await tx.update(t.pointAccounts).set({ balance: w.balance - (completed ? job.points : 0), reserved: w.reserved - job.points }).where(eq(t.pointAccounts.userId, job.userId))
  await tx.insert(t.pointEntries).values({ id: `settle:${jobId}`, userId: job.userId, actorId: job.userId, kind: completed ? '工具扣除' : '积分退回',
    delta: completed ? -job.points : 0, reservedDelta: -job.points, jobId, note: completed ? '笔像双降返回稿已保存' : '任务未完成，退回预占积分' })
  await tx.update(t.rewriteJobs).set({ pointStatus: completed ? 'charged' : 'refunded' }).where(eq(t.rewriteJobs.id, jobId))
}
