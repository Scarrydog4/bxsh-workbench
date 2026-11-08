import { db } from '@/server/db'
import { bad, deny, json, route } from '@/server/http'
import { adminIdsOf, loadWorld } from '@/server/repo'
import { buildIncomeReport, incomeReportSelection, type IncomeReportGranularity, type IncomeReportSelection } from '@/shared/income-report'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import * as t from '@/server/schema'

export const GET = route(async (req, c) => {
  if (!c.role.locked) throw deny()
  const q = new URL(req.url).searchParams
  let selection: IncomeReportSelection
  try {
    selection = incomeReportSelection({
      from: q.get('from') ?? undefined, to: q.get('to') ?? undefined,
      dates: q.has('dates') ? q.get('dates')!.split(',') : undefined,
      granularity: (q.get('granularity') ?? undefined) as IncomeReportGranularity | undefined,
      ownerId: q.get('ownerId') ?? undefined, channelId: q.get('channelId') ?? undefined,
    })
  } catch (error) { throw bad(error instanceof Error ? error.message : '统计日期不正确') }
  // 回收站中的实际收退款仍是现金流水；净收入模型单独排除这些订单。
  const world = await loadWorld(db, { includeDeleted: true })
  if (selection.from !== selection.to || selection.granularity !== 'day') return json(buildIncomeReport(world, adminIdsOf(world), selection))
  // 只采用同一次业务操作留存的录入时刻；导入批次时间不能冒充历史发生时间。
  const [orders, payments, receipts] = await Promise.all([
    db.selectDistinct({ id: t.orders.id, at: t.orders.createdAt }).from(t.orders).innerJoin(t.audit, and(eq(t.audit.objectId, t.orders.id), eq(t.audit.at, t.orders.createdAt), eq(t.audit.objectType, 'order'), inArray(t.audit.action, ['新建', 'AI 录入']))).where(and(isNull(t.orders.feishuRecordId), isNull(t.orders.feishuSysNo), eq(t.orders.orderDate, selection.from))),
    db.selectDistinct({ id: t.payments.id, at: t.payments.createdAt }).from(t.payments).innerJoin(t.audit, and(eq(t.audit.objectId, t.payments.orderId), eq(t.audit.at, t.payments.createdAt), eq(t.audit.actorId, t.payments.by), eq(t.audit.objectType, 'order'), eq(t.audit.action, '记收款'))).where(eq(t.payments.date, selection.from)),
    db.selectDistinct({ id: t.channelReceipts.id, at: t.channelReceipts.createdAt }).from(t.channelReceipts).innerJoin(t.audit, and(eq(t.audit.objectId, t.channelReceipts.id), eq(t.audit.at, t.channelReceipts.createdAt), eq(t.audit.objectType, 'channelReceipt'), eq(t.audit.action, '渠道收款'))).where(eq(t.channelReceipts.date, selection.from)),
  ])
  const times = (rows: { id: string; at: string }[]) => Object.fromEntries(rows.map(row => [row.id, row.at]))
  return json(buildIncomeReport({ ...world, recordedTimes: { orders: times(orders), payments: times(payments), channelReceipts: times(receipts) } }, adminIdsOf(world), selection))
})
