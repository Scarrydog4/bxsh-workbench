import type { Tx } from './db'
import * as t from './schema'

export interface NoteIn {
  kind: string
  orderId?: string | null
  /** 点开去哪：订单页签（overview / aftersale / nodes / comments / payments / settle），或 page:settle 这样的页面 */
  tab?: string | null
  title: string
  body?: string
  actorId?: string | null
  /** 时间触发的提醒用它去重：同一个人同一个 key 只发一次 */
  key?: string
}

/** 发提醒：不发给做这件事的人自己；同 key 的只发一次 */
export async function notify(tx: Tx, userIds: (string | null | undefined)[], n: NoteIn) {
  const to = Array.from(new Set(userIds.filter((x): x is string => !!x && x !== n.actorId)))
  if (!to.length) return 0
  const rows = await tx
    .insert(t.notifications)
    .values(to.map((userId) => ({ userId, kind: n.kind, orderId: n.orderId ?? null, tab: n.tab ?? null, title: n.title, body: n.body ?? '', actorId: n.actorId ?? null, key: n.key ?? null })))
    .onConflictDoNothing()
    .returning({ id: t.notifications.id })
  return rows.length
}
