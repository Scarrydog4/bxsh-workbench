import { afterAll, beforeAll, expect, it } from 'vitest'
import { sql } from '@/server/db'
import { as, closeDb, resetDb, type Client } from './helpers'
import { migrateAndSeed } from '@/server/setup'

let boss: Client, sales: Client, writer: Client, channelId: string
const makeOrder = async (ownerId = 'u-acheng') => (await boss.act('order.create', {
  title: '删除理由测试', ownerId, channelId, orderDate: '2026-11-12', dueDate: null,
  basePrice: 100, type: '', note: '', assignees: [{ userId: 'u-xiao', pay: 20 }],
})).body.id as string

beforeAll(async () => {
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '删除测试渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

it('预置销售获得删除权限，空白理由被后端拒绝且订单不变', async () => {
  expect((await sales.boot()).body.role.perms).toContain('order.delete')
  const id = await makeOrder()
  for (const reason of [undefined, '', '   ']) {
    const r = await sales.act('order.delete', { ids: [id], reason })
    expect(r.status).toBe(400); expect(r.body.error).toBe('请填写删除理由')
  }
  expect((await sql`select deleted_at from orders where id=${id}`)[0].deleted_at).toBeNull()
})

it('批量删除逐单留理由、操作人与时间，可以恢复，原金额和收款仍保留', async () => {
  const ids = [await makeOrder(), await makeOrder()]
  expect((await sales.act('order.addPayment', { id: ids[0], requestId: crypto.randomUUID(), amount: 30, date: '2026-11-12', tag: '定金', note: '客户转账定金' })).status).toBe(200)
  expect((await sales.act('order.delete', { ids, reason: '  重复录入  ' })).status).toBe(200)
  const logs = await sql`select object_id,actor_id,note,at from audit where object_id in ${sql(ids)} and action='删除'`
  expect(logs).toHaveLength(2)
  for (const row of logs) { expect(row.actor_id).toBe('u-acheng'); expect(row.note).toBe('重复录入'); expect(row.at).toBeTruthy() }
  expect((await sales.act('order.restore', { ids })).status).toBe(200)
  expect((await sql`select base_price,deleted_at from orders where id=${ids[0]}`)[0]).toMatchObject({ base_price: '100.00', deleted_at: null })
  expect((await sql`select count(*)::int as n from payments where order_id=${ids[0]}`)[0].n).toBe(1)
})

it('混入别人的订单会整批回滚，写手没有删除权限', async () => {
  const own = await makeOrder(), foreign = await makeOrder('u-yang')
  expect((await sales.act('order.delete', { ids: [own, foreign], reason: '客户取消' })).status).toBe(404)
  expect((await sql`select deleted_at from orders where id=${own}`)[0].deleted_at).toBeNull()
  expect((await writer.act('order.delete', { ids: [own], reason: '客户取消' })).status).toBe(403)
  expect((await sales.act('order.delete', { ids: [own], reason: 'a'.repeat(501) })).status).toBe(400)
})

it('升级只补一次删除权限，之后尊重管理员手动关闭', async () => {
  await sql`update roles set perms=perms - 'order.delete' where id='r-sales'`
  await sql`update options set values=values - 'sales-delete-reason-20261112' where key='seeds'`
  await migrateAndSeed(sql)
  expect((await sql`select perms from roles where id='r-sales'`)[0].perms).toContain('order.delete')
  await sql`update roles set perms=perms - 'order.delete' where id='r-sales'`
  await migrateAndSeed(sql)
  expect((await sql`select perms from roles where id='r-sales'`)[0].perms).not.toContain('order.delete')
})
