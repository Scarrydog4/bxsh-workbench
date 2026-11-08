import { bad, json, route } from '@/server/http'
import { checkinRequestBody, createCheckinRequest, listCheckinRequests } from '@/server/checkin-requests'

export const GET = route(async (req, c) => {
  const query = new URL(req.url).searchParams
  for (const key of query.keys()) {
    if (!['month', 'scope', 'status', 'limit', 'offset'].includes(key) || query.getAll(key).length !== 1) throw bad('申请查询条件不正确')
  }
  const scope = query.get('scope') ?? 'mine'
  if (scope !== 'mine' && scope !== 'team') throw bad('申请查询范围不正确')
  const status = query.get('status') ?? undefined
  if (status !== undefined && status !== 'pending') throw bad('申请状态条件不正确')
  for (const key of ['limit', 'offset']) if (query.has(key) && !/^\d+$/.test(query.get(key)!)) throw bad('申请分页参数不正确')
  return json(await listCheckinRequests(c, { month: query.get('month') ?? undefined, scope, status,
    limit: query.has('limit') ? Number(query.get('limit')) : undefined, offset: query.has('offset') ? Number(query.get('offset')) : undefined }))
})

export const POST = route(async (req, c) => json(await createCheckinRequest(c, await checkinRequestBody(req))))
