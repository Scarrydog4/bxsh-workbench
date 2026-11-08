import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { as, closeDb, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { buildIncomeReport, incomeReportSelection } from '@/shared/income-report'
import { loadWorld, adminIdsOf } from '@/server/repo'
import { db } from '@/server/db'

let boss: Client, sales: Client, writer: Client, channelId: string, proof: string
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '成本验收', ownerId: 'u-acheng' })).body.id
  proof = 'data:image/png;base64,' + (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#456789' } }).png().toBuffer()).toString('base64')
  await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })
})
afterAll(closeDb)
const create = async (patch: Record<string, unknown> = {}) => {
  const r = await boss.act('order.create', { title: '外包成本验收', ownerId: 'u-acheng', channelId, orderDate: '2026-10-22', dueDate: null, basePrice: 1000, ...patch })
  expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.id as string
}
const view = async (id: string, client = boss) => (await client.boot()).body.orders.find((o: any) => o.id === id)
const cost = (id: string, amount = 300, extra = {}) => ({ id, requestId: randomUUID(), name: '实物外包', contractor: '外援工作室', amount, date: '2026-10-22', note: '含材料和制作', ...extra })

it('先扣外包费再计算写手和销售比例，原应收和实收不变；重试不重复记成本', async () => {
  const id = await create(), payload = cost(id, 300, { proof })
  expect((await boss.act('order.addPayment', { id, amount: 400, date: '2026-10-22', tag: '定金' })).status).toBe(200)
  for (let n = 0; n < 2; n++) expect((await boss.act('order.addCost', payload)).status).toBe(200)
  expect(await view(id)).toMatchObject({ sales: 1000, received: 400, unpaid: 600, extraCostTotal: 300, allocationBase: 700, assignees: [{ pay: 140 }], commission: 140, bossIncome: 420 })
  expect((await sql`select count(*)::int as n from order_costs where order_id=${id}`)[0].n).toBe(1)
  const w = await loadWorld(db), report = buildIncomeReport(w, adminIdsOf(w), incomeReportSelection({ dates: ['2026-10-22'] }))
  expect(report.orders.find(o => o.id === id)).toMatchObject({ extraCostTotal: 300, externalWriterCost: 140, commissionCost: 140, netIncome: 420, periodReceipts: 400 })
})

it('老板自写部分回归老板；多写手分别按本单比例，固定金额不变，底价单不产生销售提成', async () => {
  const id = await create({ assignees: [{ userId: 'u-boss', rate: .1, pay: null }, { userId: 'u-xiao', rate: .2, pay: null }] })
  await boss.act('order.addCost', cost(id))
  expect(await view(id)).toMatchObject({ assignees: [{ pay: 70 }, { pay: 140 }], commission: 140, bossIncome: 420 })
  const fixed = await create({ assignees: [{ userId: 'u-xiao', pay: 80, rate: null }] })
  await boss.act('order.addCost', cost(fixed))
  expect(await view(fixed)).toMatchObject({ assignees: [{ pay: 80, rate: null }], commission: 140, bossIncome: 480 })
  const base = await create({ salesMode: 'cost', assignees: [{ userId: 'u-xiao', pay: 80, rate: null }] })
  await boss.act('order.addCost', cost(base))
  expect(await view(base)).toMatchObject({ commission: 0, bossIncome: 620 })
})

it('旧制按扣成本和工资后的余额分成；无成本旧单原样，新成本超售价显示亏损而非负工资', async () => {
  const id = await create({ assignees: [{ userId: 'u-xiao', pay: 80, rate: null }] })
  await sql`update orders set allocation_policy='legacy', commission_rate=0.5 where id=${id}`
  expect(await view(id)).toMatchObject({ commission: 460, bossIncome: 460 })
  await boss.act('order.addCost', cost(id))
  expect(await view(id)).toMatchObject({ commission: 310, bossIncome: 310 })
  const loss = await create()
  await boss.act('order.addCost', cost(loss, 1200))
  expect(await view(loss)).toMatchObject({ allocationBase: 0, assignees: [{ pay: 0 }], commission: 0, bossIncome: -200 })
})

