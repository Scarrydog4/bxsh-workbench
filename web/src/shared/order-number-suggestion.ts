/** 业务单号放在订单名称前，DD 系统编号和渠道单号仍各自保留。 */
const PREFIXES = new Map([['boss', 'aj'], ['acheng', 'ac'], ['xiaoyang', 'xy']])

export function orderNumberPrefix(account: string) {
  return PREFIXES.get(account.toLowerCase()) ?? null
}

export function formatOrderNumber(prefix: string, date: string, sequence: number) {
  return `${prefix}${date.slice(2).replaceAll('-', '')}${String(sequence).padStart(2, '0')}`
}

/** 兼容历史四位年份，改用短年份后仍接着当天已使用的最大序号。 */
export function orderNumberSequence(title: string, prefix: string, date: string) {
  const full = date.replaceAll('-', '')
  const match = title.trim().match(new RegExp(`^${prefix}(?:${full}|${full.slice(2)})(\\d{2,9})(?!\\d)`, 'i'))
  return match ? Number(match[1]) : 0
}
