import { calc, cents } from './calc'
import { businessDate, deadlineFrom } from './format'
import type { Channel, Order, User } from './types'
import type { ChannelReceipt } from './channel-receipts'

export const NO_CHANNEL = '__none__'

export type IncomeReportGranularity = 'day' | 'week' | 'month'
export interface IncomeReportQuery {
  from?: string
  to?: string
  dates?: string[]
  granularity?: IncomeReportGranularity
  ownerId?: string
  channelId?: string
}
export interface IncomeReportSelection {
  from: string
  to: string
  /** 非连续日期只计选中的天；from/to 仅表示这些天的边界。 */
  dates: string[] | null
  granularity: IncomeReportGranularity
  ownerId: string | null
  channelId: string | null
}
export interface IncomeReportMetrics {
  /** 下单日期命中的有效订单数，不含退单和回收站。 */
  orderCount: number
  sales: number
  knownNetIncome: number
  pendingCount: number
  pendingSales: number
  /** 付款日期命中的正向收款与退款，均以正数列示。 */
  receipts: number
  refunds: number
  netReceipts: number
  /** 已包含在 receipts / netReceipts 中，尚未分配到订单的渠道预收款。 */
  unallocatedReceipts?: number
  /** 已包含在实收中的渠道收款主笔总额，子付款不重复计入。 */
  channelReceiptTotal?: number
}
export interface IncomeReportOption { id: string; name: string; avatar?: string; hue?: number }
export interface IncomeReportGroup extends IncomeReportMetrics, IncomeReportOption {}
export interface IncomeReportBucket extends IncomeReportMetrics { key: string; start: string; end: string; orderIds: string[] }
export interface IncomeRecordedTimes { orders: Record<string, string>; payments: Record<string, string>; channelReceipts: Record<string, string> }
export interface IncomeHour extends IncomeReportMetrics { key: string; orderIds: string[] }
export interface IncomeHourly {
  day: string
  throughHour: number
  hours: IncomeHour[]
  unknown: IncomeHour
  unknownItems: { id: string; kind: string; no: string; title: string; value: number | null }[]
}
export interface IncomeReportOrder {
  id: string
  no: string
  title: string
  orderDate: string
  status: string
  deletedAt: string | null
  ownerId: string
  ownerName: string
  ownerAvatar?: string
  ownerHue: number
  channelId: string
  channelName: string
  channelAvatar?: string
  /** 只有为 true 时，本单当前预计净收入才计入本期。 */
  incomeIncluded: boolean
  netIncome: number | null
  sales: number
  extraCostTotal: number
  externalWriterCost: number | null
  commissionCost: number | null
  receipts: number
  refunds: number
  periodReceipts: number
  receiptDates: string[]
}
export interface IncomeReportChannelReceipt {
  id: string
  no: string
  date: string
  channelId: string
  channelName: string
  ownerId: string
  ownerName: string
  amount: number
  allocated: number
  unallocated: number
  lines: ChannelReceipt['lines']
}
export interface IncomeReport {
  selection: IncomeReportSelection
  summary: IncomeReportMetrics
  series: IncomeReportBucket[]
  channels: IncomeReportGroup[]
  sales: IncomeReportGroup[]
  orders: IncomeReportOrder[]
  channelReceipts?: IncomeReportChannelReceipt[]
  options: { channels: IncomeReportOption[]; sales: IncomeReportOption[] }
  hourly?: IncomeHourly
}

function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const value = new Date(`${day}T00:00:00Z`)
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === day
}

