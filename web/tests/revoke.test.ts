/**
 * 撤销记错的收款、追加 / 减免：只有管理员，原因必填；记录保留，金额不再计入；留痕且按权限过滤。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, acheng: Client, xiao: Client
let id = ''
const day = new Date().toISOString().slice(0, 10)
const order = async (c: Client) => (await c.boot()).body.orders.find((o: { id: string }) => o.id === id)

beforeAll(async () => {
  await resetDb()
  boss = await as('boss')
  acheng = await as('acheng')
  xiao = await as('xiaosenkai')
  const ch = (await boss.act('channel.create', { name: '撤销渠道', ownerId: 'u-acheng' })).body.id
  id = (await boss.act('order.create', { title: '撤销测试', orderDate: day, dueDate: null, ownerId: 'u-acheng', channelId: ch, basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 200 }], channelNo: '', type: '', note: '' })).body.id
})
afterAll(closeDb)

describe('撤销收款', () => {
  it('管理员撤销后，记录还在、标为已撤销，已收不再算它', async () => {
    await boss.act('order.addPayment', { id, amount: 5000, date: day, tag: '全款', note: '多写了一个 0' })
    await boss.act('order.addPayment', { id, amount: 500, date: day, tag: '定金', note: '' })
    let o = await order(boss)
    expect(o.received).toBe(5500)
    const wrong = o.payments.find((p: { amount: number }) => p.amount === 5000)

    // 销售能记收款，但不能撤销；原因必填
    expect((await acheng.act('order.revokePayment', { id, paymentId: wrong.id, reason: '填错' })).status).toBe(403)
    expect((await boss.act('order.revokePayment', { id, paymentId: wrong.id, reason: ' ' })).status).toBe(400)

    expect((await boss.act('order.revokePayment', { id, paymentId: wrong.id, reason: '金额多写了一个 0' })).status).toBe(200)
    o = await order(boss)
    expect(o.received).toBe(500)
    expect(o.payStatus).toBe('部分收款')
    expect(o.payments).toHaveLength(2)
    expect(o.payments.find((p: { id: string }) => p.id === wrong.id).revoked).toMatchObject({ by: 'u-boss', reason: '金额多写了一个 0' })
    expect((await boss.act('order.revokePayment', { id, paymentId: wrong.id, reason: '再撤' })).status).toBe(400)
  })
})

describe('撤销追加 / 减免', () => {
  it('撤销后销售额、提成、利润按剩下的算', async () => {
    await boss.act('order.addAdjustment', { id, amount: 300, reason: '加急' })
    let o = await order(boss)
    expect(o.sales).toBe(1300)
    expect(o.commission).toBe(550) // (1300 - 200) × 50%
    const adj = o.adjustments[0]
    expect((await acheng.act('order.revokeAdjustment', { id, adjustmentId: adj.id, reason: '客户没加' })).status).toBe(403)
    expect((await boss.act('order.revokeAdjustment', { id, adjustmentId: adj.id, reason: '客户没加' })).status).toBe(200)
    o = await order(boss)
    expect(o.sales).toBe(1000)
    expect(o.commission).toBe(400)
    expect(o.profit).toBe(400)
    expect(o.adjustments[0].revoked.reason).toBe('客户没加')
  })

  it('撤销有留痕；写手的动态里看不到（属于销售额类）', async () => {
    const all = (await boss.activity(id)).body.map((a: { action: string }) => a.action)
    expect(all).toEqual(expect.arrayContaining(['撤销收款', '撤销追加']))
    expect((await acheng.activity(id)).body.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['撤销收款', '撤销追加']))
    const writer = (await xiao.activity(id)).body.map((a: { action: string }) => a.action)
    expect(writer).not.toContain('撤销收款')
    expect(writer).not.toContain('撤销追加')
  })
})
