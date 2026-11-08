/** 待收不能被另一单的多收抵消；退单不纳入待收统计。 */
export function receiptTotals(rows: { unpaid?: number; status: string }[]) {
  let due = 0, extra = 0
  for (const row of rows) {
    if (row.status === '退单') continue
    const cents = Math.round((row.unpaid ?? 0) * 100)
    if (cents > 0) due += cents
    else extra -= cents
  }
  return { unpaid: due / 100, overpaid: extra / 100 }
}
