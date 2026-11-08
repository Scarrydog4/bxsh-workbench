import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { getCtx, type Ctx } from '@/server/session'
import { query, ask } from '@/server/assistant/query'
import { confirmOrders } from '@/server/assistant/confirm'
import { parseOrders } from '@/server/assistant/parse'
import { estimateCost, monthUsage, checkBalance } from '@/server/assistant/provider'
import { POST as parseRoute } from '@/app/api/assistant/parse/route'
import { POST as askRoute } from '@/app/api/assistant/ask/route'
import { POST as confirmRoute } from '@/app/api/assistant/confirm/route'
import { GET as statusRoute } from '@/app/api/assistant/status/route'
import { db } from '@/server/db'
import { audit } from '@/server/schema'
import { eq } from 'drizzle-orm'

let boss: Client, sales: Client, writer: Client, bossCtx: Ctx, salesCtx: Ctx, writerCtx: Ctx
let channelId = ''
const extra = { params: Promise.resolve({}) }
const ctx = async (c: Client) => (await getCtx(new Request('http://test.local', { headers: { cookie: c.cookie } })))!
const order = (title: string) => ({ title, channelId, ownerId: 'u-acheng', salesMode: 'commission', orderDate: '2026-10-07', dueDate: '2026-10-12', type: '测试类型', basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 100 }], note: '' })
const completion = (content: unknown, tools?: unknown[]) => new Response(JSON.stringify({ choices: [{ finish_reason: tools ? 'tool_calls' : 'stop', message: { role: 'assistant', content: content === null ? null : typeof content === 'string' ? content : JSON.stringify(content), ...(tools ? { tool_calls: tools } : {}) } }], usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 500 } }), { headers: { 'content-type': 'application/json' } })
const originalKey = process.env.DEEPSEEK_API_KEY
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  bossCtx = await ctx(boss); salesCtx = await ctx(sales); writerCtx = await ctx(writer)
  channelId = (await boss.act('channel.create', { name: '验收渠道', ownerId: 'u-acheng' })).body.id
  await boss.act('order.create', order('可见订单'))
  await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })
  await boss.act('order.create', { ...order('另一销售的隐蔽订单'), ownerId: 'u-yang', assignees: [{ userId: 'u-boss', pay: 400 }] })
  process.env.DEEPSEEK_API_KEY = 'test-only-key'
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalKey; await closeDb() })

describe('助手查询与权限', () => {
  it('销售只看到自己的单，写手字段在进入模型之前裁掉', async () => {
    const s = JSON.stringify(await query(salesCtx, 'search_orders', {}))
    expect(s).toContain('可见订单'); expect(s).not.toContain('隐蔽订单'); expect(s).not.toContain('"pay":'); expect(s).not.toContain('"profit":')
    const w = JSON.stringify(await query(writerCtx, 'search_orders', {}))
    expect(w).not.toContain('隐蔽订单'); expect(w).not.toContain('"sales":'); expect(w).not.toContain('"commission":'); expect(w).toContain('"pay":100')
  })
  it('禁止用汇总、筛选绕过字段权限和调用未知工具', async () => {
    await expect(query(salesCtx, 'summarize_orders', { metric: 'writerPay' })).rejects.toMatchObject({ status: 403 })
    await expect(query(writerCtx, 'summarize_orders', { metric: 'sales' })).rejects.toMatchObject({ status: 403 })
    await expect(query(writerCtx, 'search_orders', { unpaidOnly: true })).rejects.toMatchObject({ status: 403 })
    await expect(query(bossCtx, 'execute_sql', {})).rejects.toMatchObject({ status: 400 })
  })
  it('汇总不受搜索分页影响，支持截止日期和本人追加工资', async () => {
    const a = (await boss.boot()).body.orders.find((o: { title: string }) => o.title === '可见订单')
    await boss.act('aftersale.create', { orderId: a.id, reason: '新增需求', extra: 80, req: ['新增章节'], due: new Date(Date.now() + 86400000).toISOString(), writerId: 'u-xiao' })
    expect(await query(writerCtx, 'summarize_orders', { metric: 'writerPay' })).toMatchObject({ total: 1, groups: [{ amount: 180 }] })
    expect(await query(bossCtx, 'search_orders', { limit: 1 })).toMatchObject({ total: 2, hasMore: true })
    expect(await query(bossCtx, 'summarize_orders', { metric: 'sales' })).toMatchObject({ total: 2, groups: [{ amount: 2000 }] })
    expect(await query(salesCtx, 'search_orders', { dateField: 'dueDate', from: '2026-10-12', to: '2026-10-12' })).toMatchObject({ total: 1, queryScope: expect.stringContaining('截止日期：2026-10-12 至 2026-10-12') })
  })
  it('模型工具闭环只接收可见数据，链接由服务器生成，调用记用量', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(completion(null, [{ id: 'call1', type: 'function', function: { name: 'search_orders', arguments: '{}' } }])).mockResolvedValueOnce(completion('找到 1 单。'))
    const result = await ask(writerCtx, '我的单有哪些？')
    expect(result.orders).toHaveLength(1)
    const secondRequest = JSON.parse(String(mock.mock.calls[1][1]?.body))
    const toolOutput = secondRequest.messages.find((x: { role: string }) => x.role === 'tool').content
    expect(toolOutput).not.toContain('"sales":'); expect(toolOutput).not.toContain('隐蔽订单')
    expect(await monthUsage()).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 200 })
  })
})

