import { attachmentPreview } from '@/server/images'
import { stat } from 'node:fs/promises'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { attachments, audit, uploads, users, roles } from '@/server/schema'
import { bad, json, notFound, route } from '@/server/http'
import { fileOrder } from '@/server/file-access'
import type { Role } from '@/shared/types'
import { can, rowVisible } from '@/shared/perm'
import { broadcast } from '@/server/events'

/** 传完：转成附件（或某一轮的修改稿），记留痕 */
export const POST = route<{ id: string }>(async (_req, c, p) => {
  const [pending] = await db.select().from(uploads).where(and(eq(uploads.id, p.id), eq(uploads.userId, c.me.id)))
  if (!pending) throw notFound('上传不存在')
  const order = await fileOrder(db, pending.orderId, pending.afterSaleId)
  if (!order || !can(c.role, 'order.view') || !rowVisible(order, c.me, c.role)) throw notFound()
  if (pending.afterSaleId && (!order.afterSale || order.afterSale.writerId !== c.me.id && !c.role.locked)) throw notFound()
  const size = (await stat(pending.path)).size
  if (size !== pending.size || pending.received !== pending.size) throw bad('文件还没传完')
  // 图片处理不占全站写锁；每个文件只在首次收尾时生成。
  const thumbPath = !pending.doneAt && pending.mime.startsWith('image/') ? await attachmentPreview(pending.path) : null
  const u = await db.transaction(async (tx) => {
    // 和订单转交共用锁，检查权限到写入附件之间不能再换负责人。
    await tx.execute(sql`select pg_advisory_xact_lock(20261007)`)

    // 和传分片用同一把行锁：收尾时不会有分片正在写
    const [u] = await tx.select().from(uploads).where(and(eq(uploads.id, p.id), eq(uploads.userId, c.me.id))).for('update')
    if (!u) throw notFound('上传不存在')
    const s = await stat(u.path)
    if (s.size !== u.size || u.received !== u.size) throw bad('文件还没传完')
    const [actor] = await tx.select({ me: users, role: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, c.me.id), eq(users.active, true)))
    const me = actor?.me, role = actor?.role as unknown as Role | undefined
    const o = await fileOrder(tx, u.orderId, u.afterSaleId)
    if (!me || !role || !o || !can(role, 'order.view') || !rowVisible(o, me, role)) throw notFound()
    if (u.afterSaleId) {
      const a = o.afterSale
      if (!a || (a.writerId !== me.id && !role.locked)) throw notFound()
    }
    if (u.doneAt) {
      const [file] = await tx.select().from(attachments).where(and(eq(attachments.id, u.id.replace('up_', 'f_')), isNull(attachments.deletedAt)))
      if (!file) throw notFound('附件已删除')
      return { ...u, changed: false }
    }
    await tx.insert(attachments).values({ id: u.id.replace('up_', 'f_'), orderId: u.orderId, afterSaleId: u.afterSaleId, nodeId: u.nodeId, name: u.name, size: u.size, mime: u.mime, path: u.path, thumbPath, preview: thumbPath ? `/api/files/${u.id.replace('up_', 'f_')}?thumb=1` : null, by: c.me.id })
    await tx.update(uploads).set({ doneAt: new Date().toISOString() }).where(eq(uploads.id, u.id))
    await tx.insert(audit).values({ actorId: c.me.id, action: u.afterSaleId ? '交修改稿' : '上传附件', objectType: 'order', objectId: u.orderId, objectLabel: o?.no, to: u.name, ip: c.ip })
    return { ...u, changed: true }
  })
  if (u.changed) broadcast('changed', [u.orderId])
  return json({ id: u.id.replace('up_', 'f_') })
})
