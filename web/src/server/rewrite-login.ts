import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from './env'
import { bad, notFound } from './http'
import { saveRewriteCredential } from './rewrite-provider'

const TTL = 3 * 60_000
type Login = { id: string; actorId: string; secret: string; expiresAt: number; token?: string }
const directory = () => path.join(env.storageDir, '.ycjg-login')
function file(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw notFound('二维码已失效，请重新获取')
  return path.join(directory(), `${id}.json`)
}
async function read(id: string): Promise<Login> {
  let login: Login
  try { login = JSON.parse(await readFile(file(id), 'utf8')) } catch { throw notFound('二维码已失效，请重新获取') }
  if (login.expiresAt <= Date.now()) {
    await unlink(file(id)).catch(() => {})
    throw bad('二维码已过期，请重新获取')
  }
  return login
}
async function write(login: Login) {
  const target = file(login.id), temp = `${target}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(login), { mode: 0o600 })
  await rename(temp, target)
}

export async function createRewriteLogin(actorId: string, origin: string) {
  await mkdir(directory(), { recursive: true, mode: 0o700 })
  // 新建时清掉旧二维码和同一管理员上一次的登录，关闭弹窗后也不留下令牌。
  for (const name of await readdir(directory())) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue
    const target = path.join(directory(), name)
    const previous = JSON.parse(await readFile(target, 'utf8').catch(() => 'null')) as Login | null
    if (previous && (previous.actorId === actorId || previous.expiresAt <= Date.now())) await unlink(target).catch(() => {})
  }
  const login: Login = { id: randomBytes(16).toString('hex'), secret: randomBytes(32).toString('hex'), actorId, expiresAt: Date.now() + TTL }
  const callback = new URL(`/api/toolbox/connection/wechat/callback/${login.id}.${login.secret}`, origin)
  const url = new URL('https://xznwdhd.ycjg.top/api/wechat_login_url')
  url.searchParams.set('redirect_url', callback.href)
  url.searchParams.set('browser_id', `bxsh-${login.id}`)
  let qr: URL
  try {
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw Error('upstream')
    const data = await response.json()
    qr = new URL(data.qr_url)
    if (qr.origin !== 'https://open.weixin.qq.com' || qr.pathname !== '/connect/qrconnect' || qr.searchParams.get('appid') !== 'wxed18b5715678718b') throw Error('invalid_qr')
  } catch { throw bad('暂时无法获取写作牛登录二维码，请稍后重试') }
  qr.searchParams.set('fast_login', '0')
  await write(login)
  return { id: login.id, qrUrl: qr.href, expiresAt: login.expiresAt }
}

/** 微信回跳不依赖第三方 iframe Cookie，凭一次性随机 state 对应到管理员发起的登录。 */
export async function receiveRewriteLogin(id: string, secret: string, token: string) {
  const login = await read(id)
  if (!/^[a-f0-9]{64}$/.test(secret) || !timingSafeEqual(Buffer.from(secret), Buffer.from(login.secret))) throw bad('登录校验失败，请重新扫码')
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 8192) throw bad('未收到有效的写作牛登录，请重新扫码')
  if (!login.token) await write({ ...login, token })
}

export async function checkRewriteLogin(actorId: string, id: string) {
  const login = await read(id)
  if (login.actorId !== actorId) throw notFound()
  if (!login.token) return { status: 'waiting' as const }
  try {
    const connection = await saveRewriteCredential(login.token)
    return { status: 'connected' as const, connection }
  } finally { await unlink(file(id)).catch(() => {}) }
}

export async function cancelRewriteLogin(actorId: string, id: string) {
  const login = await read(id)
  if (login.actorId !== actorId) throw notFound()
  await unlink(file(id)).catch(() => {})
}
