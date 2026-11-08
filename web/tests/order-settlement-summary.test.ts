import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { GET as getSummary } from '@/app/api/settle/order/route'
import { GET as getIncome } from '@/app/api/income/route'
import { as, closeDb, deliveryProof, resetDb, type Client } from './helpers'
import { businessDate } from '@/shared/format'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client, helper: Client, channelId: string
const day = businessDate(new Date())
const context = { params: Promise.resolve({}) }
async function summary(client: Client, orderId: string, kind = '销售提成', payeeId = 'u-acheng') {
  const query = new URLSearchParams({ order: orderId, kind, payee: payeeId })
  const response = await getSummary(new Request(`http://test.local/api/settle/order?${query}`, { headers: { cookie: client.cookie } }), context)
  return { status: response.status, body: await response.json() }
}
async function create(pay: number | null = 300) {
  const result = await boss.act('order.create', { title: '单订单结算汇总', orderDate: day, dueDate: null, channelId, ownerId: 'u-acheng', basePrice: 600, assignees: [{ userId: 'u-xiao', pay }] })
  expect(result.status).toBe(200)
  return result.body.id as string
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng')
  channelId = (await boss.act('channel.create', { name: '结算汇总验证', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

it('只开放本类结算权限，未授权员工不能读取他人工资或提成', async () => {
  const order = await create()
  expect((await summary(sales, order)).status).toBe(403)
  expect((await summary(writer, order, '写手工资', 'u-xiao')).status).toBe(403)
  expect((await summary(boss, order)).body).toEqual({ amount: 150, paid: 0, unpaid: 150, available: 150 })
})

it('结算助手无 income.all 也能读取可见单汇总，不扩大其他收入和订单权限', async () => {
  const order = await create()
  const fields = { sales: false, writerPay: 'none', commission: 'all', profit: false, channelNo: false }
  const role = await boss.act('role.save', { name: '结算汇总助手', perms: ['order.view', 'settle.manage'], fields, rowScope: 'all' })
  expect(role.status).toBe(200)
  expect((await boss.act('user.update', { id: 'u-yang', patch: { roleId: role.body.id } })).status).toBe(200)
  helper = await as('xiaoyang')
  expect((await getIncome(new Request('http://test.local/api/income?user=u-acheng', { headers: { cookie: helper.cookie } }), context)).status).toBe(403)
  expect(await summary(helper, order)).toEqual({ status: 200, body: { amount: 150, paid: 0, unpaid: 150, available: 150 } })
  expect((await summary(helper, order, '写手工资', 'u-xiao')).status).toBe(403)
  expect((await boss.act('role.save', { id: role.body.id, name: '结算汇总助手', perms: ['order.view', 'settle.manage'], fields, rowScope: 'owned' })).status).toBe(200)
  expect((await summary(helper, order)).status).toBe(404)
  expect((await summary(boss, 'missing-order')).status).toBe(404)
})

it('工资未定、自营、负毛利和前任销售历史已付分别保留准确金额', async () => {
  const pending = await create(null)
  expect((await summary(boss, pending)).body).toEqual({ amount: null, paid: 0, unpaid: 0, available: 0 })
  expect((await summary(boss, pending, '写手工资', 'u-xiao')).body).toEqual({ amount: null, paid: 0, unpaid: 0, available: 0 })
  const negative = await create(700)
  expect((await summary(boss, negative)).body).toEqual({ amount: 0, paid: 0, unpaid: 0, available: 0 })
  const reassigned = await create()
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: reassigned, kind: '销售提成', payeeId: 'u-acheng', amount: 50 })).status).toBe(200)
  expect((await boss.act('order.update', { id: reassigned, patch: { ownerId: 'u-boss' } })).status).toBe(200)
  expect((await summary(boss, reassigned)).body).toEqual({ amount: 50, paid: 50, unpaid: 0, available: 0 })
  expect((await summary(boss, reassigned, '销售提成', 'u-boss')).body).toEqual({ amount: 0, paid: 0, unpaid: 0, available: 0 })
})

it('写手可发额排除未交付追加工资和草稿，历史已付只计一次', async () => {
  const order = await create()
  expect((await summary(boss, order, '写手工资', 'u-xiao')).body).toEqual({ amount: 300, paid: 0, unpaid: 300, available: 0 })
  expect((await writer.act('order.markDraft', { id: order, proofIds: await deliveryProof(writer, order) })).status).toBe(200)
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: order, payeeId: 'u-xiao', amount: 100 })).status).toBe(200)
  expect((await boss.act('aftersale.create', { orderId: order, reason: '新增需求', req: ['补图'], writerId: 'u-xiao', extra: 80 })).status).toBe(200)
  expect((await boss.act('settle.save', { kind: '写手工资', payeeId: 'u-xiao', lines: [{ orderId: order, amount: 50 }] })).status).toBe(200)
  expect((await summary(boss, order, '写手工资', 'u-xiao')).body).toEqual({ amount: 380, paid: 100, unpaid: 280, available: 150 })
})
