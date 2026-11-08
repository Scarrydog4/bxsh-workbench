/** 每位写手按本单保存的比例计价，人民币四舍五入到分。 */
export function writerPayAtRate(amount: number, rate: number) {
  return Math.round(Math.round(amount * 100) * rate) / 100
}
