/** 空白表示未填，undefined 表示格式无效；不把输入错误当作零元。 */
export function parseMoneyInput(input: string, max = 10_000_000): number | null | undefined {
  const value = input.trim()
  if (!value) return null
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) return undefined
  const amount = Number(value)
  return Number.isFinite(amount) && amount <= max ? amount : undefined
}
