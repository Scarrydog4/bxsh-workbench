type WriterAmount = { userId: string; pay?: number | null }

/** 金额转成分后分配，最后一人承接尾差，始终不超写手总额。 */
export function splitWriterPool(total: number, ids: string[]): WriterAmount[] {
  const cents = Math.max(0, Math.round(total * 100))
  if (!ids.length) return []
  const share = Math.floor(cents / ids.length)
  return ids.map((userId, index) => ({ userId, pay: (index === ids.length - 1 ? cents - share * index : share) / 100 }))
}

/** 改一人的份额时，其余写手共同分配余额。 */
export function redistributeWriterPool(total: number, rows: WriterAmount[], userId: string, amount: number): WriterAmount[] | null {
  if (!Number.isFinite(amount) || amount < 0 || amount > total || !rows.some(row => row.userId === userId)) return null
  const rest = splitWriterPool(Math.round((total - amount) * 100) / 100, rows.filter(row => row.userId !== userId).map(row => row.userId))
  if (!rest.length && Math.round(amount * 100) !== Math.round(total * 100)) return null
  return rows.map(row => row.userId === userId ? { ...row, pay: amount } : rest.find(item => item.userId === row.userId)!)
}
