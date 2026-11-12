import { HttpError } from '@/server/http'
import { receiveRewriteLogin } from '@/server/rewrite-login'

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'" }

export async function GET(req: Request, extra: { params: Promise<{ attempt: string }> }) {
  const { attempt } = await extra.params
  const [id, state] = attempt.split('.')
  const url = new URL(req.url)
  try {
    await receiveRewriteLogin(id ?? '', state ?? '', url.searchParams.get('token') ?? '')
    return new Response(null, { status: 303, headers: { ...headers, location: `/api/toolbox/connection/wechat/callback?login=${id}` } })
  } catch (e) {
    const message = e instanceof HttpError ? '二维码已失效或登录校验失败，请返回工具箱重新获取。' : '登录暂时未完成，请返回工具箱重试。'
    return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>写作牛微信登录</title><body style="font:15px/1.8 system-ui;text-align:center;padding:60px 16px">${message}</body></html>`, { status: 400, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
  }
}
