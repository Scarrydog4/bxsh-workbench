type ShareName = { title: string; type?: string; number?: string; pending?: boolean }
type ShareText = Omit<ShareName, 'number' | 'pending'> & {
  total: number | null
  /** null means the current account cannot see payment details. */
  paid: number | null
  paymentTag?: string
  salesMode?: string
}

/** Copy text only: never add payment markers to the saved order title. */
export function orderShareName({ title, type, number, pending = false }: ShareName) {
  let name = title.trim().replace(/^待定\s*/, '').replace(/\s+/g, ' ')
  if (number && !/^[a-z]{1,12}\d{6,}/i.test(name)) name = `${number} ${name}`.trim()
  const category = type?.trim()
  if (category && !name.includes(category)) name = `${name} ${category}`.trim()
  return `${pending ? '待定 ' : ''}${name}`.trim()
}

const cents = (value: number | null) => value !== null && Number.isFinite(value) ? Math.round(value * 100) : null
const amount = (value: number) => String(value / 100)

/** Use server-confirmed title and confirmed receipts when composing a saved order. */
export function orderShareText({ title, type, total, paid, paymentTag, salesMode }: ShareText) {
  const totalCents = cents(total), paidCents = cents(paid)
  const cost = salesMode === 'cost'
  const pending = paidCents !== null && paidCents <= 0 && totalCents !== 0
  const parts = [orderShareName({ title, type, pending })]
  if (totalCents !== null) parts.push(`${cost ? '应付底价' : '全款'}${amount(totalCents)}`)
  if (paidCents === null) return parts.join(' ')
  if (totalCents === 0 && paidCents === 0) parts.push('无需付款')
  else if (paidCents <= 0) parts.push(cost ? '销售未付' : '定金未付')
  else if (cost) parts.push(`销售已付${amount(paidCents)}`)
  else if (totalCents !== null && paidCents >= totalCents) {
    parts.push(paidCents === totalCents ? '已付清' : `已付${amount(paidCents)} 多付${amount(paidCents - totalCents)}`)
  } else parts.push(`${paymentTag === '尾款' ? '尾款' : '定金'}${amount(paidCents)}已付`)
  return parts.join(' ')
}
