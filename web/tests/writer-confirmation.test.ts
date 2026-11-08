import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { afterSaleState, confirmationState } from '@/shared/as-rules'
import { deliveryProof, as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, sales: Client, writer: Client, otherSales: Client
let channelId = ''
const hour = 3600_000
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai'); otherSales = await as('xiaoyang')
  channelId = (await boss.act('channel.create', { name: '确认时间测试渠道', ownerId: 'u-acheng' })).body.id
})
afterEach(() => vi.restoreAllMocks())
afterAll(closeDb)
const task = async (orderId: string) => (await boss.boot()).body.orders.find((o: { id: string }) => o.id === orderId).afterSales[0]
async function create() {
  const o = await sales.act('order.create', { title: '每日修改任务', channelId, orderDate: '2026-10-07', dueDate: null, basePrice: 500, ownerId: 'u-acheng' })
  expect(o.status).toBe(200)
  const a = await sales.act('aftersale.create', { orderId: o.body.id, req: ['第三章补充分析'], shots: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='], due: new Date(Date.now() + 72 * hour).toISOString() })
  expect(a.status).toBe(200)
  return { orderId: o.body.id as string, asId: a.body.id as string }
}

describe('写手一小时回复与默认交付', () => {
  it('发布后即保存1小时确认线和24小时默认截止，销售不能替写手承诺', async () => {
    const ids = await create(), a = await task(ids.orderId)
    expect(new Date(a.confirmBy).getTime() - new Date(a.start).getTime()).toBe(hour)
    expect(new Date(a.due).getTime() - new Date(a.start).getTime()).toBe(24 * hour)
    expect(a.confirmedAt).toBeNull()
    expect(confirmationState(a, new Date(a.start).getTime())).toBe('waiting')
    expect((await sales.act('aftersale.confirm', { ...ids, due: new Date(a.due).toISOString() })).status).toBe(403)
    expect((await boss.act('aftersale.confirm', { ...ids, due: new Date(a.due).toISOString() })).status).toBe(403)
    expect((await otherSales.act('aftersale.confirm', { ...ids, due: new Date(a.due).toISOString() })).status).toBe(404)
    const visible = (await writer.boot()).body.orders.find((o: { id: string }) => o.id === ids.orderId)
    expect(visible.sales).toBeUndefined()
    expect(visible.afterSales[0].shots).toHaveLength(1)
  })
  it('一小时内本人回复预计完成时间，销售收到同一时间；重复确认不重记日志', async () => {
    const ids = await create(), a = await task(ids.orderId)
    const now = new Date(a.start).getTime() + 59 * 60_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    expect((await writer.act('aftersale.confirm', { ...ids, due: new Date(now - 1000).toISOString() })).status).toBe(400)
    const due = new Date(now + 4 * hour).toISOString()
    expect((await writer.act('aftersale.confirm', { ...ids, due })).status).toBe(200)
    expect((await writer.act('aftersale.confirm', { ...ids, due })).status).toBe(200)
    const updated = await task(ids.orderId)
    expect(new Date(updated.due).getTime()).toBe(new Date(due).getTime())
    expect(confirmationState(updated, now)).toBe('confirmed')
    const salesView = (await sales.boot()).body.orders.find((o: { id: string }) => o.id === ids.orderId).afterSales[0]
    expect(salesView.confirmedAt).toBe(updated.confirmedAt)
    expect((await boss.activity(ids.orderId)).body.filter((x: { action: string }) => x.action === '确认完成时间')).toHaveLength(1)
  })
  it('一小时边界立即启用默认截止，无人打开页面也生效，晚回复不能重新计时', async () => {
    const ids = await create(), a = await task(ids.orderId)
    const boundary = new Date(a.confirmBy).getTime()
    expect(confirmationState(a, boundary - 1)).toBe('waiting')
    expect(confirmationState(a, boundary)).toBe('default')
    vi.spyOn(Date, 'now').mockReturnValue(boundary)
    expect((await writer.act('aftersale.confirm', { ...ids, due: new Date(boundary + 24 * hour).toISOString() })).status).toBe(400)
    const before = await task(ids.orderId)
    expect(before.due).toBe(a.due)
    expect((await writer.act('aftersale.confirm', { ...ids, due: new Date(a.due).toISOString() })).status).toBe(200)
    const acknowledged = await task(ids.orderId)
    expect(acknowledged.due).toBe(a.due)
    expect(confirmationState(acknowledged, boundary)).toBe('default')
    expect(afterSaleState(acknowledged, new Date(a.start).getTime() + 25 * hour).tone).toBe('late')
  })
  it('不能用旧改期限入口绕过回复要求；已完成任务不能再确认', async () => {
    const ids = await create(), a = await task(ids.orderId)
    expect((await sales.act('aftersale.update', { ...ids, due: new Date(Date.now() + 48 * hour).toISOString() })).status).toBe(400)
    expect((await writer.act('aftersale.update', { ...ids, due: new Date(Date.now() + 48 * hour).toISOString() })).status).toBe(400)
    expect((await writer.act('aftersale.finish', { ...ids, proofIds: await deliveryProof(writer, ids.orderId, ids.asId) })).status).toBe(200)
    expect((await writer.act('aftersale.confirm', { ...ids, due: new Date(a.due).toISOString() })).status).toBe(400)
  })
  it('未启用新规则的历史任务保留原截止与改期限能力', async () => {
    const ids = await create()
    await db.update(t.afterSales).set({ confirmBy: null, confirmedAt: null }).where(eq(t.afterSales.id, ids.asId))
    const due = new Date(Date.now() + 48 * hour).toISOString()
    expect((await sales.act('aftersale.update', { ...ids, due })).status).toBe(200)
    expect(confirmationState(await task(ids.orderId))).toBe('legacy')
  })
})
