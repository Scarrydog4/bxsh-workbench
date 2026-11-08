import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { GET as listGet } from '@/app/api/reimbursements/route'
import { GET as imageGet } from '@/app/api/reimbursements/[id]/images/[hash]/route'
import { GET as auditGet } from '@/app/api/audit/route'
import { buildBoot } from '@/server/bootstrap'
import { getCtx } from '@/server/session'
import type { Reimbursement } from '@/shared/reimbursement'
import { businessDate } from '@/shared/format'
import { as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client, order: string, hiddenOrder: string, writerId: string, salesId: string, shot: string, transfer: string
const day = businessDate(new Date()), priorDay = businessDate(new Date(Date.now() - 86_400_000))
const key = () => randomUUID()
const createInput = () => ({ requestId: key(), category: '图纸', amount: 100, expenseDate: day, note: '电气图纸费用', proofs: [shot], orderId: order })
const mutation = (record: Reimbursement) => ({ id: record.id, expectedVersion: record.version, requestId: key() })
const get = async (client: Client, query: Record<string, string> = {}) => {
  const response = await listGet(new Request(`http://test.local/api/reimbursements?${new URLSearchParams(query)}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({}) })
  return { status: response.status, body: await response.json() }
}
const record = async (client: Client, id: string): Promise<Reimbursement> => {
  const r = await get(client, { id }); expect(r.status).toBe(200); return r.body.rows[0]
}
const image = async (client: Client, url: string) => {
  const segments = new URL(url, 'http://test.local').pathname.split('/')
  return imageGet(new Request(`http://test.local${url}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({ id: segments[3], hash: segments[5] }) })
}
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng')
  shot = `data:image/png;base64,${(await sharp({ create: { width: 3, height: 3, channels: 3, background: 'red' } }).png().toBuffer()).toString('base64')}`
  transfer = `data:image/png;base64,${(await sharp({ create: { width: 3, height: 3, channels: 3, background: 'blue' } }).png().toBuffer()).toString('base64')}`
  const channelId = (await boss.act('channel.create', { name: '报销关联单验证', ownerId: 'u-acheng' })).body.id
  order = (await boss.act('order.create', { title: '报销搜索电气项目', orderDate: day, dueDate: null, channelId, ownerId: 'u-acheng', basePrice: 600, assignees: [{ userId: 'u-xiao', pay: 300 }] })).body.id
  hiddenOrder = (await boss.act('order.create', { title: '其他销售的订单', orderDate: day, dueDate: null, channelId, ownerId: 'u-yang', basePrice: 700, assignees: [] })).body.id
  expect((await boss.act('order.setWriters', { id: hiddenOrder, writers: [] })).status).toBe(200)
})
afterAll(closeDb)

it('员工提交自己报销；重复请求只保存一次且内容变更拒绝', async () => {
  const input = createInput()
  const responses = await Promise.all([writer.act('reimburse.submit', input), writer.act('reimburse.submit', input)])
  expect(responses.map(r => r.status)).toEqual([200, 200]); expect(responses[0].body.id).toBe(responses[1].body.id)
  writerId = responses[0].body.id
  expect((await writer.act('reimburse.submit', { ...input, amount: 200 })).status).toBe(400)
  const created = await record(writer, writerId)
  expect(created).toMatchObject({ applicantId: 'u-xiao', status: '待处理', amount: 100, version: 1, expenseDate: day, orderId: order })
  expect(created.no).toMatch(/^BX\d+$/); expect(created.history).toHaveLength(1); expect(created.proofs[0]).toMatch(/^\/api\/reimbursements\//)
  expect(created).not.toHaveProperty('requests')
  const salesResult = await sales.act('reimburse.submit', { ...createInput(), category: '投流', amount: 200, note: '', orderId: null })
  expect(salesResult.status).toBe(200); salesId = salesResult.body.id
})

it('金额、实际日期、至少一张账单和关联订单可见性必须符合要求', async () => {
  for (const patch of [{ proofs: [] }, { amount: 0 }, { amount: -1 }, { amount: 1.001 }, { expenseDate: '2026-02-30' }, { expenseDate: businessDate(new Date(Date.now() + 86_400_000)) }]) {
    expect((await writer.act('reimburse.submit', { ...createInput(), ...patch })).status).toBe(400)
  }
  expect((await writer.act('reimburse.submit', { ...createInput(), orderId: hiddenOrder })).status).toBe(404)
  expect((await sales.act('reimburse.submit', { ...createInput(), orderId: hiddenOrder })).status).toBe(404)
  const otherProof = (await record(writer, writerId)).proofs[0]
  expect((await sales.act('reimburse.submit', { ...createInput(), proofs: [otherProof] })).status).toBe(400)
})

it('列表、指定单和图片均只对本人或老板开放，并支持搜索与分页', async () => {
  expect((await get(writer)).body.total).toBe(1); expect((await get(sales)).body.total).toBe(1)
  expect((await get(writer, { id: salesId })).status).toBe(404)
  expect((await get(writer, { applicant: 'u-acheng' })).status).toBe(403)
  const all = await get(boss, { limit: '1' })
  expect(all.body).toMatchObject({ total: 2, next: 1, summary: { pendingCount: 2, pendingAmount: 300, paidCount: 0, paidAmount: 0 } })
  expect((await get(boss, { applicant: 'u-xiao', q: '电气项目' })).body.rows.map((r: Reimbursement) => r.id)).toEqual([writerId])
  expect((await get(boss, { q: '投流' })).body.rows.map((r: Reimbursement) => r.id)).toEqual([salesId])
  const receipt = (await record(writer, writerId)).proofs[0]
  expect((await image(writer, receipt)).status).toBe(200)
  expect((await image(boss, receipt + '?thumb=1')).headers.get('content-type')).toBe('image/webp')
  expect((await image(sales, receipt)).status).toBe(404)
})

it('待处理只能本人撤回后修改，原始快照保留，旧版本不能审批重提的新金额', async () => {
  const original = await record(writer, writerId)
  expect((await writer.act('reimburse.submit', { ...createInput(), id: writerId, expectedVersion: original.version, amount: 130 })).status).toBe(400)
  expect((await boss.act('reimburse.withdraw', mutation(original))).status).toBe(403)
  expect((await sales.act('reimburse.withdraw', mutation(original))).status).toBe(404)
  expect((await writer.act('reimburse.withdraw', mutation(original))).status).toBe(200)
  const withdrawn = await record(writer, writerId)
  expect(withdrawn.status).toBe('已撤回')
  expect((await writer.act('reimburse.submit', { ...createInput(), ...mutation(withdrawn), amount: 130, proofs: original.proofs })).status).toBe(200)
  const submitted = await record(writer, writerId)
  expect(submitted).toMatchObject({ version: 3, status: '待处理', amount: 130 })
  expect(submitted.history.filter(e => e.submission).map(e => e.submission!.amount)).toEqual([100, 130])
  expect((await boss.act('reimburse.confirm', mutation(original))).status).toBe(409)
})

let confirmPayload: ReturnType<typeof mutation> & { paidDate: string; note: string; proofs: string[] }
it('仅老板确认报销，付款日期、备注与转账截图同笔保存，重试不重复', async () => {
  const current = await record(writer, writerId)
  expect((await writer.act('reimburse.confirm', mutation(current))).status).toBe(403)
  expect((await boss.act('reimburse.confirm', { ...mutation(current), paidDate: businessDate(new Date(Date.now() + 86_400_000)) })).status).toBe(400)
  confirmPayload = { ...mutation(current), paidDate: priorDay, note: '已转账报销', proofs: [transfer] }
  const results = await Promise.all([boss.act('reimburse.confirm', confirmPayload), boss.act('reimburse.confirm', confirmPayload)])
  expect(results.map(r => r.status)).toEqual([200, 200])
  expect((await boss.act('reimburse.confirm', { ...confirmPayload, note: '改内容' })).status).toBe(400)
  const paid = await record(writer, writerId)
  expect(paid).toMatchObject({ status: '已报销', version: 4, paidDate: priorDay, paidBy: 'u-boss', paymentNote: '已转账报销' })
  expect(paid.history).toHaveLength(4); expect(paid.paymentProofs).toHaveLength(1)
  expect((await image(writer, paid.paymentProofs[0])).status).toBe(200)
  expect((await get(boss)).body.summary).toMatchObject({ pendingAmount: 200, paidAmount: 130 })
})

it('撤销误报销必留原因并保留旧付款截图；重新确认仅计一次当前报销', async () => {
  const paid = await record(writer, writerId), receipt = paid.paymentProofs[0]
  expect((await boss.act('reimburse.undo', { ...mutation(paid), reason: '' })).status).toBe(400)
  expect((await writer.act('reimburse.undo', { ...mutation(paid), reason: '自行撤销' })).status).toBe(403)
  expect((await boss.act('reimburse.undo', { ...mutation(paid), reason: '转账记错，先撤销' })).status).toBe(200)
  const undone = await record(writer, writerId)
  expect(undone).toMatchObject({ status: '待处理', paidDate: null, paidAt: null, paidBy: null, paymentProofs: [], version: 5 })
  expect(undone.history.find(e => e.action === '报销')).toMatchObject({ paidDate: priorDay, proofs: [receipt] })
  expect((await image(writer, receipt)).status).toBe(200)
  expect((await get(boss)).body.summary).toMatchObject({ pendingAmount: 330, paidAmount: 0 })
  expect((await boss.act('reimburse.confirm', confirmPayload)).status).toBe(200)
  expect((await record(writer, writerId)).status).toBe('待处理')
  expect((await boss.act('reimburse.confirm', { ...mutation(undone), note: '确认实际已转' })).status).toBe(200)
  expect((await get(boss)).body.summary).toMatchObject({ pendingAmount: 200, paidAmount: 130 })
})

it('退回必原因、可编辑重提，老板与员工并发操作只会成功一次', async () => {
  const pending = await record(sales, salesId)
  expect((await boss.act('reimburse.reject', { ...mutation(pending), reason: '' })).status).toBe(400)
  expect((await boss.act('reimburse.reject', { ...mutation(pending), reason: '补清晰账单' })).status).toBe(200)
  const rejected = await record(sales, salesId)
  expect(rejected).toMatchObject({ status: '已退回', reason: '补清晰账单' })
  expect((await sales.act('reimburse.submit', { ...createInput(), ...mutation(rejected), category: '投流', amount: 180, orderId: null, proofs: [transfer] })).status).toBe(200)
  const resubmitted = await record(sales, salesId)
  const results = await Promise.all([sales.act('reimburse.withdraw', mutation(resubmitted)), boss.act('reimburse.confirm', mutation(resubmitted))])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  expect((await record(sales, salesId)).history).toHaveLength(4)
})

it('报销通知与审计留痕，订单收入和工资结算不受影响', async () => {
  const b = (await boss.boot()).body, w = (await writer.boot()).body
  expect(b.notifications.some((n: { kind: string; tab: string }) => n.kind === '报销' && n.tab === `reimburse:${writerId}`)).toBe(true)
  expect(w.notifications.some((n: { kind: string; tab: string }) => n.kind === '报销' && n.tab === `reimburse:${writerId}`)).toBe(true)
  expect(b.audit.some((a: { action: string; objectType: string }) => a.action === '确认报销' && a.objectType === 'reimbursement')).toBe(true)
  expect(b.batches).toHaveLength(0)
  const o = b.orders.find((o: { id: string }) => o.id === order)
  expect(o).toMatchObject({ sales: 600, received: 0, unpaid: 600, writerTotal: 300, commission: 150, bossIncome: 150 })
})

it('有审计权限的非管理员在审计接口和完整快照中仍只能看到自己的报销', async () => {
  const role = await boss.act('role.save', {
    name: '普通审计查看员', perms: ['audit.view'], rowScope: 'all',
    fields: { sales: false, writerPay: 'none', commission: 'none', profit: false, channelNo: false },
  })
  expect(role.status).toBe(200)
  for (const id of ['u-xiao', 'u-acheng', 'u-yang']) expect((await boss.act('user.update', { id, patch: { roleId: role.body.id } })).status).toBe(200)
  writer = await as('xiaosenkai'); sales = await as('acheng')
  const outsider = await as('xiaoyang')
  for (const [client, allowed] of [[writer, [writerId]], [sales, [salesId]], [outsider, []], [boss, [writerId, salesId]]] as const) {
    const request = new Request('http://test.local/api/audit?views=1', { headers: { cookie: client.cookie } })
    const response = await auditGet(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const rows = (await response.json()).rows
    const ctx = await getCtx(request)
    expect(ctx).not.toBeNull()
    const snapshot = await buildBoot(ctx!)
    for (const entries of [rows, snapshot.audit]) {
      const reportIds = [...new Set(entries.filter((a: { objectType: string }) => a.objectType === 'reimbursement').map((a: { objectId: string }) => a.objectId))]
      expect(reportIds.sort()).toEqual([...allowed].sort())
      expect(entries.some((a: { objectType: string }) => a.objectType !== 'reimbursement')).toBe(true)
    }
    const byBoss = await auditGet(new Request('http://test.local/api/audit?actor=u-boss&action=确认报销', { headers: { cookie: client.cookie } }), { params: Promise.resolve({}) })
    const filtered = (await byBoss.json()).rows
    expect(filtered.every((a: { objectId: string }) => (allowed as readonly string[]).includes(a.objectId))).toBe(true)
  }
})
