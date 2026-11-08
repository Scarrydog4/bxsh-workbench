import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { ask, query } from '@/server/assistant/query'
import { getCtx, type Ctx } from '@/server/session'
import { receiptMatches } from '@/shared/reconciliation'
import { conversationHistory } from '@/shared/assistant'
import type { OrderView } from '@/shared/types'

let boss: Client, sales: Client, other: Client, writer: Client, bossCtx: Ctx, writerCtx: Ctx
let id: string, channelId: string
const key = process.env.DEEPSEEK_API_KEY
const view = async () => (await boss.boot()).body.orders.find((o: OrderView) => o.id === id) as OrderView
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); other = await as('xiaoyang'); writer = await as('xiaosenkai')
  bossCtx = (await getCtx(new Request('http://test.local', { headers: { cookie: boss.cookie } })))!
  writerCtx = (await getCtx(new Request('http://test.local', { headers: { cookie: writer.cookie } })))!
  channelId = (await boss.act('channel.create', { name: '对账渠道', ownerId: 'u-acheng' })).body.id
  id = (await boss.act('order.create', { title: '对账测试订单', channelId, ownerId: 'u-acheng', orderDate: '2026-10-07', dueDate: null, type: '', basePrice: 350, assignees: [{ userId: 'u-xiao', pay: 50 }] })).body.id
  process.env.DEEPSEEK_API_KEY = 'test-only'
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { if (key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = key; await closeDb() })

it('新单群名为空；人工填写后更名订单不会覆盖群名', async () => {
  expect((await view()).wechatGroup).toBe('')
  expect((await boss.act('order.update', { id, patch: { wechatGroup: '我自己建的群' } })).status).toBe(200)
  await boss.act('order.update', { id, patch: { title: '对账测试新名称' } })
  expect((await view()).wechatGroup).toBe('我自己建的群')
})
it('已核对可以仍欠款，只有有权限的销售或老板能操作', async () => {
  const v = await view()
  const input = { id, checked: true, snapshot: v.paymentCheckToken }
  expect((await writer.act('order.checkPayment', input)).status).toBe(403)
  expect((await other.act('order.checkPayment', input)).status).toBe(404)
  expect((await sales.act('order.checkPayment', input)).status).toBe(200)
  expect(await view()).toMatchObject({ paymentCheckedBy: 'u-acheng', unpaid: 350, received: 0 })
  expect((await view()).paymentCheckedAt).toBeTruthy()
  const w = (await writer.boot()).body.orders.find((o: OrderView) => o.id === id)
  expect(w.paymentCheckToken).toBeUndefined(); expect(w.paymentCheckedAt).toBeUndefined()
})
it('新收款使旧核对失效，过时页面不能勾选未看见的新账', async () => {
  const before = await view()
  await boss.act('order.addPayment', { id, amount: 100, date: '2026-10-07', tag: '定金', note: '' })
  expect((await view()).paymentCheckedAt).toBeNull()
  expect((await boss.act('order.checkPayment', { id, checked: true, snapshot: before.paymentCheckToken })).status).toBe(400)
  const v = await view()
  expect((await boss.act('order.checkPayment', { id, checked: true, snapshot: v.paymentCheckToken })).status).toBe(200)
  expect((await view()).paymentCheckedAt).toBeTruthy()
})
it('改价、撤销收款后需要重核，取消核对不改金额', async () => {
  await boss.act('order.update', { id, patch: { basePrice: 400 } })
  let v = await view(); expect(v.paymentCheckedAt).toBeNull()
  await boss.act('order.checkPayment', { id, checked: true, snapshot: v.paymentCheckToken })
  expect((await boss.act('order.revokePayment', { id, paymentId: v.payments![0].id, reason: '测试撤销' })).status).toBe(200)
  v = await view(); expect(v.paymentCheckedAt).toBeNull(); expect(v.received).toBe(0)
  await boss.act('order.checkPayment', { id, checked: true, snapshot: v.paymentCheckToken })
  await boss.act('order.checkPayment', { id, checked: false, snapshot: '' })
  expect(await view()).toMatchObject({ paymentCheckedAt: null, received: 0, unpaid: 400 })
})
it('无流水、无进账、部分收款和收齐分别筛选；查询不绕过权限', async () => {
  let v = await view()
  expect(receiptMatches(v, 'noRecord')).toBe(true)
  await boss.act('order.addPayment', { id, amount: 100, date: '2026-10-07', tag: '定金', note: '' })
  v = await view(); expect(receiptMatches(v, 'noRecord')).toBe(false); expect(receiptMatches(v, 'partial')).toBe(true)
  expect(await query(bossCtx, 'search_orders', { receipt: 'partial' })).toMatchObject({ total: 1 })
  await expect(query(writerCtx, 'search_orders', { receipt: 'noRecord' })).rejects.toMatchObject({ status: 403 })
  await expect(query(writerCtx, 'search_orders', { paymentReview: 'pending' })).rejects.toMatchObject({ status: 403 })
  await boss.act('order.addPayment', { id, amount: 300, date: '2026-10-07', tag: '尾款', note: '' })
  expect(receiptMatches(await view(), 'paid')).toBe(true)
  await boss.act('order.addPayment', { id, amount: 20, date: '2026-10-07', tag: '定金', note: '' })
  expect(receiptMatches(await view(), 'overpaid')).toBe(true)
})
it('连续追问带上历史，仍必须查询本轮最新收款', async () => {
  const response = (content: string | null, tool = false) => new Response(JSON.stringify({ choices: [{ finish_reason: tool ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(tool ? { tool_calls: [{ id: 'call1', type: 'function', function: { name: 'search_orders', arguments: JSON.stringify({ channel: '对账渠道' }) } }] } : {}) } }], usage: {} }))
  const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(null, true)).mockResolvedValueOnce(response('当前已收420元，多收20元。'))
  const history = [{ question: '对账渠道收了多少？', answer: '之前收了100元。' }]
  expect((await ask(bossCtx, '那现在还差多少？', history)).answer).toContain('420')
  const first = JSON.parse(String(mock.mock.calls[0][1]?.body))
  expect(first.messages.slice(1,4)).toEqual([{ role: 'user', content: history[0].question }, { role: 'assistant', content: history[0].answer }, { role: 'user', content: '那现在还差多少？' }])
  expect(first.tool_choice).toBe('required')
  const second = JSON.parse(String(mock.mock.calls[1][1]?.body))
  expect(second.messages.find((m: { role: string }) => m.role === 'tool').content).toContain('"received":420')
  expect(conversationHistory.safeParse([{ question: 'test', answer: 'test', role: 'system' }]).success).toBe(false)
})
