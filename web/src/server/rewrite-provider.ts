import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RewritePlatform, RewriteOptions, RewriteProviderState, RewriteLanguage } from '@/shared/toolbox'
import { MAX_REWRITE_RESULT } from '@/shared/toolbox'
import { env } from './env'
import { rewriteDispatcher, rewriteRequestNotSent, clearRewriteAddress } from './rewrite-transport'

const ORIGIN = 'https://w.ycjg.top'
const LANGUAGES: Record<string, RewriteLanguage> = { chinese: 'CN', english: 'EN', russian: 'RU', japanese: 'JA' }
const languageName = (language: string) => Object.keys(LANGUAGES).find((key) => LANGUAGES[key] === language) ?? 'chinese'
// 与写作牛前端一致：文本传平台名称，Word 接口传平台标识。
const PLATFORM_IDS: Record<string, string> = {
  '知网': 'zhiwang', '维普': 'weipu', '格子达': 'gezida', 'PaperYY': 'paperyy', '笔杆网': 'bigan',
  '万方': 'wanfang', '大雅': 'daya', 'PaperPass': 'paperpass', '朱雀': 'zhuque', '华宸': 'huachen',
  'Turnitin': 'turnitin', 'ZeroGPT': 'zerogpt',
}
export class ProviderError extends Error {
  constructor(public code: string, public definitive = false) { super(providerMessage(code)) }
}
export function providerMessage(code: string) {
  const messages: Record<string, string> = {
    configuration: '请管理员在服务设置中更新写作牛登录凭据',
    session_expired: '写作牛登录已过期，请管理员重新微信登录并更新凭据',
    unauthorized: '写作牛登录已失效，请管理员更新凭据',
    membership_expired: '写作牛账号尚未开通会员或会员已过期，请开通后刷新连接',
    permission_denied: '当前写作牛会员不支持这个模式，请更换模式或升级会员',
    quota_exceeded: '写作牛账号额度不足，请管理员查看账号',
    rate_limited: '写作牛请求过于频繁，本次未完成处理',
    network_unknown: '连接中断，正在核对原任务，请勿重复提交',
    response_invalid: '写作牛返回结果不完整，正在核对原任务',
    job_not_found: '尚未找到原任务结果，保留原编号继续核对',
    manual_check: '连接中断，原任务无法自动确认，请管理员核对写作牛记录；不会自动重发',
    legacy_disabled: '旧通道已停用，此任务不再提交，预占积分已退回',
    invalid_document: 'Word 文件结构不受支持，本次未开始处理',
    docx_required: '请将文件另存为 DOCX 后使用', no_safe_text: '请输入需要处理的正文',
    file_too_large: 'Word 文件不能超过 10MB', platform_unavailable: '所选平台或模式已更新，请重新选择',
    busy_not_started: '服务繁忙，本次未开始处理', document_integrity: '返回文件不是有效的 Word 文档',
    upstream_failed: '写作牛未完成处理，本次积分已退回',
    format_alignment: '改写稿结构与原稿不匹配，无法安全保留格式；本次积分退回',
    no_safe_rewrite: '这个模式的改写无法同时保持原稿数据和分页，本次未交付、积分退回；请换较轻的模式',
  }
  return messages[code] ?? '写作牛暂未完成处理，请管理员核对原任务'
}
const credentialFile = () => process.env.YCJG_TOKEN_FILE ?? path.join(env.storageDir, '.ycjg-connection.json')
function tokenValue(value: string) {
  let token = value.trim()
  if (token.startsWith('https://')) {
    let u: URL
    try { u = new URL(token) } catch { throw new ProviderError('configuration', true) }
    if (u.origin !== ORIGIN) throw new ProviderError('configuration', true)
    token = u.searchParams.get('token') ?? ''
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 8192) throw new ProviderError('configuration', true)
  return token
}
async function credential() {
  let value = process.env.YCJG_TOKEN ?? ''
  try {
    const raw = await readFile(/* turbopackIgnore: true */ credentialFile(), 'utf8')
    value = raw.trim().startsWith('{') ? JSON.parse(raw).token : raw.match(/^YCJG_TOKEN=(.+)$/m)?.[1] ?? raw
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new ProviderError('configuration', true) }
  return tokenValue(value)
}
export async function providerConfigured() {
  try { await credential(); return true } catch { return false }
}
function errorCode(value: unknown, status = 200) {
  const d = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const code = String(d.code ?? '').toUpperCase()
  const message = String(d.error ?? d.detail ?? d.message ?? '')
  if (status === 401 || /TOKEN|SESSION|UNAUTHORIZED/.test(code)) return 'session_expired'
  if (/MEMBERSHIP_EXPIRED|NO_MEMBERSHIP/.test(code) || /会员.*过期|账户已过期|请充值|未开通会员/.test(message)) return 'membership_expired'
  if (/QUOTA|BALANCE/.test(code) || /额度不足|次数不足/.test(message)) return 'quota_exceeded'
  if (status === 403 || /PERMISSION/.test(code)) return 'permission_denied'
  if (status === 429 || /RATE_LIMIT/.test(code)) return 'rate_limited'
  return 'upstream_failed'
}
async function authFetch(endpoint: string, init: RequestInit = {}, override?: string) {
  const token = override ?? await credential()
  try {
    const response = await fetch(new URL(endpoint, ORIGIN), {
      ...init, cache: 'no-store', redirect: 'error',
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: init.signal ?? AbortSignal.timeout(30_000),
      dispatcher: rewriteDispatcher(),
    } as RequestInit & { dispatcher: ReturnType<typeof rewriteDispatcher> })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new ProviderError(errorCode(data, response.status), response.status >= 400 && response.status < 500)
    }
    return response
  } catch (e) {
    if (e instanceof ProviderError) throw e
    clearRewriteAddress()
    const unsent = rewriteRequestNotSent(e)
    const cause = (e as { cause?: { code?: string } })?.cause
    console.warn('[ycjg transport]', { endpoint, phase: unsent ? 'before_http' : 'request', code: cause?.code ?? 'network_error' })
    throw new ProviderError(unsent && init.method === 'POST' ? 'busy_not_started' : 'network_unknown', unsent && init.method === 'POST')
  }
}
async function jsonRequest(endpoint: string, override?: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await authFetch(endpoint, {}, override)
      try { return await r.json() as Record<string, any> } catch { throw new ProviderError('response_invalid') }
    } catch (e) {
      if (attempt === 0 && e instanceof ProviderError && e.code === 'network_unknown') continue
      throw e
    }
  }
  throw new ProviderError('network_unknown')
}
export async function rewriteConnection(override?: string) {
  const token = override ? tokenValue(override) : await credential()
  const result = await jsonRequest('/api/membership/info', token)
  if (result.code !== 200 || !result.data) throw new ProviderError(errorCode(result), true)
  const d = result.data
  let expiresAt: string | null = null
  try { expiresAt = new Date(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000).toISOString() } catch { /* 由接口验证 */ }
  return { configured: true, available: d.is_expired === false && Number(d.level_value) >= 0,
    levelName: String(d.level_name ?? '无会员'), levelValue: Number(d.level_value ?? -1), expiresAt,
    membershipEnd: d.end_time ? String(d.end_time) : null }
}
export async function saveRewriteCredential(value: string) {
  const token = tokenValue(value)
  const status = await rewriteConnection(token)
  const file = credentialFile()
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify({ token }), { mode: 0o600 })
  await rename(temp, file)
  return status
}
export async function assertRewriteReady() {
  const c = await rewriteConnection()
  if (!c.available) throw new ProviderError('membership_expired', true)
}
export async function listRewritePlatforms(): Promise<RewritePlatform[]> {
  const result = await jsonRequest('/api/ycjgprompt/platform_modes')
  if (result.code !== 200 || !Array.isArray(result.data?.modes)) throw new ProviderError('response_invalid')
  const items: RewritePlatform[] = []
  const defaultZh = result.data.modes.find((m: Record<string, any>) => String(m.languages).split(',').includes('chinese'))?.value ?? ''
  const defaultEn = result.data.modes.find((m: Record<string, any>) => String(m.languages).split(',').includes('english'))?.value ?? ''
  for (const m of result.data.modes) {
    const language = LANGUAGES[m.languages]
    if (!language || !['降AI', '降重', '双降'].includes(m.check_modes) || typeof m.value !== 'string') continue
    for (const platform of String(m.platforms).split(',').map((v) => v.trim()).filter(Boolean)) {
      items.push({ id: `ycjg:${m.id}:${encodeURIComponent(platform)}`, name: `${platform} · ${m.type}`, languages: [language],
        platform, preset: m.value, presetZh: language !== 'EN' ? m.value : defaultZh, presetEn: language === 'EN' ? m.value : defaultEn,
        modeName: m.type, service: m.check_modes, permissionLevel: Number(m.permission_level ?? 0) })
    }
  }
  return items
}

