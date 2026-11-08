import { afterAll, beforeAll, expect, it } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { db, sql } from '@/server/db'
import { settleBatches, settlements } from '@/server/schema'
import { GET as personalReport } from '@/app/api/reports/personal-income/route'

let boss: Client, writer: Client, orderId: string
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); writer = await as('xiaosenkai')
  const channelId = (await boss.act('channel.create',{name:'日期验收',ownerId:'u-boss'})).body.id
  const order = await boss.act('order.create',{title:'日期验收订单',orderDate:'2026-10-09',dueDate:null,channelId,ownerId:'u-boss',basePrice:1000,assignees:[{userId:'u-xiao',pay:200}]})
  expect(order.status).toBe(200); orderId = order.body.id
  await db.insert(settlements).values({id:'old-payment',orderId,kind:'写手工资',payeeId:'u-xiao',amount:80,status:'已确认',migrated:true,note:'飞书迁移'})
})
afterAll(closeDb)
const report = async () => {
  const r = await personalReport(new Request('http://test.local/api/reports/personal-income?from=2026-10-09&to=2026-10-09&granularity=day',{headers:{cookie:writer.cookie}}),{params:Promise.resolve({})})
  expect(r.status).toBe(200); return r.json()
}
it('仅管理员按真实日期逐笔补记；金额、状态不变，日期纳入报表并保留审计', async () => {
  const input = {id:'history:old-payment',date:'2026-10-09',reason:'核对转账记录'}
  expect((await writer.act('settle.date',input)).status).toBe(403)
  expect((await boss.act('settle.date',{...input,date:'2026-02-30'})).status).toBe(400)
  expect((await boss.act('settle.date',{...input,date:'2099-01-01'})).status).toBe(400)
  expect((await boss.act('settle.date',{...input,reason:' '})).status).toBe(400)
  expect(await report()).toMatchObject({undatedPaid:80,summary:{paid:0}})
  expect((await boss.act('settle.date',input)).status).toBe(200)
  expect((await boss.act('settle.date',input)).status).toBe(200)
  expect((await boss.act('settle.date',{...input,date:'2026-10-10'})).status).toBe(400)
  const [line] = await sql`select amount, status, confirmed_at, confirmed_date::text from settlements where id='old-payment'`
  expect(line).toEqual({amount:'80.00',status:'已确认',confirmed_at:null,confirmed_date:'2026-10-09'})
  expect(await report()).toMatchObject({undatedPaid:0,undatedCount:0,summary:{paid:80},hourly:{unknown:{paid:80}}})
  const audits = await sql`select actor_id, from_value as "from", to_value as "to", note from audit where action='补记发放日期'`
  expect(audits).toEqual([{actor_id:'u-boss',from:'未记录',to:input.date,note:input.reason}])
})
it('缺日期批次同步补记所有明细，不允许修改草稿、作废或已有日期的记录', async () => {
  const input = {id:'unknown-batch',date:'2026-10-08',reason:'已核对批量转账'}
  await db.insert(settleBatches).values({id:input.id,no:'JS-test-date',kind:'写手工资',payeeId:'u-xiao',status:'已确认',createdBy:'u-boss'})
  await db.insert(settlements).values({id:'batch-line',batchId:input.id,orderId,kind:'写手工资',payeeId:'u-xiao',amount:20,status:'已确认'})
  expect((await boss.act('settle.date',input)).status).toBe(200)
  const [batch] = await sql`select confirmed_at, confirmed_date::text from settle_batches where id=${input.id}`
  const [line] = await sql`select amount, confirmed_at, confirmed_date::text from settlements where id='batch-line'`
  expect(batch).toEqual({confirmed_at:null,confirmed_date:input.date})
  expect(line).toEqual({amount:'20.00',confirmed_at:null,confirmed_date:input.date})
  for (const status of ['草稿','已作废']) {
    await db.insert(settlements).values({id:status,orderId,kind:'写手工资',payeeId:'u-xiao',amount:2,status})
    expect((await boss.act('settle.date',{...input,id:'history:'+status})).status).toBe(400)
  }
  expect((await boss.act('settle.date',{...input,id:'history:batch-line'})).status).toBe(404)
})
