import { json, route } from '@/server/http'
import { readBody, settleReviews, settleReviewsInput } from '@/server/work-materials'
export const POST = route(async (req, c) => json({ net: await settleReviews(c, await readBody(req, settleReviewsInput)) }))
