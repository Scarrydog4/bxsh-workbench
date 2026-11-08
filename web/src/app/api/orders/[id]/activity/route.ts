import { orderActivity } from '@/server/bootstrap'
import { json, notFound, route } from '@/server/http'

export const GET = route<{ id: string }>(async (_req, c, p) => {
  const rows = await orderActivity(c, p.id)
  if (!rows) throw notFound()
  return json(rows)
})
