import { and, eq, gte } from 'drizzle-orm'
import { db } from '../db'
import { audit } from '../schema'
import { HttpError } from '../http'
import type { Ctx } from '../session'
import type { Usage } from '@/shared/assistant'
import { businessDate } from '@/shared/format'

// 密钥只读服务端环境；固定官方地址，避免意外把业务内容发往其他服务。
const endpoint = 'https://api.deepseek.com'
export const MODEL = 'deepseek-flash'
export const configured = () => !!process.env.DEEPSEEK_API_KEY
const busy = new Set<string>()
export async function exclusive<T>(userId: string, fn: () => Promise<T>) {
  if (busy.has(userId)) throw new HttpError(429, '上一条还在处理，请稍等')
  busy.add(userId)
  try { return await fn() } finally { busy.delete(userId) }
}
async function api(path: string, body?: unknown) {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new HttpError(503, '智能助手还未配置，请联系管理员')
  let r: Response
  try {
    r = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) })
  } catch { throw new HttpError(504, '识别服务暂时没有响应，请稍后重试；当前内容已保留') }
  if (!r.ok) throw new HttpError(r.status === 402 ? 402 : 502, r.status === 402 ? '智能助手余额不足，请联系管理员充值' : '识别服务暂时不可用，请稍后重试')
  try { return await r.json() } catch { throw new HttpError(502, '识别服务返回异常，请稍后重试') }
}
export async function checkBalance() {
  const b = await api('/user/balance')
  if (b.is_available !== true || !b.balance_infos?.some((x: { total_balance: string }) => Number(x.total_balance) > 0)) throw new HttpError(402, '智能助手余额不足，请联系管理员充值')
}

// DeepSeek 官方人民币价（2026-10-07）：峰时输入未命中 2/命中 .04/输出 8 元每百万；闲时减半。
// 这里只做估算，不伪装成供应商账单；每次记录当时费率，后续改价不会重算历史。
export function estimateCost(u: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number }, at = new Date()) {
  const beijing = new Date(at.getTime() + 8 * 3600_000)
  const day = beijing.getUTCDay(), hour = beijing.getUTCHours()
  const peak = day > 0 && day < 6 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
  const multiplier = peak ? 1 : 0.5
  const inputTokens = Math.max(0, u.prompt_tokens ?? 0), outputTokens = Math.max(0, u.completion_tokens ?? 0)
  const cached = Math.min(inputTokens, Math.max(0, u.prompt_cache_hit_tokens ?? 0))
  return { inputTokens, outputTokens, cachedTokens: cached, estimatedCny: ((inputTokens - cached) * 2 + cached * .04 + outputTokens * 8) * multiplier / 1_000_000, peak, priceVersion: '2026-10-07' }
}
export type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: unknown; tool_calls?: ToolCall[]; tool_call_id?: string }
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
export type Completion = { choices: { finish_reason: string; message: Message & { content: string | null } }[]; usage: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number } }
export async function complete(c: Ctx, purpose: '识别录单' | '问数据' | '整理售后', messages: Message[], options: Record<string, unknown> = {}): Promise<Completion> {
  const at = new Date()
  try {
    const result = await api('/chat/completions', { model: MODEL, messages, thinking: { type: 'disabled' }, max_tokens: 5000, temperature: 0, ...options }) as Completion
    await db.insert(audit).values({ actorId: c.me.id, action: 'AI 调用', objectType: 'assistant', objectLabel: purpose, to: JSON.stringify({ model: MODEL, ...estimateCost(result.usage ?? {}, at), status: 'success' }), ip: c.ip })
    if (!result.choices?.[0]?.message || result.choices[0].finish_reason === 'length') throw new HttpError(502, '本次内容过长，尚未生成完整结果，请减少内容后重试')
    return result
  } catch (e) {
    await db.insert(audit).values({ actorId: c.me.id, action: 'AI 失败', objectType: 'assistant', objectLabel: purpose, to: JSON.stringify({ model: MODEL, status: 'failed' }), ip: c.ip })
    throw e
  }
}
export async function monthUsage(): Promise<Usage> {
  const start = businessDate(new Date()).slice(0, 7) + '-01T00:00:00+08:00'
  const rows = await db.select({ to: audit.to }).from(audit).where(and(eq(audit.action, 'AI 调用'), eq(audit.objectType, 'assistant'), gte(audit.at, start)))
  return rows.reduce<Usage>((a, r) => {
    try { const u = JSON.parse(r.to ?? '{}'); a.calls++; a.inputTokens += u.inputTokens ?? 0; a.outputTokens += u.outputTokens ?? 0; a.estimatedCny += u.estimatedCny ?? 0 } catch { /* 旧日志缺少用量时不编造 */ }
    return a
  }, { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCny: 0 })
}
