import { db } from '@/server/db'
import { bad, deny, json, route } from '@/server/http'
import { loadWorld } from '@/server/repo'
import { incomeRows } from '@/server/bootstrap'
import { writerDelivery } from '@/shared/writer-delivery'
import { can, rowVisible } from '@/shared/perm'
import { canViewSettlement } from '@/shared/settlement-access'
import { incomeReportSelection, type IncomeReportGranularity } from '@/shared/income-report'
import { buildPersonalIncomeReport, type PersonalPayout } from '@/shared/personal-income-report'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import * as t from '@/server/schema'

export const GET = route(async (req, c) => {
  if (!can(c.role, 'order.view') || c.role.fields.writerPay === 'none' && c.role.fields.commission === 'none') throw deny()
  const q = new URL(req.url).searchParams
  // 此接口始终只读本人；即使有 income.all 也不能切换到其他人。
  for (const key of ['user', 'userId', 'ownerId', 'payeeId']) if (q.has(key) && q.get(key) !== c.me.id) throw deny()
  let selection
  try { selection = incomeReportSelection({ from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, dates: q.has('dates') ? q.get('dates')!.split(',') : undefined,
    granularity: (q.get('granularity') ?? undefined) as IncomeReportGranularity | undefined, channelId: q.get('channelId') ?? undefined }) }
  catch (error) { throw bad(error instanceof Error ? error.message : '统计日期不正确') }
  const world = await loadWorld(db, { includeDeleted: true }), income = await incomeRows(c, c.me.id, world)
  const deliveries = new Map(world.orders.map(order => [order.id, writerDelivery(order, c.me.id)]))
  // 只调整个人工资报表的归属日期，保留收入底账供实际发放和历史记录匹配。
  const rows = income.map(row => row.kind === '工资' || row.kind === '追加工资' ? { ...row, date: deliveries.get(row.id)?.day ?? '' } : row)
  const ids = [...new Set(rows.map(row => row.id))]
  const times = ids.length && selection.from === selection.to && selection.granularity === 'day' ? await db.selectDistinct({ id: t.orders.id, at: t.orders.createdAt }).from(t.orders)
    .innerJoin(t.audit, and(eq(t.audit.objectId, t.orders.id), eq(t.audit.at, t.orders.createdAt), eq(t.audit.objectType, 'order'), inArray(t.audit.action, ['新建', 'AI 录入'])))
    .where(and(inArray(t.orders.id, ids), isNull(t.orders.feishuRecordId), isNull(t.orders.feishuSysNo), eq(t.orders.orderDate, selection.from))) : []
  const recorded = new Map(times.map(row => [row.id, row.at])), channels = new Map(world.channels.map(channel => [channel.id, channel]))
  const visible = new Set(rows.map(row => row.id))
  const labels = world.orders.filter(order => visible.has(order.id)).map(order => {
    const accessible = !order.deletedAt && rowVisible(order, c.me, c.role), channel = accessible ? channels.get(order.channelId) : undefined
    return { id: order.id, orderDate: order.orderDate, accessible, channelId: accessible ? order.channelId : '', channelName: accessible ? channel?.name ?? '未填渠道' : '历史订单', channelAvatar: channel?.avatar, createdAt: recorded.get(order.id), deliveredAt: deliveries.get(order.id)?.at ?? null, deliveryDate: deliveries.get(order.id)?.day ?? null }
  })
  const payments = await db.select({ id: t.settlements.id, orderId: t.settlements.orderId, kind: t.settlements.kind, amount: t.settlements.amount, at: t.settlements.confirmedAt, date: t.settlements.confirmedDate }).from(t.settlements)
    .where(and(eq(t.settlements.payeeId, c.me.id), eq(t.settlements.status, '已确认')))
  const payouts: PersonalPayout[] = payments.filter(payment => ['销售提成', '写手工资'].includes(payment.kind) && canViewSettlement({ ...payment, payeeId: c.me.id }, c.me.id, c.role))
    .map(({date, ...payment}) => ({ ...payment, at: payment.at ?? date, kind: payment.kind as PersonalPayout['kind'] }))
  return json(buildPersonalIncomeReport(rows, payouts, labels, selection))
})
