import { sumMoney } from './calc'
import type { IncomeReportOption, IncomeReportSelection } from './income-report'
import { buildPersonalIncomeReport, type PersonalIncomeMetrics, type PersonalIncomeOrder, type PersonalIncomeReport } from './personal-income-report'

export interface SalesIncomeOrder extends PersonalIncomeOrder {
  payeeId: string; payeeName: string; payeeAvatar?: string; payeeHue?: number
}
export interface SalesIncomeReport extends PersonalIncomeReport {
  peopleByPeriod?: Record<string, IncomeReportOption[]>
  peopleByChannel?: Record<string, IncomeReportOption[]>
  payeeId: string | null
  orders: SalesIncomeOrder[]
  sales: (PersonalIncomeMetrics & IncomeReportOption)[]
  options: PersonalIncomeReport['options'] & { sales: IncomeReportOption[] }
}

/** 每位销售先按本人台账统计，再合并；转交订单的旧实发不归到新销售名下。 */
export function buildSalesIncomeReport(entries: { person: IncomeReportOption; report: PersonalIncomeReport }[], selection: IncomeReportSelection,
  salesOptions: IncomeReportOption[], payeeId: string | null, now = new Date()): SalesIncomeReport {
  const base = buildPersonalIncomeReport([], [], [], selection, now)
  const result: SalesIncomeReport = { ...base, payeeId, orders: [], sales: [], options: { channels: [], sales: salesOptions }, peopleByPeriod: {}, peopleByChannel: {} }
  const fields = ['earned', 'commission', 'wages', 'paid', 'remaining', 'pendingCount', 'orderCount'] as const
  const merge = (target: PersonalIncomeMetrics, source: PersonalIncomeMetrics) => {
    if (source.undatedDeducted) target.undatedDeducted = sumMoney([target.undatedDeducted ?? 0,source.undatedDeducted])
    for (const field of fields) target[field] = sumMoney([target[field], source[field]])
  }
  const series = new Map(result.series.map(row => [row.key, row]))
  const channels = new Map<string, PersonalIncomeReport['channels'][number]>()
  const channelOptions = new Map<string, PersonalIncomeReport['options']['channels'][number]>()
  for (const { person, report } of entries) {
    merge(result.summary, report.summary)
    result.sales.push({ ...report.summary, ...person })
    for (const row of report.series) {
      merge(series.get(row.key)!, row)
      if (row.orderCount || row.paid || row.pendingCount) (result.peopleByPeriod![row.key] ??= []).push(person)
    }
    for (const row of report.channels) {
      if (row.orderCount || row.paid || row.pendingCount) (result.peopleByChannel![row.id] ??= []).push(person)
      const found = channels.get(row.id)
      if (found) merge(found, row)
      else channels.set(row.id, { ...row })
    }
    for (const channel of report.options.channels) channelOptions.set(channel.id, channel)
    result.orders.push(...report.orders.map(order => ({ ...order, key: `${person.id}:${order.key}`, payeeId: person.id,
      payeeName: person.name, payeeAvatar: person.avatar, payeeHue: person.hue })))
    result.undatedPaid = sumMoney([result.undatedPaid, report.undatedPaid])
    result.undatedCount += report.undatedCount
    if (result.hourly && report.hourly) {
      report.hourly.hours.forEach((hour, index) => merge(result.hourly!.hours[index], hour))
      merge(result.hourly.unknown, report.hourly.unknown)
    }
  }
  result.channels = [...channels.values()]
  result.options.channels = [...channelOptions.values()]
  result.orders.sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.no.localeCompare(a.no) || a.payeeName.localeCompare(b.payeeName))
  return result
}
