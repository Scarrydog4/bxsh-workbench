import { fileResponse } from '@/server/range-response'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { settleBatches } from '@/server/schema'
import { env } from '@/server/env'
import { route, notFound } from '@/server/http'
import { loadWorld } from '@/server/repo'
import { canViewSettlement, settlementInOrderScope } from '@/shared/settlement-access'

export const GET = route<{ id: string; hash: string }>(async (req, c, { id, hash }) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw notFound()
  const [batch] = await db.select().from(settleBatches).where(eq(settleBatches.id, id))
  if (!batch || !canViewSettlement(batch, c.me.id, c.role) || !batch.shots.includes(`/api/settle/${id}/images/${hash}`)) throw notFound()
  if (!c.role.locked && c.role.rowScope !== 'all' && batch.payeeId !== c.me.id) {
    const w = await loadWorld(db, { includeDeleted: true }), full = w.batches.find(row => row.id === id)
    if (!full || !settlementInOrderScope(full, w.orders, c.me.id, c.role)) throw notFound()
  }
  const suffix = new URL(req.url).searchParams.has('thumb') ? '.256.webp' : '.webp'
  return fileResponse(req,{path:path.join(env.storageDir,'private-images',hash+suffix),name:hash+suffix,mime:'image/webp',id:hash+suffix,inline:true,cacheControl:'private, no-store'})
})
export const HEAD = GET
