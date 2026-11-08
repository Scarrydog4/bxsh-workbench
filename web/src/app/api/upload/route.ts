import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { uploads, orderNodes } from '@/server/schema'
import { fileOrder } from '@/server/file-access'
import { bad, json, notFound, route } from '@/server/http'
import { uid } from '@/server/ids'
import { CHUNK, newFilePath, safeName } from '@/server/files'
import { can, rowVisible } from '@/shared/perm'

/** 开始一次上传：不限大小，之后按 8MB 一片 PUT，断了可以查进度续传 */
export const POST = route(async (req, c) => {
  const b = z
    .object({ orderId: z.string(), afterSaleId: z.string().optional(), nodeId: z.string().optional(), name: z.string().min(1).max(300), size: z.number().int().min(0), mime: z.string().max(200).default('application/octet-stream') })
    .safeParse(await req.json().catch(() => null))
  if (!b.success) throw bad('上传信息不全')
  const o = await fileOrder(db, b.data.orderId, b.data.afterSaleId)
  if (!o || !rowVisible(o, c.me, c.role) || !can(c.role, 'order.view')) throw notFound()
  if (b.data.afterSaleId) {
    const a = o.afterSale
    if (!a) throw notFound()
    if (a.writerId !== c.me.id && !c.role.locked) throw bad('修改稿只能由负责的写手交')
  }
  if (b.data.nodeId && !(await db.select({ id: orderNodes.id }).from(orderNodes).where(and(eq(orderNodes.id, b.data.nodeId), eq(orderNodes.orderId, o.id))))[0]) throw notFound()
  const id = uid('up')
  const p = await newFilePath(id)
  await writeFile(p, '')
  await db.insert(uploads).values({ id, userId: c.me.id, orderId: o.id, afterSaleId: b.data.afterSaleId ?? null, nodeId: b.data.nodeId ?? null, name: safeName(b.data.name), mime: b.data.mime, size: b.data.size, path: p })
  return json({ id, chunk: CHUNK })
})
