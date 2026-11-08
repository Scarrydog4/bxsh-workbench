import { dmMessagePage } from '@/server/dm'
import { json, forumRoute as route } from '@/server/http'

export const GET = route<{ id: string }>(async (req, c, params) => {
  const query = new URL(req.url).searchParams
  const value = Number(query.get('limit') ?? 50)
  const limit = Number.isFinite(value) ? Math.min(100, Math.max(1, Math.trunc(value))) : 50
  return json(await dmMessagePage(c, params.id, query.get('before'), limit))
})
