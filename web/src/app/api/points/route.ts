import { z } from 'zod'
import { route, json, bad } from '@/server/http'
import { pointsView, allocatePoints, setToolPrice } from '@/server/points'
export const GET = route(async (_req, c) => json(await pointsView(c)))
export const POST = route(async (req, c) => {
  const b = z.discriminatedUnion('action', [
    z.object({ action: z.literal('allocate'), requestId: z.uuid(), userId: z.string().max(128), points: z.number().int().min(1).max(100_000_000), note: z.string().trim().min(1).max(200) }),
    z.object({ action: z.literal('price'), points: z.number().int().min(1).max(1_000_000) }),
  ]).safeParse(await req.json().catch(() => null))
  if (!b.success) throw bad('请填写正确的积分数量和分配原因')
  if (b.data.action === 'allocate') return json(await allocatePoints(c, b.data))
  await setToolPrice(c, b.data)
  return json({ ok: true })
})
