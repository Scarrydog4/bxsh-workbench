import { json, route, deny } from '@/server/http'
import { createReview, listReviews, readBody, reviewCount, reviewInput } from '@/server/work-materials'
export const GET = route(async (req, c) => json(new URL(req.url).searchParams.has('count') ? await reviewCount(c) : await listReviews(c)))
export const POST = route(async (req, c) => {
  if (!c.role.locked) throw deny()
  await createReview(c, await readBody(req, reviewInput))
  return json({ ok: true })
})
