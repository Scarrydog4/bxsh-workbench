import { checkinPhoto } from '@/server/checkin'
import { bad, notFound, route } from '@/server/http'
import { fileResponse } from '@/server/range-response'

export const GET = route<{ id: string }>(async (req, c, { id }) => {
  const kind = new URL(req.url).searchParams.get('kind')
  if (kind !== 'in' && kind !== 'out') throw bad('请选择上班或下班照片')
  const file = await checkinPhoto(c, id, kind)
  try { return await fileResponse(req, { ...file, mime: 'image/webp', inline: true, cacheControl: 'private, no-store' }) }
  catch { throw notFound('照片暂时无法读取') }
})

export const HEAD = GET
