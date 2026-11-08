import { json, route } from '@/server/http'
import { createRewrite, requireToolbox, jobVisible } from '@/server/toolbox'
import { rewriteInput } from '@/server/toolbox-input'
import { ProviderError } from '@/server/rewrite-provider'
export const POST = route(async (req, c) => {
  requireToolbox(c)
  try {
    const result = await createRewrite(c, await rewriteInput(req, true))
    const job = await jobVisible(c, result.id)
    return json({ ...result, status: job.status })
  } catch (e) { if (e instanceof ProviderError) return json({ error: e.code === 'network_unknown' ? '连接写作牛暂时失败，本次尚未下单，请稍后重试' : e.message }, { status: 503 }); throw e }
})
