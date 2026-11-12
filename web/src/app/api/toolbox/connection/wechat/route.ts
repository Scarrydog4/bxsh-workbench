import { can } from '@/shared/perm'
import { bad, deny, json, route } from '@/server/http'
import { cancelRewriteLogin, checkRewriteLogin, createRewriteLogin } from '@/server/rewrite-login'
import { ProviderError } from '@/server/rewrite-provider'

export const POST = route(async (req, c) => {
  if (!can(c.role, 'toolbox.manage')) throw deny()
  const origin = new URL(req.headers.get('origin') ?? req.url).origin
  return json(await createRewriteLogin(c.me.id, origin))
})

export const PUT = route(async (req, c) => {
  if (!can(c.role, 'toolbox.manage')) throw deny()
  const data = await req.json().catch(() => null)
  if (typeof data?.id !== 'string') throw bad('请重新获取二维码')
  try { return json(await checkRewriteLogin(c.me.id, data.id)) }
  catch (e) { if (e instanceof ProviderError) return json({ error: e.message }, { status: 400 }); throw e }
})

export const DELETE = route(async (req, c) => {
  if (!can(c.role, 'toolbox.manage')) throw deny()
  const data = await req.json().catch(() => null)
  if (typeof data?.id !== 'string') throw bad('请重新获取二维码')
  await cancelRewriteLogin(c.me.id, data.id)
  return json({ ok: true })
})