/** 查询和图表一律使用业务日，不依赖服务器时区。 */
export function incomeReportSelection(query: IncomeReportQuery, now: Date = new Date()): IncomeReportSelection {
  const granularity = query.granularity ?? 'day'
  if (!['day', 'week', 'month'].includes(granularity)) throw new Error('统计粒度不正确')
  if (query.dates !== undefined && (query.from !== undefined || query.to !== undefined)) throw new Error('日期区间与多选日期不能同时使用')
  let dates: string[] | null = null, from: string, to: string
  if (query.dates !== undefined) {
    if (!query.dates.length || query.dates.some(day => !validDay(day))) throw new Error('请选择有效日期')
    dates = [...new Set(query.dates)].sort()
    from = dates[0]; to = dates.at(-1)!
  } else {
    const today = businessDate(now)
    from = query.from ?? (query.to === undefined ? `${today.slice(0, 7)}-01` : '')
    to = query.to ?? (query.from === undefined ? today : '')
    if (!validDay(from) || !validDay(to)) throw new Error('请填写完整的有效日期区间')
  }
  if (from > to) throw new Error('开始日期不能晚于结束日期')
  // 限制一次日历展开的大小；最长二十年仍可覆盖历史经营统计。
  if ((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 > 7_305) throw new Error('日期范围不能超过二十年')
  return { from, to, dates, granularity, ownerId: query.ownerId || null, channelId: query.channelId || null }
}

function calendarBucket(day: string, granularity: IncomeReportGranularity) {
  if (granularity === 'day') return { key: day, start: day, end: day }
  if (granularity === 'month') {
    const start = `${day.slice(0, 7)}-01`, date = new Date(`${start}T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + 1)
    return { key: day.slice(0, 7), start, end: deadlineFrom(date.toISOString().slice(0, 10), -1) }
  }
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
  const start = deadlineFrom(day, -(dow === 0 ? 6 : dow - 1))
  return { key: start, start, end: deadlineFrom(start, 6) }
}
const blankMetrics = (): IncomeReportMetrics => ({ orderCount: 0, sales: 0, knownNetIncome: 0, pendingCount: 0, pendingSales: 0, receipts: 0, refunds: 0, netReceipts: 0 })
const addMoney = (left: number, right: number) => (cents(left) + cents(right)) / 100

/** 两个独立集合：下单日的预计净收入，以及付款日的实际收退款。 */
export function buildIncomeReport(
  data: { orders: Order[]; users: User[]; channels: Channel[]; channelReceipts?: ChannelReceipt[]; recordedTimes?: IncomeRecordedTimes },
  adminIds: Set<string>,
  selection: IncomeReportSelection,
): IncomeReport {
  const users = new Map(data.users.map(user => [user.id, user]))
  const channels = new Map(data.channels.map(channel => [channel.id, channel]))
  const ownerOption = (id: string): IncomeReportOption => {
    const user = users.get(id)
    return { id, name: user?.name ?? '原销售', avatar: user?.avatar, hue: user?.hue ?? 150 }
  }
  const channelOption = (id: string): IncomeReportOption => {
    const channel = channels.get(id)
    return { id: id || NO_CHANNEL, name: channel?.name ?? (id ? '原渠道' : '未填渠道'), avatar: channel?.avatar }
  }
  const selectedDays = selection.dates ? new Set(selection.dates) : null
  const selected = (day: string) => selectedDays ? selectedDays.has(day) : day >= selection.from && day <= selection.to
  const summary = blankMetrics(), series = new Map<string, IncomeReportBucket>()
  const hourly: IncomeHourly | undefined = selection.from === selection.to && selection.granularity === 'day' ? {
    day: selection.from,
    throughHour: selection.from === businessDate(new Date()) ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date())) : 23,
    hours: Array.from({ length: 24 }, (_, hour) => ({ ...blankMetrics(), key: `${String(hour).padStart(2, '0')}:00`, orderIds: [] })),
    unknown: { ...blankMetrics(), key: 'unknown', orderIds: [] }, unknownItems: [],
  } : undefined
  const hourBucket = (kind: keyof IncomeRecordedTimes, id: string, day: string, item: IncomeHourly['unknownItems'][number]) => {
    if (!hourly) return undefined
    const at = data.recordedTimes?.[kind][id]
    if (at && Number.isFinite(Date.parse(at)) && businessDate(at) === day) {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)))
      return hourly.hours[hour]
    }
    hourly.unknownItems.push(item)
    return hourly.unknown
  }
  const channelGroups = new Map<string, IncomeReportGroup>(), salesGroups = new Map<string, IncomeReportGroup>()
  const bucket = (day: string) => {
    const range = calendarBucket(day, selection.granularity)
    if (!series.has(range.key)) series.set(range.key, { ...range, ...blankMetrics(), orderIds: [] })
    return series.get(range.key)!
  }
  // 补出选中范围的空白日期，图表不能让无业务的天凭空消失。
  if (selectedDays) for (const day of selectedDays) bucket(day)
  else for (let day = selection.from; day <= selection.to; day = deadlineFrom(day, 1)) bucket(day)
  const group = (map: Map<string, IncomeReportGroup>, option: IncomeReportOption) => {
    if (!map.has(option.id)) map.set(option.id, { ...option, ...blankMetrics() })
    return map.get(option.id)!
  }
  const rows: IncomeReportOrder[] = []
  for (const order of data.orders) {
    if ((selection.ownerId && order.ownerId !== selection.ownerId) || (selection.channelId && (order.channelId || NO_CHANNEL) !== selection.channelId)) continue
    const incomeIncluded = !order.deletedAt && order.status !== '退单' && selected(order.orderDate)
    // 渠道收款子付款只影响订单收齐状态；现金由下方主笔按收款时的销售归属统计。
    const payments = order.payments.filter(payment => !payment.receiptId && !payment.revoked && selected(payment.date))
    if (!incomeIncluded && !payments.length) continue
    const calculation = calc(order, adminIds)
    const owner = ownerOption(order.ownerId), channel = channelOption(order.channelId)
    const aggregates = [summary, group(channelGroups, channel), group(salesGroups, owner)]
    const netIncome = calculation.payPending ? null : calculation.bossIncome
    const incomeHour = incomeIncluded ? hourBucket('orders', order.id, order.orderDate, { id: order.id, kind: '录单', no: order.no, title: order.title, value: netIncome }) : undefined
    if (incomeIncluded) bucket(order.orderDate).orderIds.push(order.id)
    if (incomeHour) incomeHour.orderIds.push(order.id)
    if (incomeIncluded) for (const total of [...aggregates, bucket(order.orderDate), ...(incomeHour ? [incomeHour] : [])]) {
      total.orderCount++
      total.sales = addMoney(total.sales, calculation.sales)
      if (netIncome === null) { total.pendingCount++; total.pendingSales = addMoney(total.pendingSales, calculation.sales) }
      else total.knownNetIncome = addMoney(total.knownNetIncome, netIncome)
    }
    let receipts = 0, refunds = 0
    for (const payment of payments) {
      const refund = payment.tag === '退款', amount = refund ? Math.abs(payment.amount) : payment.amount
      const paymentBucket = bucket(payment.date)
      const paymentHour = hourBucket('payments', payment.id, payment.date, { id: payment.id, kind: refund ? '退款' : '收款', no: order.no, title: order.title, value: refund ? -amount : amount })
      if (!paymentBucket.orderIds.includes(order.id)) paymentBucket.orderIds.push(order.id)
      if (paymentHour && !paymentHour.orderIds.includes(order.id)) paymentHour.orderIds.push(order.id)
      if (refund) refunds = addMoney(refunds, amount)
      else receipts = addMoney(receipts, amount)
      for (const total of [...aggregates, paymentBucket, ...(paymentHour ? [paymentHour] : [])]) {
        if (refund) total.refunds = addMoney(total.refunds, amount)
        else total.receipts = addMoney(total.receipts, amount)
        total.netReceipts = (cents(total.receipts) - cents(total.refunds)) / 100
      }
    }
    const externalPending = !order.assignees.length || order.assignees.some(writer => !adminIds.has(writer.userId) && writer.pay === null)
    rows.push({
      id: order.id, no: order.no, title: order.title, orderDate: order.orderDate, status: order.status, deletedAt: order.deletedAt,
      ownerId: order.ownerId, ownerName: owner.name, ownerAvatar: owner.avatar, ownerHue: owner.hue!,
      channelId: order.channelId, channelName: channel.name, channelAvatar: channel.avatar,
      incomeIncluded, netIncome, sales: calculation.sales, extraCostTotal: calculation.extraCostTotal,
      externalWriterCost: externalPending ? null : calculation.externalWriterCost,
      commissionCost: order.salesMode === 'cost' ? 0 : calculation.payPending ? null : calculation.commissionCost,
      receipts, refunds, periodReceipts: (cents(receipts) - cents(refunds)) / 100,
      receiptDates: [...new Set(payments.map(payment => payment.date))].sort(),
    })
  }
  const receiptRows: IncomeReportChannelReceipt[] = []
  const activeReceipts = (data.channelReceipts ?? []).filter(receipt => !receipt.revoked)
  for (const receipt of activeReceipts) {
    if (!selected(receipt.date)
      || (selection.ownerId && receipt.ownerId !== selection.ownerId)
      || (selection.channelId && receipt.channelId !== selection.channelId)) continue
    const owner = ownerOption(receipt.ownerId), channel = channelOption(receipt.channelId)
    const receiptHour = hourBucket('channelReceipts', receipt.id, receipt.date, { id: receipt.id, kind: '渠道收款', no: receipt.no, title: channel.name, value: receipt.amount })
    // 分配、订单转交都不改变主收款现金归属；渠道合并后的渠道按主笔当前 channelId。
    for (const total of [summary, group(channelGroups, channel), group(salesGroups, owner), bucket(receipt.date), ...(receiptHour ? [receiptHour] : [])]) {
      total.receipts = addMoney(total.receipts, receipt.amount)
      total.netReceipts = (cents(total.receipts) - cents(total.refunds)) / 100
      total.unallocatedReceipts = addMoney(total.unallocatedReceipts ?? 0, receipt.unallocated)
      total.channelReceiptTotal = addMoney(total.channelReceiptTotal ?? 0, receipt.amount)
    }
    receiptRows.push({ id: receipt.id, no: receipt.no, date: receipt.date, channelId: receipt.channelId, channelName: channel.name,
      ownerId: receipt.ownerId, ownerName: owner.name, amount: receipt.amount, allocated: receipt.allocated, unallocated: receipt.unallocated, lines: receipt.lines })
  }
  const rank = (a: IncomeReportGroup, b: IncomeReportGroup) => b.knownNetIncome - a.knownNetIncome || b.netReceipts - a.netReceipts || a.name.localeCompare(b.name, 'zh-CN')
  const uniqueOptions = (ids: string[], option: (id: string) => IncomeReportOption) => [...new Set(ids)].map(option).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return {
    selection, summary, ...(hourly ? { hourly } : {}),
    series: [...series.values()].sort((a, b) => a.key.localeCompare(b.key)),
    channels: [...channelGroups.values()].sort(rank), sales: [...salesGroups.values()].sort(rank),
    orders: rows.sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.no.localeCompare(a.no)),
    channelReceipts: receiptRows.sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no)),
    options: {
      channels: uniqueOptions([...data.orders.map(order => order.channelId), ...activeReceipts.map(receipt => receipt.channelId)], channelOption),
      sales: uniqueOptions([...data.orders.map(order => order.ownerId), ...activeReceipts.map(receipt => receipt.ownerId)], ownerOption),
    },
  }
}
