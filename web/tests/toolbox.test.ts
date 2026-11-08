import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { POST as preparePost } from '@/app/api/toolbox/prepare/route'
import { POST as batchPost } from '@/app/api/toolbox/batches/route'
import { eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { as, resetDb, closeDb, type Client } from './helpers'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { POST, GET } from '@/app/api/toolbox/route'
import { GET as resultGet } from '@/app/api/toolbox/[id]/result/route'
import { GET as getPoints, POST as postPoints } from '@/app/api/points/route'
import { runRewriteWorkerOnce } from '@/server/toolbox'
import { submitRewrite, pollRewrite, downloadRewrite, listRewritePlatforms, ProviderError, wordExtension } from '@/server/rewrite-provider'

vi.mock('@/server/rewrite-provider', async (original) => ({
  ...await original<typeof import('@/server/rewrite-provider')>(),
  listRewritePlatforms: vi.fn(), submitRewrite: vi.fn(), pollRewrite: vi.fn(), downloadRewrite: vi.fn(),
}))

const DOCX = Buffer.from('UEsDBBQAAAAIAEMrR13GEnoHrAAAAPEAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2Puw7CMAxFf6XKihoXBgaUlIEdGPgBK3HbiOahJBT4exKQOjBax/dcWxxfdm4Wisl4J9mWd+zYi9s7UGoKcUmyKedwAEhqIouJ+0CukMFHi7mMcYSA6o4jwa7r9qC8y+Rym6uD9eJS5NFoaq4Y8xktSQZPHzVorx62bPJiY83pF6vNkmEIs1GYy02wOP3X2fphMIrWfLWF6BWlZNxoZ74Si8Ztqh56Ad+n+g9QSwMEFAAAAAgAQytHXe7RtZqtAAAAywAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt7Mpt0rJTy7NTc0rUQBK5xVbldsqZZSUFFjp6xcnZ6TmJhbr5Rek5gHl0vKLchNLgNyidP3y/KKUgqL85NTi4sy89NwcfSMDAzP93MTMPCWQkUn5KZUgugBEFIGIErtnW7tfrJ/6fMX+J7u3vd/T87St9em6nU/2z33W0/hkR+/T/hmPG5ps9EEqQWQRmCwAkxDT9BEutQMAUEsBAhQDFAAAAAgAQytHXcYSegesAAAA8QAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACABDK0dd7tG1mq0AAADLAAAAEQAAAAAAAAAAAAAAgAHdAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAAuQEAAAAA', 'base64')
const noParams = { params: Promise.resolve({}) }
let boss: Client, sales: Client, other: Client, writer: Client, orderId: string, attachmentId: string

beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); other = await as('xiaoyang'); writer = await as('xiaosenkai')
  const channel = (await boss.act('channel.create', { name: '测试工具渠道', ownerId: 'u-acheng' })).body.id
  orderId = (await boss.act('order.create', { title: '双降测试订单', ownerId: 'u-acheng', channelId: channel, orderDate: '2026-10-07', dueDate: null, basePrice: 1000, type: '', note: '', assignees: [{ userId: 'u-xiao', pay: 200 }] })).body.id
  attachmentId = (await writer.upload(orderId, '原稿.docx', DOCX)).body.id
})
beforeEach(async () => {
  await db.delete(t.rewriteBatches)
  await db.delete(t.rewriteJobs)
  await db.delete(t.pointEntries)
  await db.delete(t.pointAccounts)
  await db.insert(t.pointAccounts).values(['u-boss', 'u-acheng', 'u-yang', 'u-xiao'].map((userId) => ({ userId, balance: 25000 })))
  await db.insert(t.toolPrices).values({ id: 'rewrite', points: 100 }).onConflictDoUpdate({ target: t.toolPrices.id, set: { points: 100 } })
  vi.resetAllMocks()
  vi.mocked(listRewritePlatforms).mockResolvedValue([{ id: '1', name: '知网', languages: ['CN', 'EN'] }, { id: '21', name: 'Turnitin', languages: ['EN'] }])
  vi.mocked(submitRewrite).mockResolvedValue({ status: 'processing' })
  vi.mocked(pollRewrite).mockResolvedValue({ status: 'processing' })
  vi.mocked(downloadRewrite).mockResolvedValue(DOCX)
})
afterAll(closeDb)

