/** 时间按北京时间显示，规则见《论坛文案》第 1 节。 */
const parts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]))
  return { y: p.year, m: p.month, d: p.day, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}
const dayKey = (d: Date) => { const p = parts(d); return `${p.y}${p.m}${p.d}` }

export function relTime(iso: string, now = new Date()) {
  const t = new Date(iso), diff = now.getTime() - t.getTime(), p = parts(t)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (dayKey(t) === dayKey(now)) return `今天 ${p.hm}`
  if (dayKey(t) === dayKey(new Date(now.getTime() - 86_400_000))) return `昨天 ${p.hm}`
  if (p.y === parts(now).y) return `${p.m}-${p.d} ${p.hm}`
  return `${p.y}-${p.m}-${p.d}`
}

export function daySeparator(iso: string, now = new Date()) {
  const t = new Date(iso), p = parts(t)
  if (dayKey(t) === dayKey(now)) return '今天'
  if (dayKey(t) === dayKey(new Date(now.getTime() - 86_400_000))) return '昨天'
  return p.y === parts(now).y ? `${Number(p.m)}月${Number(p.d)}日` : `${p.y}年${Number(p.m)}月${Number(p.d)}日`
}
export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b))
export const clock = (iso: string) => parts(new Date(iso)).hm

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
export const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '')
export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
