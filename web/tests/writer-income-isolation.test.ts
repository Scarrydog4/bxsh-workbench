import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { as, closeDb, resetDb, type Client } from './helpers'
import { db, sql } from '@/server/db'
import { env } from '@/server/env'
import { settleBatches, settlements } from '@/server/schema'
import { GET as incomeGet } from '@/app/api/income/route'
import { GET as imageGet } from '@/app/api/settle/[id]/images/[hash]/route'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, xiao: Client, gold: Client
const ids: Record<string, string> = {}
const hash = 'e'.repeat(64)
const imagePath = path.join(env.storageDir, 'private-images', `${hash}.webp`)
const readIncome = (client: Client, user: string) => incomeGet(new Request(`http://test.local/api/income?user=${user}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({}) })
const readImage = (client: Client, id: string) => imageGet(new Request(`http://test.local/api/settle/${id}/images/${hash}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({ id, hash }) })

beforeAll(async () => {
  await resetDb()
  await sql`insert into users(id,name,account,password_hash,role_id,can_write,must_change_password)
    select 'u-gold','goldcode','goldcode',password_hash,'r-writer',true,false from users where id='u-xiao'`
  boss = await as('boss'); xiao = await as('xiaosenkai'); gold = await as('goldcode')
  const channelId = (await boss.act('channel.create', { name: '写手隔离验证', ownerId: 'u-boss' })).body.id
  for (const [key, title, assignees] of [
    ['shared', '两位写手共同订单', [{ userId: 'u-xiao', pay: 200 }, { userId: 'u-gold', pay: 100 }]],
    ['gold', 'goldcode 独立订单', [{ userId: 'u-gold', pay: 300 }]],
    ['xiao', '肖森凯独立订单', [{ userId: 'u-xiao', pay: 400 }]],
  ] as const) {
    const result = await boss.act('order.create', { title, orderDate: '2026-10-09', dueDate: null, ownerId: 'u-boss', channelId, basePrice: 1000, assignees })
    expect(result.status).toBe(200); ids[key] = result.body.id
  }
  for (const [id, payeeId, lines] of [
    ['gold-batch', 'u-gold', [['shared', 25], ['gold', 75]]],
    ['xiao-batch', 'u-xiao', [['shared', 80], ['xiao', 120]]],
  ] as const) {
    await db.insert(settleBatches).values({ id, no: id, kind: '写手工资', payeeId, status: '已确认', note: `${id} 备注`, shots: [`/api/settle/${id}/images/${hash}`], createdBy: 'u-boss', confirmedBy: 'u-boss', confirmedAt: '2026-10-15T04:00:00Z' })
    for (const [key, amount] of lines) await db.insert(settlements).values({ id: `${id}-${key}`, orderId: ids[key], kind: '写手工资', payeeId, amount, status: '已确认', batchId: id, confirmedAt: '2026-10-15T04:00:00Z' })
  }
  await mkdir(path.dirname(imagePath), { recursive: true })
  await writeFile(imagePath, await sharp({ create: { width: 2, height: 2, channels: 3, background: '#22aa44' } }).webp().toBuffer())
})
afterAll(async () => { await rm(imagePath, { force: true }); await closeDb() })

it('同角色写手只看本人订单和批次，共同订单也不混工资、每单名称和实发金额', async () => {
  for (const [client, userId, own, batchId, due, paid, amounts] of [
    [gold, 'u-gold', 'gold', 'gold-batch', 100, 25, [25, 75]],
    [xiao, 'u-xiao', 'xiao', 'xiao-batch', 200, 80, [80, 120]],
  ] as const) {
    const response = await client.boot(); expect(response.status).toBe(200)
    const { orders, batches, income } = response.body
    expect(orders.map((o: any) => o.id).sort()).toEqual([ids.shared, ids[own]].sort())
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ id: batchId, payeeId: userId, total: amounts[0] + amounts[1] })
    expect(batches[0].lines.map((line: any) => line.title)).toEqual(['两位写手共同订单', own === 'gold' ? 'goldcode 独立订单' : '肖森凯独立订单'])
    expect(batches[0].lines.map((line: any) => line.amount)).toEqual(amounts)
    const shared = orders.find((o: any) => o.id === ids.shared)
    expect(shared.myPay).toBe(due)
    expect(shared.assignees.find((w: any) => w.userId !== userId).pay).toBeUndefined()
    expect(shared.settlements.every((line: any) => line.payeeId === userId)).toBe(true)
    expect(income[userId].find((row: any) => row.id === ids.shared)).toMatchObject({ amount: due, settlement: { paid } })
    expect((await readIncome(client, userId === 'u-gold' ? 'u-xiao' : 'u-gold')).status).toBe(403)
  }
})

it('同角色写手不能读取对方批量发放截图，即使共同负责同一个订单', async () => {
  expect((await readImage(gold, 'gold-batch')).status).toBe(200)
  expect((await readImage(gold, 'xiao-batch')).status).toBe(404)
  expect((await readImage(xiao, 'xiao-batch')).status).toBe(200)
  expect((await readImage(xiao, 'gold-batch')).status).toBe(404)
})

it('转派订单后原写手保留自己的历史发放，接手写手不会继承原写手的已发金额', async () => {
  await sql`update order_writers set user_id='u-xiao' where order_id=${ids.gold} and user_id='u-gold'`
  const previous = (await gold.boot()).body
  expect(previous.orders.some((o: any) => o.id === ids.gold)).toBe(false)
  expect(previous.batches[0].lines.find((line: any) => line.orderId === ids.gold)).toMatchObject({ title: 'goldcode 独立订单', amount: 75 })
  expect(previous.income['u-gold'].find((row: any) => row.id === ids.gold)).toMatchObject({ kind: '已发工资', amount: 75, settlement: { paid: 75 } })
  const next = (await xiao.boot()).body
  expect(next.orders.some((o: any) => o.id === ids.gold)).toBe(true)
  expect(next.batches.map((batch: any) => batch.id)).toEqual(['xiao-batch'])
  expect(next.income['u-xiao'].find((row: any) => row.id === ids.gold)).toMatchObject({ settlement: { paid: 0 } })
})