async function submit(client: Client, opts: { platform?: string; language?: string; order?: boolean; attached?: boolean; bytes?: Buffer; name?: string; points?: number } = {}) {
  const form = new FormData()
  form.set('platform', opts.platform ?? '1'); form.set('language', opts.language ?? 'CN')
  form.set('expectedPoints', String(opts.points ?? 100))
  if (opts.order || opts.attached) form.set('orderId', orderId)
  if (opts.attached) form.set('attachmentId', attachmentId)
  else form.set('file', new File([new Uint8Array(opts.bytes ?? DOCX)], opts.name ?? '稿件.docx'))
  const r = await POST(new Request('http://test.local/api/toolbox', { method: 'POST', headers: { cookie: client.cookie }, body: form }), noParams)
  return { status: r.status, body: await r.json() }
}
async function listed(client: Client) {
  const r = await GET(new Request('http://test.local/api/toolbox', { headers: { cookie: client.cookie } }), noParams)
  return { status: r.status, body: await r.json() }
}
async function result(client: Client, id: string) {
  return resultGet(new Request(`http://test.local/api/toolbox/${id}/result`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({ id }) })
}
async function due(id: string) { await db.update(t.rewriteJobs).set({ nextPollAt: '2000-01-01T00:00:00Z', leaseUntil: null }).where(eq(t.rewriteJobs.id, id)) }
async function row(id: string) { return (await db.select().from(t.rewriteJobs).where(eq(t.rewriteJobs.id, id)))[0] }

it('检测平台必须明确选择，语言必须兼容，拒绝伪装的 Word', async () => {
  expect((await submit(writer, { platform: '' })).status).toBe(400)
  expect((await submit(writer, { platform: '21', language: 'CN' })).status).toBe(400)
  expect((await submit(writer, { bytes: Buffer.from('<html>登录页面</html>') })).status).toBe(400)
  expect((await submit(writer, { name: '稿件.doc' })).status).toBe(400)
  expect(wordExtension(DOCX)).toBe('.docx')
  expect(wordExtension(DOCX.subarray(0, 80))).toBeNull()
  expect(submitRewrite).not.toHaveBeenCalled()
})

it('10MB 上限在没有 content-length 的上传中也有效', async () => {
  const r = await submit(writer, { bytes: Buffer.alloc(10 * 1024 * 1024 + 100_000) })
  expect(r.status).toBe(400)
  expect(listRewritePlatforms).not.toHaveBeenCalled()
})

it('并发重复提交和刷新后再提交，都恢复同一个任务', async () => {
  const [a, b] = await Promise.all([submit(writer), submit(writer)])
  expect(a.status).toBe(200); expect(b.status).toBe(200)
  expect(a.body.id).toBe(b.body.id)
  expect((await submit(writer)).body).toEqual({ id: a.body.id, reused: true })
  expect((await db.select().from(t.rewriteJobs)).length).toBe(1)
  await runRewriteWorkerOnce()
  expect(submitRewrite).toHaveBeenCalledTimes(1)
})

it('附件入口验证订单范围，并独立保留原稿副本', async () => {
  expect((await submit(other, { attached: true })).status).toBe(404)
  const a = await submit(writer, { attached: true })
  expect(a.status).toBe(200)
  const j = await row(a.body.id)
  expect(j.sourceAttachmentId).toBe(attachmentId)
  expect(await readFile(j.sourcePath)).toEqual(DOCX)
})

it('提交超时后只查原任务，成功返回后保存一次并挂到原订单', async () => {
  const a = await submit(writer, { attached: true })
  vi.mocked(submitRewrite).mockRejectedValueOnce(new ProviderError('network_unknown'))
  await runRewriteWorkerOnce()
  expect((await row(a.body.id)).status).toBe('unknown')
  expect((await result(writer, a.body.id)).status).toBe(400)
  await due(a.body.id)
  vi.mocked(pollRewrite).mockResolvedValueOnce({ status: 'succeeded' })
  await runRewriteWorkerOnce()
  const j = await row(a.body.id)
  expect(j.status).toBe('completed')
  expect(submitRewrite).toHaveBeenCalledTimes(1)
  expect(pollRewrite).toHaveBeenCalledWith(a.body.id)
  expect(await readFile(j.sourcePath)).toEqual(DOCX)
  expect(await readFile(j.resultPath!)).toEqual(DOCX)
  expect((await writer.file(j.resultAttachmentId!)).buf).toEqual(DOCX)
  const download = await result(writer, a.body.id)
  expect(Buffer.from(await download.arrayBuffer())).toEqual(DOCX)
  expect((await result(other, a.body.id)).status).toBe(404)
  expect((await result(sales, a.body.id)).status).toBe(404)
  expect((await result(boss, a.body.id)).status).toBe(200)
  await runRewriteWorkerOnce()
  expect(downloadRewrite).toHaveBeenCalledTimes(1)
})

