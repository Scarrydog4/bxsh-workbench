'use client'

import { act, refresh, uploadFiles } from './store'
import type { Candidate } from '@/shared/settle'
import type { CustomerStage } from '@/shared/calc'
import type { CardFieldType, Comment, NodeStatus } from '@/shared/types'
import type { ActionOptions } from './operation-feedback'

/** P2 的接口调用：结算、待收、评论、节点、需求卡片、设置、分享、提醒。改完立刻重新拉数据。 */

async function change<T = { ok: true }>(name: string, payload: unknown, fresh = false): Promise<T | null> {
  const r = await act<T>(name, payload)
  if (r) await refresh(fresh)
  return r
}
const ok = (r: unknown) => r !== null

// 结算
export type Kind = '写手工资' | '销售提成'
export type OrderSettlementInput = { requestId: string; orderId: string; payeeId: string; amount: number; date?: string; note?: string; shots?: string[] }
export const payOrder = (input: OrderSettlementInput & { kind: Kind }) => change<{ id: string; amount: number }>('settle.pay', input, true)
export const payOrderSettlement = payOrder
export async function payOrderWithOutcome(input: OrderSettlementInput & { kind: Kind }, feedback?: Pick<ActionOptions, 'onConfirmed'>): Promise<{ status: 'success'; result: { id: string; amount: number } } | { status: 'rejected' | 'unknown' }> {
  let rejected = false
  const result = await act<{ id: string; amount: number }>('settle.pay', input, { onRejected: () => { rejected = true } })
  if (!result) return { status: rejected ? 'rejected' : 'unknown' }
  if (typeof result.id !== 'string' || !result.id || !Number.isFinite(result.amount)) return { status: 'unknown' }
  try { await feedback?.onConfirmed?.() } catch { /* confirmed writes still refresh */ }
  await refresh(true)
  return { status: 'success', result }
}
export type OrderSettlementSummary = { amount: number | null; paid: number; unpaid: number; available: number; due: number | null; left: number; over: number; suggest?: number; custStage?: CustomerStage }
export async function getOrderSettlement(input: { orderId: string; kind: Kind; payeeId: string }): Promise<OrderSettlementSummary | null> {
  try {
    const q = new URLSearchParams({ order: input.orderId, kind: input.kind, payee: input.payeeId })
    const response = await fetch(`/api/settle/order?${q}`, { cache: 'no-store' })
    return response.ok ? await response.json() : null
  } catch { return null }
}
export const payWriterOrder = (input: OrderSettlementInput) => payOrder({ ...input, kind: '写手工资' })
export const paySalesOrder = (input: OrderSettlementInput) => payOrder({ ...input, kind: '销售提成' })
export type IncomeBatchInput = { requestId: string; kind: Kind; payeeId: string; lines: { orderId: string; amount: number }[]; date: string; note: string; shots: string[] }
export async function payIncomeBatchWithOutcome(input: IncomeBatchInput, feedback?: Pick<ActionOptions, 'onConfirmed'>): Promise<{ status: 'success'; result: { id: string; amount: number; count: number } } | { status: 'rejected' | 'unknown' }> {
  let rejected = false
  const result = await act<{ id: string; amount: number; count: number }>('settle.payBatch', input, { onRejected: () => { rejected = true } })
  if (!result) return { status: rejected ? 'rejected' : 'unknown' }
  if (typeof result.id !== 'string' || !result.id.trim() || !Number.isFinite(result.amount) || !Number.isInteger(result.count) || result.count < 1) return { status: 'unknown' }
  try { await feedback?.onConfirmed?.() } catch { /* confirmed writes still refresh */ }
  await refresh(true)
  return { status: 'success', result }
}
export const saveBatch = (input: { id?: string; kind: Kind; payeeId: string; note: string; shots?: string[]; lines: { orderId: string; amount: number; note?: string }[] }) => change<{ id: string }>('settle.save', input)
export const updateBatchNote = async (id: string, note: string, shots: string[]) => ok(await change('settle.note', { id, note, shots }))
export const supplementSettlementDate = async (id: string, date: string, reason: string) => ok(await change('settle.date', { id, date, reason }, true))
export const confirmBatch = async (id: string) => ok(await change('settle.confirm', { id }))
export const voidBatch = async (id: string, reason: string) => ok(await change('settle.void', { id, reason }))
export async function fetchCandidates(kind: Kind, payee: string, opts: { period?: string; except?: string } = {}): Promise<Candidate[]> {
  const q = new URLSearchParams({ kind, payee, ...(opts.period ? { period: opts.period } : {}), ...(opts.except ? { except: opts.except } : {}) })
  const r = await fetch(`/api/settle/candidates?${q}`)
  if (!r.ok) throw new Error((await r.json()).error || '结算金额加载失败')
  return r.json()
}

