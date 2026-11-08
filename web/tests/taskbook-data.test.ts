import { beforeAll, afterAll, expect, it } from 'vitest'
import { as, resetDb, closeDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { receiptTotals } from '@/shared/receipts'
import { deadlineFrom } from '@/shared/format'
let boss: Client, sales: Client, channel: string, id: string
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); sales = await as('acheng')
  channel = (await boss.act('channel.create', {name:'阶段一渠道',ownerId:'u-acheng'})).body.id
  id = (await boss.act('order.create',{title:'跨月默认期限',orderDate:'2026-12-28',dueDate:null,channelId:channel,ownerId:'u-acheng',basePrice:100,assignees:[{userId:'u-xiao',pay:0}]})).body.id
})
afterAll(closeDb)
it('新订单跨年默认10天，0工资保留，清空截止日期拒绝', async () => {
  expect(deadlineFrom('2028-02-22')).toBe('2028-03-03')
  expect((await boss.boot()).body.orders.find((o:{id:string})=>o.id===id)).toMatchObject({dueDate:'2027-01-07',assignees:[{userId:'u-xiao',pay:0}]})
  expect((await boss.act('order.update',{id,patch:{dueDate:null}})).status).toBe(400)
})
it('无变化的订单、渠道和写手提交不写库、不写审计', async () => {
  const [before]=await sql`select updated_at from orders where id=${id}`
  const [{n}]=await sql`select count(*)::int as n from audit`
  await boss.act('order.update',{id,patch:{title:'跨月默认期限',note:''}})
  await boss.act('channel.update',{id:channel,patch:{ownerId:'u-acheng',note:''}})
  await boss.act('order.setWriters',{id,writers:[{userId:'u-xiao',pay:0}]})
  expect((await sql`select count(*)::int as n from audit`)[0].n).toBe(n)
  expect((await sql`select updated_at from orders where id=${id}`)[0].updated_at).toEqual(before.updated_at)
})
it('转交预览包含回收站与已结算数，预览本身不修改；确认后同步订单归属', async () => {
  await sql`insert into settlements(id,order_id,kind,payee_id,amount,status) values('old-settle',${id},'写手工资','u-xiao',0,'已发放')`
  await boss.act('order.delete',{ids:[id]})
  expect((await boss.act('channel.transferPreview',{id:channel})).body).toEqual({count:1,settled:1})
  expect((await sql`select owner_id from orders where id=${id}`)[0].owner_id).toBe('u-acheng')
  expect((await sales.act('channel.transferPreview',{id:channel})).status).toBe(403)
  expect((await boss.act('channel.update',{id:channel,patch:{ownerId:'u-yang'}})).status).toBe(200)
  expect((await sql`select owner_id from orders where id=${id}`)[0].owner_id).toBe('u-yang')
})
it('渠道合并软删除并可恢复，已转移订单仍留在接收渠道，恢复权限受控', async () => {
  const target=(await boss.act('channel.create',{name:'阶段一接收渠道',ownerId:'u-yang'})).body.id
  expect((await boss.act('channel.delete',{id:channel,targetId:target})).status).toBe(200)
  let boot=(await boss.boot()).body
  expect(boot.channels.some((c:{id:string})=>c.id===channel)).toBe(false)
  expect(boot.trashChannels.some((c:{id:string})=>c.id===channel)).toBe(true)
  expect((await sales.boot()).body.trashChannels).toEqual([])
  expect((await sales.act('channel.restore',{id:channel})).status).toBe(403)
  expect((await boss.act('channel.restore',{id:channel})).status).toBe(200)
  boot=(await boss.boot()).body
  expect(boot.channels.some((c:{id:string})=>c.id===channel)).toBe(true)
  expect(boot.trashChannels).toEqual([])
  expect((await sql`select channel_id from orders where id=${id}`)[0].channel_id).toBe(target)
})
it('待收和多收分别累加，包含小数，不被退单金额干扰', () => {
  expect(receiptTotals([{status:'未交付',unpaid:100.1},{status:'已交付',unpaid:-90.2},{status:'已交付',unpaid:0.2},{status:'退单',unpaid:10000}])).toEqual({unpaid:100.3,overpaid:90.2})
})
