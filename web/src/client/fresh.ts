/** 刚录入的订单：订单表里高亮几秒，让人一眼找到。只存在当前页面内存里。 */
const fresh = new Map<string, number>()
export function markFresh(ids: string[]) {
  const now = Date.now()
  for (const id of ids) fresh.set(id, now)
}
export function isFresh(id: string, ms = 6000) {
  const t = fresh.get(id)
  if (!t) return false
  if (Date.now() - t > ms) {
    fresh.delete(id)
    return false
  }
  return true
}