// 待收
export const addReceivable = async (orderId: string, r: { amount: number; dueDate: string; tag: string; note: string }) => ok(await change('recv.create', { orderId, ...r }))
export const collectReceivable = async (orderId: string, id: string, date: string, memo?: { note: string; proof?: string }) => ok(await change('recv.collect', { orderId, id, date, ...memo }))
export const cancelReceivable = async (orderId: string, id: string) => ok(await change('recv.cancel', { orderId, id }))

// 评论（不在 bootstrap 里，单独拉）
export async function fetchComments(orderId: string): Promise<Comment[]> {
  const r = await fetch(`/api/orders/${orderId}/comments`, { cache: 'no-store' })
  return r.ok ? r.json() : []
}
export const addComment = (orderId: string, body: string, images: string[], mentions: string[]) => change<{ id: string; mentions: string[] }>('comment.create', { orderId, body, images, mentions })
export const deleteComment = async (orderId: string, id: string) => ok(await change('comment.delete', { orderId, id }))

// 进度节点
export interface NodeInput {
  id?: string
  name: string
  status: NodeStatus
  planDate: string | null
  doneDate?: string | null
  ownerId: string | null
  note: string
}
export const saveNode = (orderId: string, node: NodeInput) => change<{ id: string }>('node.save', { orderId, node })
export const deleteNode = async (orderId: string, id: string) => ok(await change('node.delete', { orderId, id }))
export const reorderNodes = async (orderId: string, ids: string[]) => ok(await change('node.reorder', { orderId, ids }))
export const applyTemplate = (orderId: string, templateId: string) => change<{ count: number }>('node.applyTemplate', { orderId, templateId })
export const addNodeFiles = (orderId: string, nodeId: string, files: File[]) => uploadFiles(files, { orderId, nodeId } as { orderId: string })

// 需求卡片
export const updateCard = async (orderId: string, values: Record<string, unknown>) => ok(await change('card.update', { orderId, values }))

// 系统设置
export type OptionKey = 'statuses' | 'types' | 'payTags' | 'nodeTags'
export const saveOptions = async (key: OptionKey, values: string[]) => ok(await change('options.save', { key, values }))
export const saveTemplate = (t: { id?: string; name: string; nodes: { name: string; days: number | null }[] }) => change<{ id: string }>('template.save', t)
export const deleteTemplate = async (id: string) => ok(await change('template.delete', { id }))
export const saveCardField = (f: { id?: string; label: string; type: CardFieldType; choices: string[] }) => change<{ id: string }>('cardField.save', f)
export const archiveCardField = async (id: string, archived: boolean) => ok(await change('cardField.archive', { id, archived }))
export const reorderSettings = async (what: 'templates' | 'cardFields', ids: string[]) => ok(await change('settings.reorder', { what, ids }))
export const saveNavOrder = async (pages: string[]) => ok(await change('settings.navOrder', { pages }))

// 对账单分享链接
export const createShare = (channelId: string, month: string, days: number | null) => change<{ id: string; token: string }>('share.create', { channelId, month, days })
export const revokeShare = async (id: string) => ok(await change('share.revoke', { id }))

// 提醒
export async function markRead(ids?: string[]) {
  await act('notes.markRead', ids ? { ids } : {}, { silent: true })
  await refresh()
}
