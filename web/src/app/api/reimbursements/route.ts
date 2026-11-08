import { fuzzySearchSql } from '@/server/search'
import { fuzzyMatch } from '@/shared/search'
import { and, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { REIMBURSEMENT_STATUSES, type ReimbursementList, type ReimbursementStatus } from '@/shared/reimbursement'
import { can, rowVisible } from '@/shared/perm'
import { db } from '@/server/db'
import { bad, deny, json, notFound, route } from '@/server/http'
import { loadWorld } from '@/server/repo'
import { reimbursementView } from '@/server/reimbursement'
import { reimbursements as table } from '@/server/schema'

export const GET = route(async (req, c) => {
  const params = new URL(req.url).searchParams
  const base: SQL[] = []
  const applicant = params.get('applicant'), id = params.get('id'), query = (params.get('q') ?? '').trim().slice(0, 200)
  if (!c.role.locked && applicant && applicant !== c.me.id) throw deny()
  if (!c.role.locked || applicant) base.push(eq(table.applicantId, c.role.locked ? applicant! : c.me.id))
  if (id) base.push(eq(table.id, id))
  if (query) {
    const matches: SQL[] = [fuzzySearchSql(query, [table.no, table.note, table.category])!]
    if (can(c.role, 'order.view')) {
      const w = await loadWorld(db)
      const orderIds = w.orders.filter(o => rowVisible(o, c.me, c.role) && fuzzyMatch([o.no, o.title], query)).map(o => o.id)
      if (orderIds.length) matches.push(inArray(table.orderId, orderIds))
    }
    base.push(or(...matches)!)
  }
  const filters = [...base], status = params.get('status')
  if (status) {
    if (!REIMBURSEMENT_STATUSES.includes(status as ReimbursementStatus)) throw bad('报销状态不对')
    filters.push(eq(table.status, status as ReimbursementStatus))
  }
  const offset = Math.max(0, Math.trunc(Number(params.get('offset')) || 0))
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(params.get('limit')) || 50)))
  const [rows, [total], [summary]] = await Promise.all([
    db.select().from(table).where(and(...filters)).orderBy(desc(table.createdAt), desc(table.id)).limit(limit).offset(offset),
    db.select({ value: count() }).from(table).where(and(...filters)),
    db.select({
      pendingAmount: sql<number>`coalesce(sum(${table.amount}) filter (where ${table.status} = '待处理'), 0)::float8`,
      paidAmount: sql<number>`coalesce(sum(${table.amount}) filter (where ${table.status} = '已报销'), 0)::float8`,
      pendingCount: sql<number>`count(*) filter (where ${table.status} = '待处理')::int`,
      paidCount: sql<number>`count(*) filter (where ${table.status} = '已报销')::int`,
    }).from(table).where(and(...base)),
  ])
  if (id && !rows.length) throw notFound()
  const result: ReimbursementList = { rows: rows.map(reimbursementView), total: total.value, summary, next: offset + rows.length < total.value ? offset + rows.length : null }
  return json(result)
})
