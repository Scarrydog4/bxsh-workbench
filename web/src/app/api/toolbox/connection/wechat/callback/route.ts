const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'" }

function page(message: string, status = 200) {
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>写作牛微信登录</title><body style="font:15px/1.8 system-ui;text-align:center;padding:72px 20px;color:#126a59">${message}</body></html>`, { status, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('login')
  if (!id || !/^[a-f0-9]{32}$/.test(id)) return page('已收到扫码结果，请返回工具箱。')
  const nonce = randomBytes(16).toString('base64')
  // 微信可能跳转整个窗口，也可能只跳转二维码 iframe，两种情况都能继续自动完成登录。
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>写作牛微信登录</title><body style="font:15px/1.8 system-ui;text-align:center;padding:72px 20px;color:#126a59">已收到扫码结果，正在恢复工具连接。<script nonce="${nonce}">if(window.self===window.top)window.location.replace('/tools?rewriteLogin=${id}');</script></body></html>`, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'self'` } })
}
import { randomBytes } from 'node:crypto'

