import { fileResponse } from '@/server/range-response'
import path from 'node:path'
import { canViewChannelReceipt } from '@/server/channel-receipts'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { notFound, route } from '@/server/http'
import { loadWorld } from '@/server/repo'

export const GET = route<{ id: string; hash: string }>(async (req, c, { id, hash }) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw notFound()
  const w = await loadWorld(db, { includeDeleted: true }), row = w.channelReceipts?.find(r => r.id === id)
  if (!row || !canViewChannelReceipt(w, c, row) || row.proof !== `/api/channel-receipts/${id}/images/${hash}`) throw notFound()
  const suffix = new URL(req.url).searchParams.has('thumb') ? '.256.webp' : '.webp'
  return fileResponse(req,{path:path.join(env.storageDir,'private-images',hash+suffix),name:hash+suffix,mime:'image/webp',id:hash+suffix,inline:true,cacheControl:'private, no-store'})
})
export const HEAD = GET
