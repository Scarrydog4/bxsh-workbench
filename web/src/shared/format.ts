export function today() {
  return new Date(businessDate(new Date()) + 'T00:00:00')
}

export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function iso(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function daysUntil(date: string | null) {
  if (!date) return null
  const t = today().getTime()
  const d = new Date(date + 'T00:00:00').getTime()
  return Math.round((d - t) / 86400000)
}

export function shortDate(date: string | null) {
  if (!date) return '—'
  const [y, m, d] = date.split('-')
  return `${y===businessDate(new Date()).slice(0,4)?'':y+'年'}${Number(m)}月${Number(d)}日`
}

const yuan = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
export function money(n: number | undefined) {
  if (n === undefined) return '—'
  return `¥${yuan.format(n)}`
}

export function relTime(isoTs: string) {
  const diff = (Date.now() - new Date(isoTs).getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  const d = new Date(isoTs)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

/** 建群时用的统一群名：渠道｜订单名前 10 字｜单号后 4 位，搜群、对单都方便 */
export function groupName(channel: string, title: string, no: string) {
  return `${channel}｜${title.slice(0, 10)}｜${no.slice(-4)}`
}

const businessCalendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })

/** 业务日期固定按北京时间，与浏览器和服务器所在时区无关。 */
export function businessDate(value: string | Date) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parts = businessCalendar.formatToParts(new Date(value))
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

const businessClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export function businessDateTime(value: string | Date) {
  const instant = new Date(value)
  return businessDate(instant) + ' ' + businessClock.format(instant)
}

/** 写手工资按北京时间归期：15 日前进当月，15 日及以后进下月。 */
export function payday(draftAt: string | null) {
  if (!draftAt) return null
  const [year, month, day] = businessDate(draftAt).split('-').map(Number)
  const next = month + (day < 15 ? 0 : 1)
  const payYear = year + (next > 12 ? 1 : 0)
  const payMonth = next > 12 ? 1 : next
  const y = payYear === Number(businessDate(new Date()).slice(0, 4)) ? '' : `${payYear}年`
  return `${y}${payMonth}月15日`
}

export function monthKey(date: string) {
  return date.slice(0, 7)
}

/** 发放期的日期键，如 2026-10-15：和 payday 同一规则，用来比较和分组 */
export function paydayKey(ts: string | null) {
  if (!ts) return null
  const [year, month, day] = businessDate(ts).split('-').map(Number)
  const next = month + (day < 15 ? 0 : 1)
  return `${year + (next > 12 ? 1 : 0)}-${String(next > 12 ? 1 : next).padStart(2, '0')}-15`
}

/** 2026-10-15 → 10月15日（不是今年的带年份） */
export function periodLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return `${y === new Date().getFullYear() ? '' : `${y}年`}${m}月15日`
}

/** 按日历日增加天数，避免跨时区或夏令时改变默认截止日。 */
export function deadlineFrom(orderDate: string, days = 10) {
  const d = new Date(`${orderDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
