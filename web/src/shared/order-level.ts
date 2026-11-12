/** 录单时先选的层次：专科写「专」，本科写「本」，其他订单不标。 */
export type OrderLevel = '' | '专' | '本'

export const ORDER_LEVELS: readonly { value: OrderLevel; label: string; keys: readonly string[] }[] = [
  { value: '专', label: '专科', keys: ['z', '1'] },
  { value: '本', label: '本科', keys: ['b', '2'] },
  { value: '', label: '不标', keys: ['n', '3'] },
]

const NUMBER = /^((?:待定\s*)?[a-z]{1,12}\d{6,}(?:-\d+)?)(?:\s+|$)/i
const MARKED = /(^|\s)(专|本)(科)?(?=\s|$)/

/**
 * 把「专 / 本」放进订单名：有单号放在单号后面（单号识别、自动编号都认开头的单号），没有单号放最前面。
 * 订单名里已经单独写了专、专科、本、本科的，不再重复加。
 */
export function withOrderLevel(title: string, level: OrderLevel) {
  const t = title.trim()
  if (!level || !t || MARKED.test(t)) return t
  const m = t.match(NUMBER)
  if (!m) return `${level} ${t}`
  const rest = t.slice(m[0].length).trim()
  return rest ? `${m[1]} ${level} ${rest}` : `${m[1]} ${level}`
}
