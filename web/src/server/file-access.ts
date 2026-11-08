import { and, eq, isNull } from 'drizzle-orm'
import type { DB, Tx } from './db'
import * as t from './schema'

/** 图片和上传只需这一单的归属，不必读取全站订单、收款和结算。 */
export async function fileOrder(db: DB | Tx, orderId: string, afterSaleId?: string | null) {
  const [[order], assignees, [afterSale]] = await Promise.all([
    db.select({ id: t.orders.id, no: t.orders.no, ownerId: t.orders.ownerId, deletedAt: t.orders.deletedAt }).from(t.orders).where(and(eq(t.orders.id, orderId), isNull(t.orders.deletedAt))),
    db.select({ userId: t.orderWriters.userId }).from(t.orderWriters).where(eq(t.orderWriters.orderId, orderId)),
    afterSaleId ? db.select({ id: t.afterSales.id, writerId: t.afterSales.writerId, by: t.afterSales.by }).from(t.afterSales).where(and(eq(t.afterSales.id, afterSaleId), eq(t.afterSales.orderId, orderId))) : Promise.resolve([]),
  ])
  return order ? { ...order, assignees, afterSale } : null
}
