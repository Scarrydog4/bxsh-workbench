import { dmThreadList } from '@/server/dm'
import { json, forumRoute as route } from '@/server/http'

export const GET = route(async (req, c) => {
  const params = new URL(req.url).searchParams
  const number = (key: string, fallback: number, max: number) => {
    const value = Number(params.get(key) ?? fallback)
    return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.trunc(value))) : fallback
  }
  return json(await dmThreadList(c, Math.max(1, number('limit', 50, 100)), number('mineOffset', 0, 1_000_000), number('othersOffset', 0, 1_000_000)))
})