it('撤销留痕并恢复分成，后续改价按扣成本后的基数重算，不复用旧基数', async () => {
  const id = await create(), added = await boss.act('order.addCost', cost(id))
  await boss.act('order.addAdjustment', { id, amount: 100, reason: '加价' })
  expect(await view(id)).toMatchObject({ sales: 1100, assignees: [{ pay: 160 }], commission: 160, bossIncome: 480 })
  expect((await boss.act('order.revokeCost', { id, costId: added.body.id, reason: '外包取消' })).status).toBe(200)
  expect(await view(id)).toMatchObject({ extraCostTotal: 0, assignees: [{ pay: 220 }], commission: 220, bossIncome: 660, extraCosts: [{ amount: 300, revoked: { reason: '外包取消' } }] })
  expect((await boss.activity(id)).body.some((a: any) => a.action === '撤销成本')).toBe(true)
})

it('员工看不到外包成本及凭证，不能从订单动态、普通附件或金额操作旁路访问', async () => {
  const id = await create()
  await boss.act('order.addCost', cost(id, 300, { proof }))
  const own = await view(id), fileId = own.extraCosts[0].proof.split('/')[3].split('?')[0]
  expect((await boss.file(fileId)).status).toBe(200)
  for (const client of [sales, writer]) {
    const row = await view(id, client)
    expect(row).not.toHaveProperty('extraCosts'); expect(row).not.toHaveProperty('extraCostTotal'); expect(row).not.toHaveProperty('allocationBase')
    expect(row.attachments).toEqual([])
    expect((await client.activity(id)).body.some((a: any) => a.field === '额外成本')).toBe(false)
    expect((await client.file(fileId)).status).toBe(404)
    expect((await client.act('order.addCost', cost(id))).status).toBe(403)
    expect((await client.act('order.revokeCost', { id, costId: own.extraCosts[0].id, reason: '越权' })).status).toBe(403)
  }
})

it('非法金额日期和图片不会留下成本或改变工资', async () => {
  const id = await create()
  for (const patch of [{ amount: 0 }, { amount: -.01 }, { amount: 1.001 }, { date: '2026-02-30' }, { proof: 'data:image/png;base64,aW52YWxpZA==' }]) expect((await boss.act('order.addCost', cost(id, 300, patch))).status).toBe(400)
  expect(await view(id)).toMatchObject({ extraCostTotal: 0, assignees: [{ pay: 200 }], bossIncome: 600 })
})

it('补记成本重算约定但不改实发，不重复付款；多发差额计入老板成本，固定工资保留', async () => {
  const id = await create()
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: id, kind: '写手工资', payeeId: 'u-xiao', amount: 200 })).status).toBe(200)
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: id, kind: '销售提成', payeeId: 'u-acheng', amount: 200 })).status).toBe(200)
  const before = await sql`select row_to_json(s) as row from settlements s where order_id=${id} order by id`
  await boss.act('order.addCost', cost(id))
  expect(await sql`select row_to_json(s) as row from settlements s where order_id=${id} order by id`).toEqual(before)
  expect(await view(id)).toMatchObject({ assignees: [{ pay: 140 }], commission: 140, bossIncome: 300, settlements: [{ amount: 200 }, { amount: 200 }] })
  const boot = (await boss.boot()).body
  const wages = boot.income['u-xiao'].find((r: any) => r.id === id)
  expect(wages).toMatchObject({ due: 140, paid: 200, over: 60 })
  const fixed = await create({ assignees: [{ userId: 'u-xiao', pay: 80, rate: null }] })
  await boss.act('settle.pay', { requestId: randomUUID(), orderId: fixed, kind: '写手工资', payeeId: 'u-xiao', amount: 80 })
  await boss.act('order.addCost', cost(fixed))
  expect(await view(fixed)).toMatchObject({ assignees: [{ pay: 80 }], bossIncome: 480, settlements: [{ amount: 80 }] })
})
