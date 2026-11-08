import { z } from 'zod'
import { json, route, bad } from '@/server/http'
import { commitRewriteBatch, startRewriteWorker } from '@/server/toolbox'
import { MAX_REWRITE_BATCH } from '@/shared/toolbox'
export const POST = route(async (req, c) => {
  const b = z.object({ requestId: z.uuid(), jobIds: z.array(z.string().max(128)).min(1).max(MAX_REWRITE_BATCH), expectedPoints: z.number().int().min(1).max(1_000_000) }).safeParse(await req.json().catch(() => null))
  if (!b.success) throw bad('每批请选择 1–20 份稿件，并确认单份积分')
  const result = await commitRewriteBatch(c, b.data)
  startRewriteWorker()
  return json(result)
})