describe('先识别再确认', () => {
  it('文字和图片只返回草稿，标记未匹配和缺价，不创建订单', async () => {
    const before = (await boss.boot()).body.orders.length
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({ orders: [
      { title: '识别草稿', channelName: '验收渠道', writerName: '肖森凯', basePrice: 500, imageIndexes: [0, 5] },
      { title: '缺字段', channelName: '新渠道', writerName: '不认识的写手' },
    ] }))
    const result = await parseOrders(bossCtx, { text: '演示消息', images: ['data:image/png;base64,aGVsbG8='] })
    expect(result.orders[0]).toMatchObject({ channelId, writerId: 'u-xiao', basePrice: 500, imageIndexes: [0] })
    expect(result.orders[1]).toMatchObject({ channelId: '', writerId: '', basePrice: null })
    expect(result.orders[1].warnings.length).toBeGreaterThan(0)
    expect((await boss.boot()).body.orders).toHaveLength(before)
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body)).messages[1].content[1].type).toBe('image_url')
  })
  it('原子确认并留AI录入痕迹，重复请求不重复订单或新渠道', async () => {
    const before = (await boss.boot()).body.orders.length
    const input = { batchId: crypto.randomUUID(), orders: [{ ...order('批量A'), type: '新类型A', channelId: '', newChannelName: '新渠道' }, { ...order('批量B'), type: '新类型B', channelId: '', newChannelName: '新渠道' }] }
    const [a, b] = await Promise.all([confirmOrders(bossCtx, input), confirmOrders(bossCtx, input)])
    expect(a).toEqual(b); expect(a.orders).toHaveLength(2)
    const boot = (await boss.boot()).body
    expect(boot.orders).toHaveLength(before + 2)
    expect(boot.types).toEqual(expect.arrayContaining(['新类型A', '新类型B']))
    expect(boot.channels.filter((c: { name: string }) => c.name === '新渠道')).toHaveLength(1)
    expect((await boss.activity(a.orders[0].id)).body.some((l: { action: string }) => l.action === 'AI 录入')).toBe(true)
    await expect(confirmOrders(bossCtx, { ...input, orders: [order('不同内容')] })).rejects.toMatchObject({ status: 400 })
  })
  it('第二单无效整批回滚、非法日期拒绝、销售不能指定他人归属或工资', async () => {
    const before = (await boss.boot()).body.orders.length
    await expect(confirmOrders(bossCtx, { batchId: crypto.randomUUID(), orders: [order('应回滚'), { ...order('无效'), channelId: 'missing' }] })).rejects.toMatchObject({ status: 400 })
    expect((await boss.boot()).body.orders).toHaveLength(before)
    await expect(confirmOrders(bossCtx, { batchId: crypto.randomUUID(), orders: [{ ...order('非法日期'), dueDate: '2026-02-30' }] })).rejects.toMatchObject({ status: 400 })
    const result = await confirmOrders(salesCtx, { batchId: crypto.randomUUID(), orders: [{ ...order('销售确认'), ownerId: 'u-yang', assignees: [{ userId: 'u-boss', pay: 999 }] }] })
    const o = (await boss.boot()).body.orders.find((o: { id: string }) => o.id === result.orders[0].id)
    expect(o.ownerId).toBe('u-acheng'); expect(o.assignees).toEqual([{ userId: 'u-xiao', pay: null }])
  })
  it('客户报价与交老板底价分别识别，成本草稿不携带客户报价字段', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion({ orders: [{ title: '双金额', basePrice: 800, costPrice: 500, costPriceEvidence: '交老板 500' }] }))
    const cost = await parseOrders(bossCtx, { text: '双金额，客户总价800，交老板 500', images: [], salesMode: 'cost' })
    expect(cost.orders[0]).toMatchObject({ salesMode: 'cost', basePrice: 500, channelId: '' })
    expect(cost.orders[0]).not.toHaveProperty('costPrice')
    expect(cost.orders[0]).not.toHaveProperty('costPriceEvidence')
    const commission = await parseOrders(bossCtx, { text: '双金额，客户总价800，交老板 500', images: [], salesMode: 'commission' })
    expect(commission.orders[0]).toMatchObject({ salesMode: 'commission', basePrice: 800 })
  })
  it('底价账户默认采用成本口径，缺失或对不上的原文依据不套用客户报价', async () => {
    expect((await boss.act('user.update', { id: 'u-acheng', patch: { salesMode: 'cost' } })).status).toBe(200)
    try {
      const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({ orders: [{ title: '只有报价', basePrice: 800, costPrice: 800 }] }))
      const missing = await parseOrders(salesCtx, { text: '客户报价800', images: [] })
      expect(missing.orders[0]).toMatchObject({ salesMode: 'cost', basePrice: null })
      expect(missing.orders[0].warnings).toContain('交老板底价未明确，请填写')
      expect(missing.orders[0].warnings).not.toContain('渠道未匹配，请选择已有渠道或新建')
      fetcher.mockResolvedValue(completion({ orders: [{ title: '金额不对应', basePrice: 800, costPrice: 800, costPriceEvidence: '底价500' }] }))
      expect((await parseOrders(salesCtx, { text: '客户总价800，底价500', images: [] })).orders[0].basePrice).toBeNull()
      fetcher.mockImplementation(async () => completion({ orders: [{ title: '虚构依据', basePrice: 800, costPrice: 500, costPriceEvidence: '底价500' }] }))
      expect((await parseOrders(salesCtx, { text: '客户总价800', images: [] })).orders[0].basePrice).toBeNull()
      expect((await parseOrders(salesCtx, { text: '客户总价800', images: [], salesMode: 'commission' })).orders[0]).toMatchObject({ salesMode: 'commission', basePrice: 800 })
    } finally {
      await boss.act('user.update', { id: 'u-acheng', patch: { salesMode: 'commission' } })
    }
  })
  it('截图中明确底价可识别，未匹配渠道的成本单可原子确认并重复安全', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({ orders: [{ title: '截图底价', basePrice: 900, costPrice: 500, costPriceEvidence: '底价：500元' }] }))
    expect((await parseOrders(bossCtx, { text: '', images: ['data:image/png;base64,aGVsbG8='], salesMode: 'cost' })).orders[0].basePrice).toBe(500)
    const input = { batchId: crypto.randomUUID(), orders: [{ ...order('无渠道底价确认'), salesMode: 'cost', channelId: '', basePrice: 500, assignees: [{ userId: 'u-xiao', pay: 80 }] }] }
    const first = await confirmOrders(bossCtx, input)
    expect(await confirmOrders(bossCtx, input)).toEqual(first)
    const saved = (await boss.boot()).body.orders.find((item: { id: string }) => item.id === first.orders[0].id)
    expect(saved).toMatchObject({ salesMode: 'cost', channelId: '', basePrice: 500, bossIncome: 420, commission: 0 })
    await expect(confirmOrders(bossCtx, { ...input, orders: [{ ...input.orders[0], salesMode: 'commission' }] })).rejects.toMatchObject({ status: 400 })
    const { salesMode: _mode, ...legacy } = input.orders[0]
    await expect(confirmOrders(bossCtx, { batchId: crypto.randomUUID(), orders: [legacy] })).rejects.toMatchObject({ status: 400 })
    await expect(confirmOrders(bossCtx, { batchId: crypto.randomUUID(), orders: [{ ...input.orders[0], salesMode: 'commission' }] })).rejects.toMatchObject({ status: 400 })
  })
})

