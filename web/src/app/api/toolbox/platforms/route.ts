import { json, route } from '@/server/http'
import { requireToolbox } from '@/server/toolbox'
import { listRewritePlatforms, ProviderError, providerConfigured, rewriteConnection } from '@/server/rewrite-provider'
import { can } from '@/shared/perm'
import { MAX_REWRITE_INPUT } from '@/shared/toolbox'
export const GET = route(async (_req, c) => {
  requireToolbox(c)
  const configured = await providerConfigured()
  let connection: Awaited<ReturnType<typeof rewriteConnection>> | null = null
  let platforms: Awaited<ReturnType<typeof listRewritePlatforms>> = [], error: string | null = null
  if (configured) {
    try { [platforms, connection] = await Promise.all([listRewritePlatforms(), rewriteConnection()]) } catch (e) { error = e instanceof ProviderError ? e.code === 'network_unknown' ? '写作牛连接暂时中断，请点击重新连接' : e.code === 'response_invalid' ? '读取写作牛平台目录失败，请重新连接' : e.message : '写作牛连接暂时不可用' }
  } else error = '请管理员在服务设置中更新写作牛登录凭据'
  return json({ configured, platforms, error, manage: can(c.role, 'toolbox.manage'), maxInputBytes: MAX_REWRITE_INPUT,
    connection, billing: '每次处理固定积分，由管理员设置；完成后扣除，失败退回预占积分' })
})
