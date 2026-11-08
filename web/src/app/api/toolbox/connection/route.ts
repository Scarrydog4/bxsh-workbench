import { can } from '@/shared/perm'
import { route, json, bad, deny } from '@/server/http'
import { saveRewriteCredential, ProviderError } from '@/server/rewrite-provider'

export const PUT = route(async (req, c) => {
  if (!can(c.role, 'toolbox.manage')) throw deny()
  const raw = await req.text()
  if (raw.length > 16000) throw bad('登录凭据过长')
  let token: unknown
  try { token = JSON.parse(raw).token } catch { throw bad('请输入登录链接或 token') }
  if (typeof token !== 'string') throw bad('请输入登录链接或 token')
  try { return json(await saveRewriteCredential(token)) }
  catch (e) { if (e instanceof ProviderError) return json({ error: e.message }, { status: 400 }); throw e }
})
