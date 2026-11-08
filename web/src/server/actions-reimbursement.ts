import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { REIMBURSEMENT_CATEGORIES, type ReimbursementEvent, type ReimbursementSubmission } from '@/shared/reimbursement'
import { businessDate, money } from '@/shared/format'
import { act, dataImage, isoDate, log, orderFor } from './actions'
import type { Tx } from './db'
import { bad, deny, HttpError, notFound } from './http'
import { saveReimbursementImages } from './images'
import { notify } from './notify'
import { canViewReimbursement, reimbursementProofs, type ReimbursementRow } from './reimbursement'
import type { Ctx } from './session'
import * as t from './schema'

const expenseDate = isoDate.refine(value => {
  const d = new Date(`${value}T12:00:00+08:00`)
  return Number.isFinite(d.getTime()) && businessDate(d) === value
}, '日期不存在').refine(value => value <= businessDate(new Date()), '日期不能晚于今天')
const proof = z.union([dataImage, z.string().max(250).startsWith('/api/reimbursements/')])
const identity = { id: z.string().min(1), requestId: z.string().uuid(), expectedVersion: z.number().int().positive() }
const textNote = z.string().trim().max(2000)
const reasonSchema = z.object({ ...identity, reason: textNote.min(1, '请填写原因') })

async function find(tx: Tx, c: Ctx, id: string) {
  const [row] = await tx.select().from(t.reimbursements).where(eq(t.reimbursements.id, id))
  if (!row || !canViewReimbursement(row, c)) throw notFound()
  return row
}
function admin(c: Ctx) {
  if (!c.role.locked) throw deny('只有管理员可以处理报销')
}
function stamp(c: Ctx, action: string, input: unknown) {
  return { action, actor: c.me.id, hash: createHash('sha256').update(JSON.stringify(input)).digest('hex') }
}
function replay(row: ReimbursementRow, requestId: string, request: ReturnType<typeof stamp>) {
  const old = row.requests[requestId]
  if (!old) return false
  if (old.action !== request.action || old.actor !== request.actor || old.hash !== request.hash) throw bad('这次请求的内容已变化，请重新提交')
  return true
}
function checkVersion(row: ReimbursementRow, expectedVersion: number | undefined) {
  if (row.version !== expectedVersion) throw new HttpError(409, '这张报销单已更新，请刷新后重新查看')
}
async function update(tx: Tx, row: ReimbursementRow, request: ReturnType<typeof stamp>, event: ReimbursementEvent, patch: Partial<typeof t.reimbursements.$inferInsert>) {
  await tx.update(t.reimbursements).set({
    ...patch, status: event.to, updatedAt: event.at, version: row.version + 1,
    history: [...row.history, event], requests: { ...row.requests, [event.id]: request },
  }).where(eq(t.reimbursements.id, row.id))
}
async function number(tx: Tx) {
  const [counter] = await tx.insert(t.counters).values({ name: 'reimbursement_serial', value: 1 })
    .onConflictDoUpdate({ target: t.counters.name, set: { value: sql`${t.counters.value} + 1` } }).returning()
  return `BX${businessDate(new Date()).slice(2, 7).replace('-', '')}${String(counter.value).padStart(3, '0')}`
}

