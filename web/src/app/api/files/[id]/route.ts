import { canSeeAfterSale } from '@/shared/after-sale-access'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/server/db'
import { attachments } from '@/server/schema'
import { fileOrder } from '@/server/file-access'
import { notFound, route } from '@/server/http'
import { can, rowVisible } from '@/shared/perm'
import { fileResponse } from '@/server/range-response'

/** 下载附件：先确认这单在你的可见范围内。?inline=1 时图片在浏览器里直接显示（看大图用） */
export const GET = route<{ id: string }>(async (req, c, p) => {
  const [f] = await db.select().from(attachments).where(and(eq(attachments.id, p.id), isNull(attachments.deletedAt)))
  if (!f) throw notFound()
  const o = await fileOrder(db, f.orderId, f.afterSaleId)
  const a = o?.afterSale
  const visible = o && (rowVisible(o,c.me,c.role) || a && canSeeAfterSale(o,a,c.me,c.role))
  if (!visible || !can(c.role, 'order.view')) throw notFound()
  if (f.purpose === 'payment-proof' && !c.role.locked && !c.role.fields.sales) throw notFound()
  if (f.purpose === 'cost-proof' && !c.role.locked && !c.role.fields.profit) throw notFound()
  const isThumb = new URL(req.url).searchParams.has('thumb') && !!f.thumbPath
  const filePath = isThumb ? f.thumbPath! : f.path
  const mime = isThumb ? 'image/webp' : f.mime
  return fileResponse(req, { path: filePath, name: isThumb ? `${f.id}.webp` : f.name, mime, id: `${f.id}-${isThumb ? 'thumb' : 'file'}`, inline: isThumb || new URL(req.url).searchParams.get('inline') === '1' })
})

export const HEAD = GET
