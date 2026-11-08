import { json, route } from '@/server/http'
import { createRewrite, listJobs, requireToolbox, startRewriteWorker } from '@/server/toolbox'
import { ProviderError } from '@/server/rewrite-provider'
import { pointsView } from '@/server/points'
import { rewriteInput } from '@/server/toolbox-input'

export const GET = route(async (_req, c) => {
  requireToolbox(c)
  startRewriteWorker()
  const [jobs, points] = await Promise.all([listJobs(c), pointsView(c)])
  return json({ jobs, points })
})

export const POST = route(async (req, c) => {
  requireToolbox(c)
  try {
    const result = await createRewrite(c, await rewriteInput(req))
    startRewriteWorker()
    return json(result)
  } catch (e) { if (e instanceof ProviderError) return json({ error: e.code === 'network_unknown' ? '连接写作牛暂时失败，本次尚未下单，请稍后重试' : e.message }, { status: 503 }); throw e }
})
