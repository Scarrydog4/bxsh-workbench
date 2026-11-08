import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, writer: Client, sales: Client
let channelId = ''
const due = () => new Date(Date.now() + 86400_000).toISOString()
const order = async (id: string) => (await boss.boot()).body.orders.find((o: { id: string }) => o.id === id)
async function makeOrder() {
  return (await boss.act('order.create', { title: '二轮修复回归', orderDate: '2026-10-07', dueDate: null, ownerId: 'u-acheng', channelId, basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 100 }, { userId: 'u-boss', pay: 100 }] })).body.id as string
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss')
  writer = await as('xiaosenkai')
  sales = await as('acheng')
  await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })
  channelId = (await boss.act('channel.create', { name: '二轮回归渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

describe('金额确认重试', () => {
  it('并发重试同一确认只加一次，之后的独立加价仍能记录', async () => {
    const id = await makeOrder()
    const a = await boss.act('aftersale.create', { orderId: id, req: ['新增章节'], due: due() })
    const body = { orderId: id, asId: a.body.id, reason: '新增需求', extra: 80, charge: 300, requestId: randomUUID() }
    const results = await Promise.all([boss.act('aftersale.reason', body), boss.act('aftersale.reason', body)])
    expect(results.map((x) => x.status)).toEqual([200, 200])
    let o = await order(id)
    expect(o.sales).toBe(1300)
    expect(o.adjustments).toHaveLength(1)
    expect(o.writerTotal).toBe(280)
    const logs = (await boss.activity(id)).body.filter((x: { action: string }) => x.action === '追加')
    expect(logs).toHaveLength(1)
    expect((await boss.act('aftersale.reason', { ...body, requestId: randomUUID(), charge: 100 })).status).toBe(200)
    o = await order(id)
    expect(o.sales).toBe(1400)
    expect(o.adjustments).toHaveLength(2)
    expect((await boss.act('aftersale.reason', { ...body, charge: 999 })).status).toBe(400)
    expect((await order(id)).sales).toBe(1400)
  })
})

describe('负责人变更不能绕过工资权限', () => {
  it('写手和销售不能转移80元，原收入、期限不变；管理员可以确认换人并留痕', async () => {
    const id = await makeOrder()
    const deadline = due()
    const a = await boss.act('aftersale.create', { orderId: id, reason: '新增需求', req: ['追加需求'], due: deadline, extra: 80, writerId: 'u-boss' })
    // 历史任务的改期限入口继续验证工资边界。
    await db.update(t.afterSales).set({ confirmBy: null, confirmedAt: null }).where(eq(t.afterSales.id, a.body.id))
    const change = { orderId: id, asId: a.body.id, writerId: 'u-xiao', due: new Date(Date.now() + 172800_000).toISOString() }
    expect((await writer.act('aftersale.update', change)).status).toBe(403)
    expect((await sales.act('aftersale.update', change)).status).toBe(403)
    const unchanged = (await order(id)).afterSales[0]
    expect(unchanged).toMatchObject({ writerId: 'u-boss', extra: 80 })
    expect(new Date(unchanged.due).getTime()).toBe(new Date(deadline).getTime())
    let income = (await boss.boot()).body.income
    // 老板自己的写作计价不作为支出；收入统一显示订单净收入。
    expect(income['u-boss'].find((r: { id: string }) => r.id === id)).toMatchObject({ kind: '订单收入', amount: 540 })
    expect(income['u-xiao'].some((r: { id: string; kind: string }) => r.id === id && r.kind === '追加工资')).toBe(false)
    // 普通延期不改变工资，仍可由有售后权限的人操作。
    expect((await sales.act('aftersale.update', { orderId: id, asId: a.body.id, due: change.due })).status).toBe(200)
    expect((await boss.act('aftersale.update', change)).status).toBe(200)
    income = (await boss.boot()).body.income
    expect(income['u-boss'].find((r: { id: string }) => r.id === id)).toMatchObject({ kind: '订单收入', amount: 460 })
    expect(income['u-xiao'].some((r: { id: string; amount: number }) => r.id === id && r.amount === 80)).toBe(true)
    expect((await boss.activity(id)).body.some((r: { action: string }) => r.action === '换负责人')).toBe(true)
  })

  it('没有追加工资时，销售仍能给本单写手调整负责人', async () => {
    const id = await makeOrder()
    const a = await sales.act('aftersale.create', { orderId: id, req: ['普通修改'], due: due(), writerId: 'u-boss' })
    expect((await sales.act('aftersale.update', { orderId: id, asId: a.body.id, writerId: 'u-xiao' })).status).toBe(200)
    expect((await order(id)).afterSales[0].writerId).toBe('u-xiao')
  })
})
