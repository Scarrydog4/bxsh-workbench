import { json, route } from '@/server/http'
import { checkinRequestBody, decideCheckinRequest } from '@/server/checkin-requests'

export const PATCH = route<{ id: string }>(async (req, c, p) => json(await decideCheckinRequest(c, p.id, await checkinRequestBody(req))))
