import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/server/db'
import { incomeRows } from '@/server/bootstrap'
import { bad, deny, json, notFound } from '@/server/http'
import { adminIdsOf, loadWorld } from '@/server/repo'
import * as t from '@/server/schema'
import type { Ctx } from '@/server/session'
import { writerDelivery } from '@/shared/writer-delivery'
import { can } from '@/shared/perm'
import { incomeReportSelection, type IncomeReportGranularity } from '@/shared/income-report'
import { buildPersonalIncomeReport, type PersonalPayout } from '@/shared/personal-income-report'
import { buildSalesIncomeReport } from '@/shared/sales-income-report'

/** 老板查看销售提成和写手工资；员工的 personal-income 仍始终限本人。 */
export async function peopleIncomeReport(req: Request, c: Ctx, kind: 'sales' | 'writer') {
  const writer = kind === 'writer', settlementKind = writer ? '写手工资' : '销售提成'
  if (!c.role.locked) throw deny()
  const q = new URL(req.url).searchParams, payeeId = q.get('payeeId') || null
  let selection
  try {
    selection = incomeReportSelection({ from: q.get('from') ?? undefined, to: q.get('to') ?? undefined,
      dates: q.has('dates') ? q.get('dates')!.split(',') : undefined,
      granularity: (q.get('granularity') ?? undefined) as IncomeReportGranularity | undefined, channelId: q.get('channelId') ?? undefined })
  } catch (error) { throw bad(error instanceof Error ? error.message : '统计日期不正确') }
  const world = await loadWorld(db, { includeDeleted: true }), admins = adminIdsOf(world)
  const roles = new Map(world.roles.map(role => [role.id, role]))
  const historical = new Set(world.orders.flatMap(order => [...(writer ? [...order.assignees.map(person => person.userId), ...order.afterSales.map(task => task.writerId)] : [order.ownerId]), ...order.settlements.filter(payment => payment.kind === settlementKind && payment.status === '已确认').map(payment => payment.payeeId)]))
  const sales = world.users.filter(user => !admins.has(user.id) && (historical.has(user.id) || (writer ? user.canWrite : !!roles.get(user.roleId) && can(roles.get(user.roleId)!, 'order.create'))))
    .map(({ id, name, avatar, hue }) => ({ id, name, avatar, hue }))
  if (payeeId && !sales.some(person => person.id === payeeId)) throw notFound(writer ? '找不到这位写手' : '找不到这位销售')
  const people = payeeId ? sales.filter(person => person.id === payeeId) : sales
  const rowsByPerson = await Promise.all(people.map(async person => ({ person, rows: (await incomeRows(c, person.id, world)).filter(row => writer ? ['工资', '追加工资', '已发工资'].includes(row.kind) : row.kind === '提成' || row.kind === '代录费' || row.kind === '已发提成') })))
  const ids = [...new Set(rowsByPerson.flatMap(({ rows }) => rows.map(row => row.id)))]
  const times = ids.length && selection.from === selection.to && selection.granularity === 'day'
    ? await db.selectDistinct({ id: t.orders.id, at: t.orders.createdAt }).from(t.orders)
      .innerJoin(t.audit, and(eq(t.audit.objectId, t.orders.id), eq(t.audit.at, t.orders.createdAt), eq(t.audit.objectType, 'order'), inArray(t.audit.action, ['新建', 'AI 录入'])))
      .where(and(inArray(t.orders.id, ids), isNull(t.orders.feishuRecordId), isNull(t.orders.feishuSysNo), eq(t.orders.orderDate, selection.from))) : []
  const recorded = new Map(times.map(row => [row.id, row.at])), channels = new Map(world.channels.map(channel => [channel.id, channel]))
  const entries = rowsByPerson.map(({ person, rows }) => {
    const visible = new Set(rows.map(row => row.id)), orders = world.orders.filter(order => visible.has(order.id))
    const labels = orders.map(order => {
      const channel = channels.get(order.channelId)
      return { id: order.id, orderDate: order.orderDate, accessible: !order.deletedAt, channelId: order.channelId,
        channelName: channel?.name ?? '未填渠道', channelAvatar: channel?.avatar, createdAt: recorded.get(order.id) }
    })
    const payouts: PersonalPayout[] = orders.flatMap(order => order.settlements
      .filter(payment => payment.payeeId === person.id && payment.kind === settlementKind && payment.status === '已确认')
      .map(payment => ({ id: payment.id, orderId: order.id, kind: settlementKind, amount: payment.amount, at: payment.confirmedAt ?? null })))
    const report = buildPersonalIncomeReport(rows, payouts, labels, selection)
    if (writer) {
      const deliveries = new Map(orders.map(order => [order.id, writerDelivery(order, person.id)?.day ?? null]))
      report.orders = report.orders.map(row => ({ ...row, deliveryDate: deliveries.get(row.id) ?? null }))
    }
    return { person, report }
  })
  return json(buildSalesIncomeReport(entries, selection, sales, payeeId))
}
