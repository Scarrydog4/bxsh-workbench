import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'

let boss: Client, sales: Client, writer: Client, channelId: string
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '比例测试', ownerId: 'u-acheng' })).body.id
  await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })
})
afterAll(closeDb)
const base = () => ({ title: '写手自定义', ownerId: 'u-acheng', channelId, orderDate: '2026-10-22', dueDate: null, basePrice: 1000 })
async function create(patch: Record<string, unknown> = {}, client = boss) {
  const r = await client.act('order.create', { ...base(), ...patch }); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.id as string
}
const view = async (id: string) => (await boss.boot()).body.orders.find((o: any) => o.id === id)
async function snapshot(id: string) {
  const [r] = await sql`select row_to_json(o) as order_row,
    (select json_agg(w order by w.id) from order_writers w where w.order_id=o.id) as writers,
    (select json_agg(s order by s.id) from settlements s where s.order_id=o.id) as payouts
    from orders o where o.id=${id}`
  return r
}

it('默认比例仅用于新单，旧制度和固定20%旧单及已发流水原样保留', async () => {
  const legacy = await create({ assignees: [{ userId: 'u-xiao', pay: 160, rate: null }] })
  await sql`update orders set allocation_policy='legacy', commission_rate=0.5, writer_rates_enabled=false where id=${legacy}`
  await sql`update order_writers set rate=null where order_id=${legacy}`
  const fixed = await create()
  await sql`update orders set writer_rates_enabled=false where id=${fixed}`
  await sql`update order_writers set rate=null where order_id=${fixed}`
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: fixed, kind: '写手工资', payeeId: 'u-xiao', amount: 75 })).status).toBe(200)
  const before = await Promise.all([snapshot(legacy), snapshot(fixed)])
  expect((await boss.act('user.update', { id: 'u-xiao', patch: { writerRate: .25 } })).status).toBe(200)
  expect(await Promise.all([snapshot(legacy), snapshot(fixed)])).toEqual(before)
  expect(await view(legacy)).toMatchObject({ assignees: [{ pay: 160 }], commission: 420 })
  expect(await view(fixed)).toMatchObject({ assignees: [{ pay: 200 }], writerTotal: 200, bossIncome: 600 })
  const fresh = await create()
  expect(await view(fresh)).toMatchObject({ writerRatesEnabled: true, assignees: [{ pay: 250, rate: .25 }], commission: 200, bossIncome: 550 })
})

it('本单快照不随默认值改变；单独改比例不影响其他订单，金额与比例均可覆盖', async () => {
  const id = await create({ assignees: [{ userId: 'u-xiao', pay: null, rate: .3 }] })
  const other = await create()
  expect((await boss.act('user.update', { id: 'u-xiao', patch: { writerRate: .4 } })).status).toBe(200)
  expect((await view(id)).assignees[0]).toMatchObject({ pay: 300, rate: .3 })
  expect((await view(other)).assignees[0]).toMatchObject({ pay: 250, rate: .25 })
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', rate: .35 }] })).status).toBe(200)
  expect(await view(id)).toMatchObject({ assignees: [{ pay: 350, rate: .35 }], bossIncome: 450 })
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 280, rate: null }] })).status).toBe(200)
  expect((await boss.act('order.update', { id, patch: { basePrice: 1200 } })).status).toBe(200)
  expect((await view(id)).assignees[0]).toMatchObject({ pay: 280, rate: null })
})

it('多写手分别计价，改一人不重分其他人；老板自己写的部分仍归老板', async () => {
  const id = await create({ assignees: [{ userId: 'u-xiao', pay: null, rate: .25 }, { userId: 'u-boss', pay: null, rate: .1 }] })
  expect(await view(id)).toMatchObject({ writerTotal: 350, externalWriterTotal: 250, bossIncome: 550 })
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', rate: .3 }, { userId: 'u-boss' }] })).status).toBe(200)
  expect((await view(id)).assignees).toEqual([{ userId: 'u-xiao', pay: 300, rate: .3 }, { userId: 'u-boss', pay: 100, rate: .1 }])
  expect((await boss.act('order.addAdjustment', { id, amount: 100, reason: '加价' })).status).toBe(200)
  expect((await view(id)).assignees).toEqual([{ userId: 'u-xiao', pay: 330, rate: .3 }, { userId: 'u-boss', pay: 110, rate: .1 }])
})

it('销售录单由服务端套用默认，任何员工或被授予账号管理的角色均不能改比例工资', async () => {
  const id = await create({ assignees: [{ userId: 'u-xiao', pay: null }] }, sales)
  expect((await view(id)).assignees[0]).toMatchObject({ pay: 400, rate: .4 })
  for (const client of [sales, writer]) {
    expect((await client.act('user.update', { id: 'u-xiao', patch: { writerRate: .9 } })).status).toBe(403)
    expect((await client.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', rate: .9 }] })).status).toBe(403)
  }
  expect((await sales.act('order.create', { ...base(), assignees: [{ userId: 'u-xiao', pay: null, rate: .9 }] })).status).toBe(403)
  const boot = (await boss.boot()).body
  const delegated = boot.roles.find((r: any) => r.id === 'r-sales')
  expect((await boss.act('role.save', { ...delegated, perms: [...delegated.perms, 'role.manage', 'order.assign', 'audit.view'], fields: { ...delegated.fields, writerPay: 'all' } })).status).toBe(200)
  expect((await sales.act('user.update', { id: 'u-xiao', patch: { writerRate: .9 } })).status).toBe(403)
  expect((await sales.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 5 }] })).status).toBe(403)
  for (const client of [sales, writer]) {
    const b = (await client.boot()).body
    expect(b.users.every((u: any) => u.writerRate === undefined)).toBe(true)
    expect(b.audit.every((entry: any) => !['写手默认比例', '写手比例'].includes(entry.field))).toBe(true)
    expect((await client.activity(id)).body.every((entry: any) => entry.field !== '写手比例')).toBe(true)
    const o = b.orders.find((o: any) => o.id === id)
    expect(o.assignees[0].rate).toBeUndefined(); expect(o.writerRatesEnabled).toBeUndefined()
  }
})

it('0与小数比例正常计价；不合法比例拒绝；底价单没有销售提成', async () => {
  for (const rate of [-.1, 1.1, .12345]) expect((await boss.act('user.update', { id: 'u-xiao', patch: { writerRate: rate } })).status).toBe(400)
  const zero = await create({ assignees: [{ userId: 'u-xiao', pay: null, rate: 0 }] })
  expect((await view(zero)).assignees[0]).toMatchObject({ pay: 0, rate: 0 })
  const cost = await create({ salesMode: 'cost', basePrice: 100.01, assignees: [{ userId: 'u-xiao', pay: null, rate: .125 }] })
  expect(await view(cost)).toMatchObject({ commission: 0, bossIncome: 87.51, assignees: [{ pay: 12.5, rate: .125 }] })
})

it('已有发放不改写；不能把本单工资降到已发以下', async () => {
  const id = await create({ assignees: [{ userId: 'u-xiao', pay: null, rate: .3 }] })
  expect((await boss.act('settle.pay', { requestId: randomUUID(), orderId: id, kind: '写手工资', payeeId: 'u-xiao', amount: 150 })).status).toBe(200)
  const before = await snapshot(id)
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', rate: .1 }] })).status).toBe(400)
  expect(await snapshot(id)).toEqual(before)
  expect((await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', rate: .4 }] })).status).toBe(200)
  expect((await snapshot(id)).payouts).toEqual(before.payouts)
})
