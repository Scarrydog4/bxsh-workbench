import { canAccessReceiptChannel, canViewChannelReceipt } from '@/server/channel-receipts'
import { db } from '@/server/db'
import { bad, json, notFound, route } from '@/server/http'
import { loadWorld } from '@/server/repo'

export const GET = route(async (req, c) => {
  const q = new URL(req.url).searchParams, channelId = q.get('channelId'), id = q.get('id')
  if (!channelId && !id) throw bad('请选择渠道或收款记录')
  const w = await loadWorld(db, { includeDeleted: true })
  if (channelId && !canAccessReceiptChannel(w, c, channelId)) throw notFound()
  const receipts = (w.channelReceipts ?? []).filter(r => (!channelId || r.channelId === channelId) && (!id || r.id === id) && canViewChannelReceipt(w, c, r)).reverse()
  if (id && !receipts.length) throw notFound()
  return json({ receipts })
})
