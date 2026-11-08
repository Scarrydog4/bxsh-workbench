import type { IncomeRow } from './income'
import type { IncomeReportSelection } from './income-report'
import { cents, sumMoney } from './calc'
import { businessDate, deadlineFrom } from './format'

export interface PersonalIncomeMetrics {
  undatedDeducted?: number
  earned: number; commission: number; wages: number; paid: number; remaining: number; pendingCount: number; orderCount: number
}
export interface PersonalIncomeOrder {
  key: string; id: string; no: string; title: string; orderDate: string; deliveryDate?: string | null; status: string
  channelId: string; channelName: string; channelAvatar?: string; accessible: boolean
  undatedDeducted?: number
  kind: '销售提成' | '写手工资'; included: boolean; earned: number | null; paid: number; remaining: number
}
export interface PersonalIncomeBucket extends PersonalIncomeMetrics { key: string; start: string; end: string }
export interface PersonalIncomeReport {
  selection: IncomeReportSelection; summary: PersonalIncomeMetrics; series: PersonalIncomeBucket[]
  channels: (PersonalIncomeMetrics & { id: string; name: string; avatar?: string })[]
  orders: PersonalIncomeOrder[]
  options: { channels: { id: string; name: string; avatar?: string }[] }
  undatedPaid: number; undatedCount: number
  /** 当前本人工资约定总额，含未交付；按渠道筛选，不受交付日期筛选影响。 */
  wageSummary?: { total: number; pendingCount: number; orderCount: number }
  hourly?: { day: string; throughHour: number; hours: (PersonalIncomeMetrics & { key: string })[]; unknown: PersonalIncomeMetrics }
}
export interface PersonalOrderLabel {
  id: string; orderDate: string; channelId: string; channelName: string; channelAvatar?: string; accessible: boolean; createdAt?: string; deliveredAt?: string | null; deliveryDate?: string | null
}
export interface PersonalPayout {
  id: string; orderId: string; kind: '销售提成' | '写手工资'; amount: number; at: string | null
}
const empty = (): PersonalIncomeMetrics => ({ earned: 0, commission: 0, wages: 0, paid: 0, remaining: 0, pendingCount: 0, orderCount: 0 })
function period(day: string, selection: IncomeReportSelection) {
  if (selection.granularity === 'day') return { key: day, start: day, end: day }
  if (selection.granularity === 'week') {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay(), start = deadlineFrom(day, -(dow === 0 ? 6 : dow - 1))
    return { key: start, start, end: deadlineFrom(start, 6) }
  }
  const start = `${day.slice(0, 7)}-01`, next = new Date(`${start}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { key: day.slice(0, 7), start, end: deadlineFrom(next.toISOString().slice(0, 10), -1) }
}

/** 输入只含本人收入与本人实发；不接收公司利润或其他员工金额。 */
export function buildPersonalIncomeReport(rows: IncomeRow[], payouts: PersonalPayout[], labels: PersonalOrderLabel[], selection: IncomeReportSelection, now = new Date()): PersonalIncomeReport {
  const days = selection.dates ? new Set(selection.dates) : null
  const selected = (day: string) => days ? days.has(day) : day >= selection.from && day <= selection.to
  const info = new Map(labels.map(row => [row.id, row]))
  const allowed = (id: string) => !selection.channelId || (info.get(id)?.channelId || '__none__') === selection.channelId
  const wageRows = rows.filter(row => (row.kind === '工资' || row.kind === '追加工资') && allowed(row.id))
  const wageSummary = {
    total: sumMoney(wageRows.map(row => row.amount ?? 0)),
    pendingCount: new Set(wageRows.filter(row => row.amount === null).map(row => row.id)).size,
    orderCount: new Set(wageRows.map(row => row.id)).size,
  }
  const summary = empty(), buckets = new Map<string, PersonalIncomeBucket>(), channels = new Map<string, PersonalIncomeReport['channels'][number]>()
  const orders = new Map<string, PersonalIncomeOrder>(), counted = new WeakMap<object, Set<string>>()
  const bucket = (day: string) => { const range = period(day, selection); if (!buckets.has(range.key)) buckets.set(range.key, { ...range, ...empty() }); return buckets.get(range.key)! }
  if (days) for (const day of days) bucket(day)
  else for (let day = selection.from; day <= selection.to; day = deadlineFrom(day, 1)) bucket(day)
  const hourly: PersonalIncomeReport['hourly'] = selection.from === selection.to && selection.granularity === 'day' ? {
    day: selection.from, throughHour: selection.from === businessDate(now) ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(now)) : 23,
    hours: Array.from({ length: 24 }, (_, hour) => ({ ...empty(), key: `${String(hour).padStart(2, '0')}:00` })), unknown: empty(),
  } : undefined
  const hour = (at: string | undefined | null, day: string) => {
    if (!hourly) return undefined
    return at && at.length > 10 && Number.isFinite(Date.parse(at)) && businessDate(at) === day
      ? hourly.hours[Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)))] : hourly.unknown
  }
  const group = (id: string) => {
    const label = info.get(id), key = label?.channelId || '__none__'
    if (!channels.has(key)) channels.set(key, { ...empty(), id: key, name: label?.channelName ?? '历史订单', avatar: label?.channelAvatar })
    return channels.get(key)!
  }
  const add = (target: PersonalIncomeMetrics, field: Exclude<keyof PersonalIncomeMetrics,'undatedDeducted'>, value: number) => { target[field] = (cents(target[field]) + cents(value)) / 100 }
  const count = (target: PersonalIncomeMetrics, id: string) => { let set = counted.get(target); if (!set) counted.set(target, set = new Set()); if (!set.has(id)) { set.add(id); target.orderCount++ } }
  // 只解释已经由账本扣减的部分，不用整页的历史款反推行金额。
  const paidByLine = new Map<string,{ total:number; undated:number }>()
  for (const payment of payouts) {
    const key = payment.orderId + ':' + payment.kind
    const amounts = paidByLine.get(key) ?? {total:0,undated:0}
    amounts.total += cents(payment.amount)
    if (!payment.at) amounts.undated += cents(payment.amount)
    paidByLine.set(key,amounts)
  }
  const line = (source: IncomeRow, kind: PersonalIncomeOrder['kind']) => {
    const key = `${source.id}:${kind}`, label = info.get(source.id)
    if (!orders.has(key)) orders.set(key, { key, id: source.id, no: source.no, title: source.title, status: source.status, orderDate: label?.orderDate ?? source.date, ...(label?.deliveryDate !== undefined ? { deliveryDate: label.deliveryDate } : {}),
      channelId: label?.channelId || '__none__', channelName: label?.channelName ?? '历史订单', channelAvatar: label?.channelAvatar, accessible: label?.accessible ?? false,
      kind, included: false, earned: 0, paid: 0, remaining: source.left ?? 0 })
    const order = orders.get(key)!
    const evidence = paidByLine.get(key)
    if (evidence && evidence.undated > 0 && source.due != null && source.paid != null && source.over != null && evidence.total === cents(source.paid)) {
      const deducted = Math.max(0, evidence.undated - cents(source.over))
      if (deducted) order.undatedDeducted = deducted / 100
    }
    return order
  }
  const bases = new Map<string, IncomeRow>()
  for (const row of rows) if (row.kind !== '订单收入') bases.set(`${row.id}:${row.kind.includes('提成') ? '销售提成' : '写手工资'}`, row)
  const remainingCounted = new Set<string>()
  for (const row of rows) {
    if (!['工资', '追加工资', '提成'].includes(row.kind) || !selected(row.date) || !allowed(row.id)) continue
    const kind = row.kind === '提成' ? '销售提成' : '写手工资', order = line(row, kind)
    order.included = true; order.earned = order.earned === null || row.amount === null ? null : sumMoney([order.earned, row.amount])
    const label = info.get(row.id)
    const at = kind === '写手工资' && label?.deliveryDate !== undefined ? (label.deliveredAt?.includes('T') ? label.deliveredAt : undefined) : row.kind === '追加工资' ? undefined : label?.createdAt
    const targets = [summary, group(row.id), bucket(row.date), ...(hour(at, row.date) ? [hour(at, row.date)!] : [])]
    for (const total of targets) {
      count(total, row.id)
      if (row.amount === null) total.pendingCount++
      else { add(total, 'earned', row.amount); add(total, kind === '销售提成' ? 'commission' : 'wages', row.amount) }
    }
    if (!remainingCounted.has(order.key)) {
      remainingCounted.add(order.key)
      for (const total of [summary, group(row.id), bucket(row.date)]) {
        add(total, 'remaining', order.remaining)
        if (order.undatedDeducted) total.undatedDeducted = sumMoney([total.undatedDeducted ?? 0, order.undatedDeducted])
      }
    }
  }
  let undatedPaid = 0, undatedCount = 0
  for (const payment of payouts) {
    const source = bases.get(`${payment.orderId}:${payment.kind}`)
    if (!source || !allowed(source.id)) continue
    if (!payment.at) { undatedPaid = sumMoney([undatedPaid, payment.amount]); undatedCount++; continue }
    const day = businessDate(payment.at)
    if (!selected(day)) continue
    const order = line(source, payment.kind); order.paid = sumMoney([order.paid, payment.amount])
    for (const total of [summary, group(source.id), bucket(day), ...(hour(payment.at, day) ? [hour(payment.at, day)!] : [])]) add(total, 'paid', payment.amount)
  }
  const options = new Map<string, { id: string; name: string; avatar?: string }>()
  for (const row of rows) { const label = info.get(row.id), id = label?.channelId || '__none__'; options.set(id, { id, name: label?.channelName ?? '历史订单', avatar: label?.channelAvatar }) }
  return { selection, summary, series: [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start)), channels: [...channels.values()],
    orders: [...orders.values()].sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.no.localeCompare(a.no)), options: { channels: [...options.values()] }, undatedPaid, undatedCount, wageSummary, ...(hourly ? { hourly } : {}) }
}