describe('接口和费用', () => {
  it('未登录和无权限先拒绝，供应商不会被调用', async () => {
    const mock = vi.spyOn(globalThis, 'fetch')
    expect((await askRoute(new Request('http://test.local', { method: 'POST', body: '{}' }), extra)).status).toBe(401)
    expect((await parseRoute(new Request('http://test.local', { method: 'POST', headers: { cookie: writer.cookie }, body: JSON.stringify({ text: '录一单' }) }), extra)).status).toBe(403)
    expect((await confirmRoute(new Request('http://test.local', { method: 'POST', headers: { cookie: writer.cookie }, body: JSON.stringify({ batchId: crypto.randomUUID(), orders: [order('拒绝')] }) }), extra)).status).toBe(403)
    expect(mock).not.toHaveBeenCalled()
  })
  it('余额不足阻止调用，只有管理员能看月度用量，日志不含密钥', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ is_available: false, balance_infos: [] })))
    await expect(checkBalance()).rejects.toMatchObject({ status: 402 }); expect(mock).toHaveBeenCalledTimes(1)
    const s = await statusRoute(new Request('http://test.local', { headers: { cookie: sales.cookie } }), extra)
    expect(await s.json()).toEqual({ configured: true })
    const b = await statusRoute(new Request('http://test.local', { headers: { cookie: boss.cookie } }), extra)
    expect((await b.json()).usage.calls).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(await db.select().from(audit).where(eq(audit.objectType, 'assistant')))).not.toContain('test-only-key')
  })
  it('北京时间峰谷和缓存token估算正确，供应商失败不算成功调用', async () => {
    const usage = { prompt_tokens: 1_000_000, prompt_cache_hit_tokens: 500_000, completion_tokens: 100_000 }
    expect(estimateCost(usage, new Date('2026-10-07T02:00:00Z')).estimatedCny).toBeCloseTo(1.82)
    expect(estimateCost(usage, new Date('2026-10-07T12:00:00Z')).estimatedCny).toBeCloseTo(.91)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }))
    const before = await monthUsage()
    await expect(parseOrders(bossCtx, { text: 'test', images: [] })).rejects.toMatchObject({ status: 502 })
    expect(await monthUsage()).toEqual(before)
    expect((await db.select().from(audit).where(eq(audit.action, 'AI 失败'))).length).toBeGreaterThan(0)
  })
})