export const REIMBURSEMENT_ACTIONS = {
  'reimburse.submit': act({
    schema: z.object({
      requestId: identity.requestId, id: identity.id.optional(), expectedVersion: identity.expectedVersion.optional(), category: z.enum(REIMBURSEMENT_CATEGORIES),
      amount: z.number().positive('金额要大于0').max(1_000_000).multipleOf(0.01, '金额最多两位小数'),
      expenseDate, note: textNote.default(''),
      proofs: z.array(proof).min(1, '请附至少一张付款账单').max(9),
      orderId: z.string().min(1).nullable().default(null),
    }),
    run: async (tx, c, w, i) => {
      const id = i.id ?? `rb_${i.requestId}`
      const [old] = await tx.select().from(t.reimbursements).where(eq(t.reimbursements.id, id))
      if (old && old.applicantId !== c.me.id) throw notFound()
      if (i.id && !old) throw notFound()
      const request = stamp(c, 'submit', i)
      if (old && replay(old, i.requestId, request)) return { id }
      if (old) checkVersion(old, i.expectedVersion)
      if (old && old.status !== '已退回' && old.status !== '已撤回') throw bad('请先撤回申请，再修改重提')
      if (i.orderId) orderFor(w, c, i.orderId, 'order.view')
      const proofs = await saveReimbursementImages(i.proofs, id, old ? reimbursementProofs(old) : [])
      const submission: ReimbursementSubmission = { category: i.category, amount: i.amount, expenseDate: i.expenseDate, note: i.note, proofs, orderId: i.orderId }
      const now = new Date().toISOString()
      const event: ReimbursementEvent = { id: i.requestId, action: '提交', by: c.me.id, at: now, from: old?.status ?? null, to: '待处理', note: i.note, proofs: [], submission }
      const no = old?.no ?? await number(tx)
      if (old) await update(tx, old, request, event, { ...submission, reason: '' })
      else await tx.insert(t.reimbursements).values({ id, no, applicantId: c.me.id, ...submission, createdAt: now, updatedAt: now, history: [event], requests: { [i.requestId]: request } })
      await log(tx, c, { action: old ? '重新提交报销' : '申请报销', objectType: 'reimbursement', objectId: id, objectLabel: no, to: `${i.category} ${money(i.amount)}`, note: i.note, proof: proofs[0] })
      const bosses = w.users.filter(u => u.active && w.roles.some(r => r.id === u.roleId && r.locked)).map(u => u.id)
      await notify(tx, bosses, { kind: '报销', tab: `reimburse:${id}`, title: `${c.me.name}申请报销 ${money(i.amount)}`, body: `${i.category} · ${i.note.slice(0, 120)}`, actorId: c.me.id })
      return { id }
    },
  }),
  'reimburse.withdraw': act({
    schema: z.object(identity),
    run: async (tx, c, _w, i) => {
      const row = await find(tx, c, i.id)
      if (row.applicantId !== c.me.id) throw deny('只能撤回自己的申请')
      const request = stamp(c, 'withdraw', i)
      if (replay(row, i.requestId, request)) return { id: row.id }
      checkVersion(row, i.expectedVersion)
      if (row.status !== '待处理') throw bad('只有待处理的申请可以撤回')
      const event: ReimbursementEvent = { id: i.requestId, action: '撤回', by: c.me.id, at: new Date().toISOString(), from: row.status, to: '已撤回', note: '', proofs: [] }
      await update(tx, row, request, event, {})
      await log(tx, c, { action: '撤回报销', objectType: 'reimbursement', objectId: row.id, objectLabel: row.no, from: row.status, to: event.to })
      return { id: row.id }
    },
  }),
  'reimburse.confirm': act({
    schema: z.object({ ...identity, paidDate: expenseDate.optional(), note: textNote.default(''), proofs: z.array(proof).max(9).default([]) }),
    run: async (tx, c, _w, i) => {
      admin(c)
      const row = await find(tx, c, i.id), request = stamp(c, 'confirm', i)
      if (replay(row, i.requestId, request)) return { id: row.id }
      checkVersion(row, i.expectedVersion)
      if (row.status !== '待处理') throw bad('只有待处理的申请可以确认报销')
      const paidDate = i.paidDate ?? businessDate(new Date()), now = new Date().toISOString()
      const proofs = await saveReimbursementImages(i.proofs, row.id, reimbursementProofs(row))
      const event: ReimbursementEvent = { id: i.requestId, action: '报销', by: c.me.id, at: now, from: row.status, to: '已报销', note: i.note, proofs, paidDate }
      await update(tx, row, request, event, { paidDate, paidAt: now, paidBy: c.me.id, paymentNote: i.note, paymentProofs: proofs, reason: '' })
      await log(tx, c, { action: '确认报销', objectType: 'reimbursement', objectId: row.id, objectLabel: row.no, from: row.status, to: `已报销 ${money(row.amount)} · ${paidDate}`, note: i.note, proof: proofs[0] })
      await notify(tx, [row.applicantId], { kind: '报销', tab: `reimburse:${row.id}`, title: `已报销 ${money(row.amount)}`, body: `${row.category} · ${paidDate}`, actorId: c.me.id })
      return { id: row.id }
    },
  }),
  'reimburse.reject': act({
    schema: reasonSchema,
    run: async (tx, c, _w, i) => {
      admin(c)
      const row = await find(tx, c, i.id), request = stamp(c, 'reject', i)
      if (replay(row, i.requestId, request)) return { id: row.id }
      checkVersion(row, i.expectedVersion)
      if (row.status !== '待处理') throw bad('只有待处理的申请可以退回')
      const event: ReimbursementEvent = { id: i.requestId, action: '退回', by: c.me.id, at: new Date().toISOString(), from: row.status, to: '已退回', note: i.reason, proofs: [] }
      await update(tx, row, request, event, { reason: i.reason })
      await log(tx, c, { action: '退回报销', objectType: 'reimbursement', objectId: row.id, objectLabel: row.no, from: row.status, to: event.to, note: i.reason })
      await notify(tx, [row.applicantId], { kind: '报销', tab: `reimburse:${row.id}`, title: '报销已退回', body: i.reason, actorId: c.me.id })
      return { id: row.id }
    },
  }),
  'reimburse.undo': act({
    schema: reasonSchema,
    run: async (tx, c, _w, i) => {
      admin(c)
      const row = await find(tx, c, i.id), request = stamp(c, 'undo', i)
      if (replay(row, i.requestId, request)) return { id: row.id }
      checkVersion(row, i.expectedVersion)
      if (row.status !== '已报销') throw bad('只有已报销的记录可以撤销报销')
      const event: ReimbursementEvent = { id: i.requestId, action: '撤销报销', by: c.me.id, at: new Date().toISOString(), from: row.status, to: '待处理', note: i.reason, proofs: [] }
      await update(tx, row, request, event, { paidDate: null, paidAt: null, paidBy: null, paymentNote: '', paymentProofs: [], reason: i.reason })
      await log(tx, c, { action: '撤销报销', objectType: 'reimbursement', objectId: row.id, objectLabel: row.no, from: row.status, to: event.to, note: i.reason })
      await notify(tx, [row.applicantId], { kind: '报销', tab: `reimburse:${row.id}`, title: '报销记录已撤销', body: i.reason, actorId: c.me.id })
      return { id: row.id }
    },
  }),
}