it('进程重启或旧租约过期，已提交任务不重复发送', async () => {
  const a = await submit(writer)
  await db.update(t.rewriteJobs).set({ status: 'submitting', submitStartedAt: new Date().toISOString(), leaseUntil: '2000-01-01T00:00:00Z' }).where(eq(t.rewriteJobs.id, a.body.id))
  await Promise.all([runRewriteWorkerOnce(), runRewriteWorkerOnce()])
  expect(submitRewrite).not.toHaveBeenCalled()
  expect(pollRewrite).toHaveBeenCalledTimes(1)
})

it('下载异常不冒充完成；恢复后仅保存返回稿，不再收费提交', async () => {
  const a = await submit(writer)
  vi.mocked(submitRewrite).mockResolvedValueOnce({ status: 'completed' })
  vi.mocked(downloadRewrite).mockResolvedValueOnce(Buffer.from('<html>错误页</html>'))
  await runRewriteWorkerOnce()
  expect((await row(a.body.id)).status).toBe('saving')
  expect((await result(writer, a.body.id)).status).toBe(400)
  await due(a.body.id); await runRewriteWorkerOnce()
  expect((await row(a.body.id)).status).toBe('completed')
  expect(submitRewrite).toHaveBeenCalledTimes(1)
})

it('写手、销售只能看本人记录，管理员能看全部；返回内容不暴露存储路径', async () => {
  await submit(writer); await submit(sales)
  const x = (await listed(writer)).body.jobs
  expect(x).toHaveLength(1)
  expect((await listed(other)).body.jobs).toHaveLength(0)
  expect((await listed(boss)).body.jobs).toHaveLength(2)
  expect(x[0]).not.toHaveProperty('sourcePath')
  expect(x[0]).not.toHaveProperty('fingerprint')
  const denied = await GET(new Request('http://test.local/api/toolbox'), noParams)
  expect(denied.status).toBe(401)
})

it('修改角色权限立刻禁止工具调用，转走订单后不再能查原任务', async () => {
  const a = await submit(sales, { order: true })
  await db.update(t.orders).set({ ownerId: 'u-yang' }).where(eq(t.orders.id, orderId))
  expect((await listed(sales)).body.jobs).toHaveLength(0)
  expect((await result(sales, a.body.id)).status).toBe(404)
  await db.update(t.orders).set({ ownerId: 'u-acheng' }).where(eq(t.orders.id, orderId))
  const [role] = await db.select().from(t.roles).where(eq(t.roles.id, 'r-sales'))
  await db.update(t.roles).set({ perms: role.perms.filter((p) => p !== 'toolbox.use') }).where(eq(t.roles.id, role.id))
  expect((await submit(sales)).status).toBe(403)
  expect((await listed(sales)).status).toBe(403)
  await db.update(t.roles).set({ perms: role.perms }).where(eq(t.roles.id, role.id))
})

it('服务明确未开始时显示失败，保留原编号，不后台重试扣费', async () => {
  const a = await submit(writer)
  vi.mocked(submitRewrite).mockRejectedValueOnce(new ProviderError('busy_not_started'))
  await runRewriteWorkerOnce(); await due(a.body.id); await runRewriteWorkerOnce()
  expect((await row(a.body.id)).status).toBe('failed')
  expect(submitRewrite).toHaveBeenCalledTimes(1)
  expect(pollRewrite).not.toHaveBeenCalled()
})

