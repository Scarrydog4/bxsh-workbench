import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

vi.mock('@/server/session', () => ({ getCtx: vi.fn() }))
vi.mock('@/server/rewrite-transport', () => ({ rewriteDispatcher: () => undefined }))
import { env } from '@/server/env'
import { getCtx } from '@/server/session'
import { createRewriteLogin, receiveRewriteLogin, checkRewriteLogin, cancelRewriteLogin } from '@/server/rewrite-login'
import { saveRewriteCredential } from '@/server/rewrite-provider'
import { POST, PUT } from '@/app/api/toolbox/connection/wechat/route'
import { GET as callback } from '@/app/api/toolbox/connection/wechat/callback/[attempt]/route'
import { GET as returnPage } from '@/app/api/toolbox/connection/wechat/callback/route'

let dir: string, previousDir: string, callbackUrl: string
const token = (id: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ user_id: id, exp: 2000000000 })).toString('base64url')}.signature`
beforeEach(async () => {
  previousDir = env.storageDir; dir = await mkdtemp(path.join(os.tmpdir(), 'bxsh-login-')); env.storageDir = dir
  await writeFile(path.join(dir, '.ycjg-connection.json'), JSON.stringify({ token: token('original') }))
  vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => {
    const url = new URL(input)
    if (url.hostname === 'xznwdhd.ycjg.top') {
      callbackUrl = url.searchParams.get('redirect_url')!
      return Response.json({ qr_url: 'https://open.weixin.qq.com/connect/qrconnect?appid=wxed18b5715678718b&fast_login=1' })
    }
    return Response.json({ code: 200, data: { is_expired: false, level_value: 1, level_name: 'SVIP' } })
  }))
})
afterEach(async () => { env.storageDir = previousDir; await rm(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })
function parts() { return new URL(callbackUrl).pathname.split('/').at(-1)!.split('.') }

it('二维码来自写作牛微信应用，回调令牌只存服务端，发起人确认后保存且不回显', async () => {
  const attempt = await createRewriteLogin('boss', 'https://workbench.example')
  expect(new URL(attempt.qrUrl).origin).toBe('https://open.weixin.qq.com')
  expect(new URL(attempt.qrUrl).searchParams.get('fast_login')).toBe('0')
  expect(await checkRewriteLogin('boss', attempt.id)).toEqual({ status: 'waiting' })
  const [id, secret] = parts()
  expect(new URL(callbackUrl).origin).toBe('https://workbench.example')
  const r = await callback(new Request(`${callbackUrl}?token=${token('original')}`), { params: Promise.resolve({ attempt: `${id}.${secret}` }) })
  expect(r.status).toBe(303); expect(r.headers.get('location')).not.toContain('token')
  const result = await checkRewriteLogin('boss', attempt.id)
  expect(result.status).toBe('connected'); expect(JSON.stringify(result)).not.toContain(token('original'))
  expect(JSON.parse(await readFile(path.join(dir, '.ycjg-connection.json'), 'utf8')).token).toBe(token('original'))
  expect(await readdir(path.join(dir, '.ycjg-login'))).toEqual([])
})

it('拒绝别的管理员拿结果、伪造回调、过期二维码和取消后重用', async () => {
  const attempt = await createRewriteLogin('boss', 'https://workbench.example'), [id, secret] = parts()
  await expect(checkRewriteLogin('someone-else', id)).rejects.toMatchObject({ status: 404 })
  await expect(receiveRewriteLogin(id, '0'.repeat(64), token('original'))).rejects.toMatchObject({ status: 400 })
  await cancelRewriteLogin('boss', id)
  await expect(receiveRewriteLogin(id, secret, token('original'))).rejects.toMatchObject({ status: 404 })
  const next = await createRewriteLogin('boss', 'https://workbench.example')
  vi.useFakeTimers(); vi.setSystemTime(next.expiresAt + 1)
  await expect(checkRewriteLogin('boss', next.id)).rejects.toMatchObject({ status: 400 })
  expect(attempt.id).not.toBe(next.id)
})

it('扫码其他写作牛账号不会覆盖原账号，手动凭据接口也遵守绑定', async () => {
  const attempt = await createRewriteLogin('boss', 'https://workbench.example'), [id, secret] = parts()
  await receiveRewriteLogin(id, secret, token('someone-else'))
  await expect(checkRewriteLogin('boss', attempt.id)).rejects.toMatchObject({ code: 'account_mismatch' })
  await expect(saveRewriteCredential(token('someone-else'))).rejects.toMatchObject({ code: 'account_mismatch' })
  expect(JSON.parse(await readFile(path.join(dir, '.ycjg-connection.json'), 'utf8')).token).toBe(token('original'))
})

it('销售和写手不能生成二维码或完成连接，未登录不可访问', async () => {
  const extra = { params: Promise.resolve({}) }
  for (const role of [null, { me: { id: 'sales' }, role: { locked: false, perms: ['toolbox.use'] } }, { me: { id: 'writer' }, role: { locked: false, perms: [] } }]) {
    vi.mocked(getCtx).mockResolvedValue(role as never)
    const r = await POST(new Request('http://test.local/api/toolbox/connection/wechat', { method: 'POST', headers: { 'content-type': 'application/json' } }), extra)
    expect(r.status).toBe(role ? 403 : 401)
    const p = await PUT(new Request('http://test.local/api/toolbox/connection/wechat', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }), extra)
    expect(p.status).toBe(role ? 403 : 401)
  }
  expect(fetch).not.toHaveBeenCalled()
})

it('微信跳转整个窗口时回到工具箱继续完成，iframe 回跳保留给父页确认', async () => {
  const id = 'a'.repeat(32)
  const response = await returnPage(new Request(`https://workbench.example/api/toolbox/connection/wechat/callback?login=${id}`))
  const html = await response.text()
  expect(html).toContain('window.self===window.top')
  expect(html).toContain(`/tools?rewriteLogin=${id}`)
  expect(response.headers.get('content-security-policy')).toContain("script-src 'nonce-")
  const invalid = await returnPage(new Request('https://workbench.example/api/toolbox/connection/wechat/callback?login=%3Cscript%3E'))
  expect(await invalid.text()).not.toContain('<script>')
})
