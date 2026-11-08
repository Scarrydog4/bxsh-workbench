import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { FEEDBACK_KINDS, FEEDBACK_STATUSES } from '@/shared/feedback'
import { businessDate } from '@/shared/format'
import { act, dataImage, log } from './actions'
import type { Tx } from './db'
import { canViewFeedback, feedbackShots, type FeedbackRow } from './feedback'
import { bad, deny, notFound } from './http'
import { saveFeedbackImages } from './images'
import { notify } from './notify'
import type { World } from './repo'
import type { Ctx } from './session'
import { counters, feedback } from './schema'

const requestId = z.string().uuid()
const id = z.string().min(1).max(100)
const body = z.string().trim().max(5000)
const shots = z.array(z.union([dataImage, z.string().max(250).startsWith('/api/feedback/')])).max(9).default([])
const stamp = (c: Ctx, action: string, input: unknown) => ({ actor: c.me.id, action, hash: createHash('sha256').update(JSON.stringify(input)).digest('hex') })
function replay(row: FeedbackRow, key: string, request: ReturnType<typeof stamp>) {
  const old = row.requests[key]
  if (!old) return false
  if (old.actor !== request.actor || old.action !== request.action || old.hash !== request.hash) throw bad('这次请求的内容已变化，请重新提交')
  return true
}
async function find(tx: Tx, c: Ctx, key: string) {
  const [row] = await tx.select().from(feedback).where(eq(feedback.id, key))
  if (!row || !canViewFeedback(row, c)) throw notFound()
  return row
}
const bosses = (w: World) => w.users.filter(user => user.active && w.roles.some(role => role.id === user.roleId && role.locked)).map(user => user.id)
async function number(tx: Tx) {
  const [counter] = await tx.insert(counters).values({ name: 'feedback_serial', value: 1 }).onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } }).returning()
  return `FB${businessDate(new Date()).replaceAll('-', '')}${String(counter.value).padStart(3, '0')}`
}

export const FEEDBACK_ACTIONS = {
  'feedback.create': act({
    schema: z.object({ requestId, kind: z.enum(FEEDBACK_KINDS), title: z.string().trim().min(1, '请填写反馈标题').max(160), body: body.default(''), shots }),
    run: async (tx, c, w, input) => {
      const key = `fb_${input.requestId}`, request = stamp(c, 'create', input)
      const [old] = await tx.select().from(feedback).where(eq(feedback.id, key))
      if (old) {
        if (old.authorId !== c.me.id) throw notFound()
        if (replay(old, input.requestId, request)) return { id: key }
        throw bad('这条反馈已存在')
      }
      const images = await saveFeedbackImages(input.shots, key, [])
      const no = await number(tx), now = new Date().toISOString()
      await tx.insert(feedback).values({ id: key, no, authorId: c.me.id, kind: input.kind, title: input.title, body: input.body, shots: images, createdAt: now, updatedAt: now, requests: { [input.requestId]: request } })
      await log(tx, c, { action: '提交反馈', objectType: 'feedback', objectId: key, objectLabel: input.title, to: input.kind, note: input.body, proof: images[0] })
      await notify(tx, bosses(w), { kind: '反馈', tab: 'page:feedback', title: `${c.me.name}提交了${input.kind}：${input.title}`, actorId: c.me.id })
      return { id: key }
    },
  }),
  'feedback.reply': act({
    schema: z.object({ requestId, id, body: body.default(''), shots }).refine(input => !!input.body || input.shots.length > 0, '请填写回复或添加截图'),
    run: async (tx, c, w, input) => {
      const row = await find(tx, c, input.id), request = stamp(c, 'reply', input)
      if (replay(row, input.requestId, request)) return { id: row.id }
      const images = await saveFeedbackImages(input.shots, row.id, feedbackShots(row)), now = new Date().toISOString()
      const reply = { id: input.requestId, by: c.me.id, body: input.body, shots: images, at: now }
      await tx.update(feedback).set({ updatedAt: now, replies: [...row.replies, reply], requests: { ...row.requests, [input.requestId]: request } }).where(eq(feedback.id, row.id))
      await log(tx, c, { action: '回复反馈', objectType: 'feedback', objectId: row.id, objectLabel: row.title, note: input.body, proof: images[0] })
      await notify(tx, c.role.locked ? [row.authorId] : bosses(w), { kind: '反馈', tab: 'page:feedback', title: `${c.me.name}回复了反馈：${row.title}`, actorId: c.me.id })
      return { id: row.id }
    },
  }),
  'feedback.update': act({
    schema: z.object({ requestId, id, status: z.enum(FEEDBACK_STATUSES) }),
    run: async (tx, c, _w, input) => {
      if (!c.role.locked) throw deny('只有老板可以处理反馈状态')
      const row = await find(tx, c, input.id), request = stamp(c, 'update', input)
      if (replay(row, input.requestId, request)) return { id: row.id }
      await tx.update(feedback).set({ status: input.status, updatedAt: new Date().toISOString(), requests: { ...row.requests, [input.requestId]: request } }).where(eq(feedback.id, row.id))
      if (row.status !== input.status) {
        await log(tx, c, { action: '处理反馈', objectType: 'feedback', objectId: row.id, objectLabel: row.title, from: row.status, to: input.status })
        await notify(tx, [row.authorId], { kind: '反馈', tab: 'page:feedback', title: `反馈${input.status}：${row.title}`, actorId: c.me.id })
      }
      return { id: row.id }
    },
  }),
}
