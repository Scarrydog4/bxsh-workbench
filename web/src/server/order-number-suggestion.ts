import { and, eq, ilike, or, sql } from 'drizzle-orm'
import type { DB, Tx } from './db'
import { counters, orders } from './schema'
import { bad } from './http'
import { formatOrderNumber, orderNumberPrefix, orderNumberSequence } from '@/shared/order-number-suggestion'

async function numberState(db: DB | Tx, ownerId: string, prefix: string, date: string) {
  const full = date.replaceAll('-', '')
  // 包含回收站、退单和已转交的同号订单，避免重新使用已经发到群里的编号。
  const rows = await db.select({ title: orders.title, ownerId: orders.ownerId, date: orders.orderDate }).from(orders).where(or(
    and(eq(orders.ownerId, ownerId), eq(orders.orderDate, date)),
    ilike(orders.title, `${prefix}${full}%`), ilike(orders.title, `${prefix}${full.slice(2)}%`),
  ))
  const name = `business_order_serial:${prefix}:${date}`
  const [counter] = await db.select({ value: counters.value }).from(counters).where(eq(counters.name, name))
  const count = rows.filter(row => row.ownerId === ownerId && row.date === date).length
  const maximum = rows.reduce((max, row) => Math.max(max, orderNumberSequence(row.title, prefix, date)), 0)
  return { name, sequence: Math.max(count, maximum, counter?.value ?? 0) + 1 }
}

export async function suggestOrderNumber(db: DB | Tx, owner: { id: string; account: string }, date: string) {
  const prefix = orderNumberPrefix(owner.account)
  if (!prefix) return { number: null, prefix: null, sequence: null, ownerId: owner.id, date }
  const { sequence } = await numberState(db, owner.id, prefix, date)
  return { number: formatOrderNumber(prefix, date, sequence), prefix, sequence, ownerId: owner.id, date }
}

/** 仅采用建议号的新单走这里；复用录单事务，提交时再分配，预览不占号。 */
export async function assignSuggestedOrderTitle(tx: Tx, owner: { id: string; account: string }, date: string, title: string, suggested: string) {
  const prefix = orderNumberPrefix(owner.account)
  const sequence = prefix ? orderNumberSequence(suggested, prefix, date) : 0
  if (!prefix || sequence < 1 || suggested !== formatOrderNumber(prefix, date, sequence)
    || (title !== suggested && !title.startsWith(`${suggested} `))) throw bad('建议单号与人员、日期或订单名称不一致，请重新选择建议单号')
  const state = await numberState(tx, owner.id, prefix, date)
  const [allocated] = await tx.insert(counters).values({ name: state.name, value: state.sequence })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`greatest(${counters.value} + 1, ${state.sequence})` } }).returning({ value: counters.value })
  const result = `${formatOrderNumber(prefix, date, allocated.value)}${title.slice(suggested.length)}`
  if (result.length > 200) throw bad('订单名称太长，请缩短后保存')
  return result
}