/** 写作牛公开前端使用的响应编码；这里只解码传输数据，登录和会员校验仍由上游执行。 */
export function decodeYcjg(payload: Record<string, any>): Record<string, any> {
  const parts = new Map<number, string>()
  for (const [key, value] of Object.entries(payload)) {
    const pos = key.search(/[\u200b\u200c\u200d\u2060\u200e\u200f]/)
    if (pos < 0 || typeof value !== 'string') continue
    const index = key.slice(pos, pos + 12).match(/\d+/)
    if (index) parts.set(Number(index[0]), value)
  }
  try {
    if (parts.has(0)) {
      let manifest = ''
      for (let i = 0; parts.has(i); i++) manifest += parts.get(i)
      const parse = (s: string) => JSON.parse(Buffer.from(s.split('ycjg')[0].split('').reverse().join(''), 'base64').toString('utf8'))
      const order = parse(manifest).o
      if (Array.isArray(order) && order.every((key) => typeof payload[key] === 'string')) return parse(order.map((key) => payload[key]).join(''))
    }
  } catch { throw new ProviderError('response_invalid') }
  for (const value of Object.values(payload)) {
    if (typeof value !== 'string' || value.length < 24 || !/^[a-z2-7]+$/.test(value)) continue
    try {
      let bits = 0, acc = 0
      const bytes: number[] = []
      for (const ch of value) {
        acc = (acc << 5) | 'abcdefghijklmnopqrstuvwxyz234567'.indexOf(ch); bits += 5
        if (bits >= 8) { bits -= 8; const b = ((acc >> bits) & 255) ^ 90; bytes.push(((b << 3) | (b >> 5)) & 255) }
      }
      const order = JSON.parse(Buffer.from(bytes).toString('utf8')).o
      if (!Array.isArray(order) || !order.length || !order.every((key) => typeof payload[key] === 'string')) continue
      const joined = order.map((key) => payload[key]).join('').split('ycjg')[0].split('').reverse().join('')
      return JSON.parse(Buffer.from(joined, 'base64').toString('utf8'))
    } catch { /* 其他字段为干扰数据 */ }
  }
  return payload
}
export async function readRewriteStream(response: Response, receive: (data: Record<string, any>) => Promise<void>) {
  if (!response.body) throw new ProviderError('response_invalid')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', event = '', data: string[] = []
  const dispatch = async () => {
    if (!data.length) { event = ''; return }
    let decoded: Record<string, any>
    try { decoded = decodeYcjg(JSON.parse(data.join('\n'))) } catch { throw new ProviderError('response_invalid') }
    data = []
    if (event === 'error' || decoded.type === 'error' || decoded.error || decoded.success === false) {
      const code = errorCode(decoded)
      throw new ProviderError(code, ['membership_expired', 'permission_denied', 'session_expired', 'quota_exceeded'].includes(code))
    }
    event = ''
    await receive(decoded)
  }
  const line = async (raw: string) => {
    const s = raw.replace(/\r$/, '')
    if (!s) return dispatch()
    if (s.startsWith('event:')) event = s.slice(6).trim()
    else if (s.startsWith('data:')) data.push(s.slice(5).trimStart())
    else if (s.startsWith('{')) { await dispatch(); data = [s]; await dispatch() }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (buffer.length > 2 * 1024 * 1024) throw new ProviderError('response_invalid')
      let at: number
      while ((at = buffer.indexOf('\n')) >= 0) { await line(buffer.slice(0, at)); buffer = buffer.slice(at + 1) }
      if (done) { if (buffer.trim()) await line(buffer); await dispatch(); break }
    }
  } catch (e) { await reader.cancel().catch(() => {}); throw e instanceof ProviderError ? e : new ProviderError('network_unknown') }
  finally { reader.releaseLock() }
}
export interface ProviderJob { status: string; errorCode?: string; state?: RewriteProviderState }
export const upstreamFilename = (id: string) => `bxsh-${id}.docx`
export async function submitRewrite(id: string, name: string, platform: string, language: string, bytes: Buffer,
  options?: RewriteOptions, progress?: (state: RewriteProviderState) => Promise<void>): Promise<ProviderJob> {
  if (!options || options.service === 'AI预测') throw new ProviderError('legacy_disabled', true)
  try { await assertRewriteReady() } catch (e) {
    // Only a membership GET has run. No rewrite request can have been sent yet.
    if (e instanceof ProviderError && e.code === 'network_unknown') throw new ProviderError('busy_not_started', true)
    throw e
  }
  const service = options.service === '双降' ? '降重+降AI' : options.service
  let response: Response
  if (options.inputKind === 'text') {
    response = await authFetch('/api/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(1_200_000),
      body: JSON.stringify({ text: bytes.toString('utf8'), preset: options.preset, service_type: service, platform: options.platform, whitelist: options.whitelist }) })
  } else {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(bytes)], upstreamFilename(id), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    form.set('preset_zh', options.presetZh ?? (language === 'CN' ? options.preset : ''))
    form.set('preset_en', options.presetEn ?? (language === 'EN' ? options.preset : ''))
    form.set('language_threshold', '0.5'); form.set('language', languageName(language))
    form.set('platform', PLATFORM_IDS[options.platform] ?? options.platform.toLowerCase().replace(/\s+/g, '_')); form.set('mode', options.preset); form.set('service_type', service)
    form.set('generate_diff', 'true'); if (options.whitelist) form.set('whitelist', options.whitelist)
    response = await authFetch('/api/document/rewrite/stream', { method: 'POST', body: form, signal: AbortSignal.timeout(1_200_000) })
  }
  const state: RewriteProviderState = {}, paragraphs = new Map<number, string>()
  let ended = false, separator = '\n\n', lastUpdate = 0
  await readRewriteStream(response, async (d) => {
    if (d.percentage !== undefined && Number.isFinite(Number(d.percentage))) state.progress = Math.max(0, Math.min(99, Number(d.percentage)))
    if (d.record_id !== undefined) state.recordId = String(d.record_id)
    if (typeof d.diff_url === 'string') state.diffUrl = d.diff_url
    const url = d.result_url || d.rewritten_url || d.download_url || d.file_url
    if (typeof url === 'string') state.resultUrl = url
    if (d.statistics) state.stats = d.statistics
    if (d.type === 'paragraph' || (typeof d.index === 'number' && (d.content || d.rewritten))) {
      const text = d.content || d.rewritten
      if (typeof text === 'string') paragraphs.set(Number(d.index ?? paragraphs.size), text)
      separator = typeof d.separator === 'string' ? d.separator : separator
    }
    if (typeof d.paraphrased_paragraph === 'string') { state.text = d.paraphrased_paragraph; ended = true }
    if (d.type === 'end' || d.type === 'complete' || d.success === true) ended = true
    if (progress && (Date.now() - lastUpdate > 1500 || state.resultUrl || ended)) {
      await progress({ ...state }); lastUpdate = Date.now()
    }
  })
  if (options.inputKind === 'text') {
    if (!state.text && paragraphs.size && ended) {
      const indices = [...paragraphs.keys()].sort((a, b) => a - b)
      if (indices.some((v, i) => v !== i)) throw new ProviderError('response_invalid')
      state.text = indices.map((i) => paragraphs.get(i)).join(separator)
    }
    if (!ended || !state.text?.trim()) throw new ProviderError('response_invalid')
  } else if (!state.resultUrl || !ended) throw new ProviderError('response_invalid')
  state.progress = 100
  await progress?.(state)
  return { status: 'completed', state }
}
export async function pollRewrite(id: string, state?: RewriteProviderState, options?: RewriteOptions): Promise<ProviderJob> {
  if (!options) return { status: 'failed', errorCode: 'legacy_disabled' }
  if (state?.resultUrl || state?.text || state?.detection) return { status: 'completed', state }
  if (options.service === 'AI预测') return { status: 'unknown', errorCode: 'manual_check' }
  if (options.inputKind === 'text') return { status: 'unknown', errorCode: 'manual_check' }
  for (let page = 1; page <= 5; page++) {
    const result = await jsonRequest(`/api/rewrite_history/list?page=${page}&page_size=50`)
    if (result.success !== true || !Array.isArray(result.data?.records)) throw new ProviderError('response_invalid')
    const records = result.data.records as Record<string, any>[]
    const match = records.find((r) => [r.filename, r.file_name, r.fileName].includes(upstreamFilename(id)))
    if (match) {
      const resultUrl = match.rewritten_url || match.rewrittenUrl || match.result_url
      if (typeof resultUrl === 'string' && resultUrl) return { status: 'completed', state: { ...state, resultUrl,
        recordId: String(match.id ?? match.document_id ?? ''), diffUrl: match.diff_url, progress: 100 } }
    }
    if (page >= Number(result.data.total_pages ?? 1) || records.length < 50) break
  }
  return { status: 'unknown', errorCode: 'job_not_found' }
}
export async function downloadRewrite(_id: string, state?: RewriteProviderState, variant: 'result' | 'diff' | 'report' | 'pdf' = 'result') {
  if (variant === 'result' && state?.resultFormat === 'json' && state.detection) return Buffer.from(JSON.stringify(state.detection, null, 2), 'utf8')
  if (variant === 'result' && state?.text) return Buffer.from(state.text, 'utf8')
  const value = variant === 'diff' ? state?.diffUrl : variant === 'report' ? state?.reportFiles?.html_detail_url : variant === 'pdf' ? state?.reportFiles?.pdf_summary_url : state?.resultUrl
  if (!value) throw new ProviderError('response_invalid')
  let u: URL
  try { u = new URL(value, ORIGIN) } catch { throw new ProviderError('response_invalid') }
  // 仅向原站发送登录凭据；其公开文件域名不携带凭据。
  const publicHosts = ['damoxin-haiyu.oss-cn-beijing.aliyuncs.com', 'ycjgzdywxzsboss.oss-cn-hangzhou.aliyuncs.com']
  if (u.protocol !== 'https:' || u.username || u.password || (u.origin !== ORIGIN && !publicHosts.includes(u.hostname))) throw new ProviderError('response_invalid')
  let r: Response
  try { r = u.origin === ORIGIN ? await authFetch(u.pathname + u.search) : await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(60_000) }) }
  catch (e) { throw e instanceof ProviderError ? e : new ProviderError('network_unknown') }
  if (!r.ok || !r.body) throw new ProviderError('response_invalid')
  const chunks: Uint8Array[] = []; let size = 0
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > MAX_REWRITE_RESULT) { await r.body.cancel().catch(() => {}); throw new ProviderError('response_invalid') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** 用 ZIP 中央目录确认 DOCX，而不是把 HTML 错误页当作 Word 交付。 */
export function wordExtension(raw: Buffer): '.docx' | '.doc' | null {
  if (raw.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) return '.doc'
  if (raw.length < 22 || raw.readUInt32LE(0) !== 0x04034b50) return null
  for (let end = raw.length - 22; end >= Math.max(0, raw.length - 65557); end--) {
    if (raw.readUInt32LE(end) !== 0x06054b50 || end + 22 + raw.readUInt16LE(end + 20) !== raw.length) continue
    const count = raw.readUInt16LE(end + 10), start = raw.readUInt32LE(end + 16), length = raw.readUInt32LE(end + 12)
    if (!count || count > 5000 || start + length !== end || raw.readUInt16LE(end + 4) || raw.readUInt16LE(end + 6)) return null
    let pos = start, expanded = 0
    const names = new Set<string>()
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || raw.readUInt32LE(pos) !== 0x02014b50) return null
      expanded += raw.readUInt32LE(pos + 24)
      const n = raw.readUInt16LE(pos + 28), extra = raw.readUInt16LE(pos + 30), comment = raw.readUInt16LE(pos + 32)
      if (pos + 46 + n + extra + comment > end || expanded > 100 * 1024 * 1024) return null
      names.add(raw.subarray(pos + 46, pos + 46 + n).toString())
      pos += 46 + n + extra + comment
    }
    return pos === end && names.has('[Content_Types].xml') && names.has('word/document.xml') ? '.docx' : null
  }
  return null
}