async function points(client: Client) {
  const r = await getPoints(new Request('http://test.local/api/points?userId=u-boss', { headers: { cookie: client.cookie } }), noParams)
  return { status: r.status, body: await r.json() }
}
async function pointAction(client: Client, body: object) {
  const r = await postPoints(new Request('http://test.local/api/points', { method: 'POST', headers: { cookie: client.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }), noParams)
  return { status: r.status, body: await r.json() }
}

it('成员只能看自己的积分，不能查看其他账户、分配积分或设置价格', async () => {
  const own = await points(writer)
  expect(own.body.available).toBe(25000)
  expect(own.body).not.toHaveProperty('accounts')
  expect((await points(boss)).body.accounts).toHaveLength(4)
  expect((await pointAction(writer, { action: 'allocate', userId: 'u-xiao', points: 1000, note: '自己加分', requestId: crypto.randomUUID() })).status).toBe(403)
  expect((await pointAction(sales, { action: 'price', points: 1 })).status).toBe(403)
  expect((await getPoints(new Request('http://test.local/api/points'), noParams)).status).toBe(401)
})

it('管理员分配积分留明细，并发重复点击只入账一次', async () => {
  const payload = { action: 'allocate', userId: 'u-xiao', points: 500, note: '本月稿件额度', requestId: crypto.randomUUID() }
  const [a, b] = await Promise.all([pointAction(boss, payload), pointAction(boss, payload)])
  expect(a.status).toBe(200); expect(b.status).toBe(200)
  const w = (await points(writer)).body
  expect(w.balance).toBe(25500)
  expect(w.entries).toHaveLength(1)
  expect(w.entries[0].actorName).toBe('老板')
  expect((await pointAction(boss, { ...payload, points: 600 })).status).toBe(400)
})

it('余额不足及两个不同任务并发时不会透支，失败请求不创建任务', async () => {
  await db.update(t.pointAccounts).set({ balance: 100 }).where(eq(t.pointAccounts.userId, 'u-xiao'))
  const [a, b] = await Promise.all([submit(writer), submit(writer, { order: true })])
  expect([a.status, b.status].sort()).toEqual([200, 402])
  expect((await points(writer)).body).toMatchObject({ balance: 100, reserved: 100, available: 0 })
  expect(await db.select().from(t.rewriteJobs)).toHaveLength(1)
  expect(submitRewrite).not.toHaveBeenCalled()
})

it('同一任务只预占一次，完成并保存文件后只结算一次', async () => {
  const a = await submit(writer)
  await submit(writer)
  expect((await points(writer)).body).toMatchObject({ balance: 25000, reserved: 100, available: 24900 })
  vi.mocked(submitRewrite).mockResolvedValueOnce({ status: 'succeeded' })
  await runRewriteWorkerOnce(); await runRewriteWorkerOnce()
  const w = (await points(writer)).body
  expect(w).toMatchObject({ balance: 24900, reserved: 0, available: 24900 })
  expect(w.entries.filter((e: { kind: string }) => e.kind === '工具扣除')).toHaveLength(1)
  expect((await row(a.body.id)).pointStatus).toBe('charged')
})

it('状态未知时保留预占，明确失败时退回，重复恢复不会多退', async () => {
  const a = await submit(writer)
  vi.mocked(submitRewrite).mockRejectedValueOnce(new ProviderError('network_unknown'))
  await runRewriteWorkerOnce()
  expect((await points(writer)).body.reserved).toBe(100)
  await due(a.body.id)
  vi.mocked(pollRewrite).mockResolvedValueOnce({ status: 'not_started' })
  await runRewriteWorkerOnce(); await runRewriteWorkerOnce()
  const w = (await points(writer)).body
  expect(w).toMatchObject({ balance: 25000, reserved: 0, available: 25000 })
  expect(w.entries.filter((e: { kind: string }) => e.kind === '积分退回')).toHaveLength(1)
  expect((await row(a.body.id)).pointStatus).toBe('refunded')
})

it('价格未配置或提交价格和后台不一致时阻止扣费，管理员可设置固定积分', async () => {
  await db.delete(t.toolPrices)
  expect((await submit(writer)).status).toBe(400)
  expect((await pointAction(boss, { action: 'price', points: 150 })).status).toBe(200)
  expect((await submit(writer)).status).toBe(400)
  expect((await db.select().from(t.rewriteJobs))).toHaveLength(0)
  expect((await submit(writer, { points: 150 })).status).toBe(200)
  expect((await points(writer)).body.reserved).toBe(150)
})

async function prepare(client: Client, linked = false) {
  const form = new FormData()
  form.set('platform', '1'); form.set('language', 'CN'); form.set('expectedPoints', '0')
  if (linked) form.set('orderId', orderId)
  form.set('file', new File([new Uint8Array(DOCX)], linked ? '关联稿.docx' : '独立稿.docx'))
  const r = await preparePost(new Request('http://test.local/api/toolbox/prepare', { method: 'POST', headers: { cookie: client.cookie }, body: form }), noParams)
  return { status: r.status, body: await r.json() }
}
async function batch(client: Client, jobIds: string[], requestId = randomUUID(), points = 100) {
  const r = await batchPost(new Request('http://test.local/api/toolbox/batches', { method: 'POST', headers: { cookie: client.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ requestId, jobIds, expectedPoints: points }) }), noParams)
  return { status: r.status, body: await r.json() }
}
it('批量上传不预占积分；重复确认原批次只预占一次，价格变化不影响原收据', async () => {
  const a = await prepare(writer), b = await prepare(writer, true)
  expect(a.status).toBe(200); expect(b.status).toBe(200)
  expect((await row(a.body.id)).status).toBe('draft')
  await runRewriteWorkerOnce(); expect(submitRewrite).not.toHaveBeenCalled()
  expect((await db.select().from(t.pointEntries))).toHaveLength(0)
  const id = randomUUID()
  const responses = await Promise.all([batch(writer, [a.body.id, b.body.id], id), batch(writer, [b.body.id, a.body.id], id)])
  expect(responses.every((r) => r.status === 200 && r.body.totalPoints === 200)).toBe(true)
  expect((await db.select().from(t.pointEntries))).toHaveLength(2)
  await db.update(t.toolPrices).set({ points: 2 })
  expect((await batch(writer, [a.body.id, b.body.id], id)).body.totalPoints).toBe(200)
  expect((await batch(writer, [a.body.id], id)).status).toBe(400)
  expect((await batch(other, [a.body.id, b.body.id], id)).status).toBe(404)
})
it('整批积分不足或混入他人任务时全部回滚，可刷新后选择草稿重新确认', async () => {
  const a = await prepare(writer), b = await prepare(writer, true), foreign = await prepare(other)
  expect((await batch(writer, [a.body.id, foreign.body.id])).status).toBe(404)
  await db.update(t.pointAccounts).set({ balance: 150 }).where(eq(t.pointAccounts.userId, 'u-xiao'))
  expect((await batch(writer, [a.body.id, b.body.id])).status).toBe(402)
  expect((await row(a.body.id)).status).toBe('draft'); expect((await row(b.body.id)).status).toBe('draft')
  expect((await db.select().from(t.pointEntries))).toHaveLength(0)
  expect((await db.select().from(t.rewriteBatches))).toHaveLength(0)
  expect((await batch(writer, [a.body.id])).status).toBe(200)
})
it('批次逐份处理；并发工作进程不能同时收费提交两份，前一份完成才提交下一份', async () => {
  const a = await prepare(writer), b = await prepare(writer, true)
  await batch(writer, [a.body.id, b.body.id])
  await Promise.all([runRewriteWorkerOnce(), runRewriteWorkerOnce()])
  expect(submitRewrite).toHaveBeenCalledTimes(1)
  const submitted = vi.mocked(submitRewrite).mock.calls[0][0]
  const waiting = [a.body.id, b.body.id].find((id) => id !== submitted)!
  expect((await row(waiting)).status).toBe('queued')
  await runRewriteWorkerOnce(); expect(submitRewrite).toHaveBeenCalledTimes(1)
  await due(submitted); vi.mocked(pollRewrite).mockResolvedValueOnce({ status: 'succeeded' })
  await runRewriteWorkerOnce(); expect((await row(submitted)).pointStatus).toBe('charged')
  await runRewriteWorkerOnce(); expect(submitRewrite).toHaveBeenCalledTimes(2)
  await due(waiting); vi.mocked(pollRewrite).mockResolvedValueOnce({ status: 'failed', errorCode: 'invalid_document' })
  await runRewriteWorkerOnce(); expect((await row(waiting)).pointStatus).toBe('refunded')
  const [w] = await db.select().from(t.pointAccounts).where(eq(t.pointAccounts.userId, 'u-xiao'))
  expect(w.balance).toBe(24900); expect(w.reserved).toBe(0)
})
it('批次最多 20 份，价格过期不提交，重复稿件恢复已有任务不再次预占', async () => {
  const a = await prepare(writer)
  expect((await batch(writer, Array(21).fill(a.body.id))).status).toBe(400)
  expect((await batch(writer, [a.body.id], randomUUID(), 2)).status).toBe(400)
  const original = await batch(writer, [a.body.id, a.body.id])
  expect(original.body.createdCount).toBe(1)
  const reused = await batch(writer, [a.body.id])
  expect(reused.body.totalPoints).toBe(0); expect(reused.body.reusedCount).toBe(1)
  expect((await db.select().from(t.pointEntries))).toHaveLength(1)
})
