import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { as, resetDb, closeDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { getCtx } from '@/server/session'
import { query } from '@/server/assistant/query'
import { POST as exportChannel } from '@/app/api/export/channel/route'
import { businessDate, iso, today } from '@/shared/format'

let boss: Client, sales: Client, writer: Client, channel: string
const ids: Record<string,string> = {}
beforeAll(async () => {
  await resetDb()
  await sql`update users set can_write=true where id='u-boss'`
  await sql`update users set commission_rate=0.1 where id='u-acheng'`
  boss=await as('boss'); sales=await as('acheng'); writer=await as('xiaosenkai')
  channel=(await boss.act('channel.create',{name:'对账渠道',ownerId:'u-acheng'})).body.id
  for(const [key,ownerId,userId,pay] of [['self','u-boss','u-boss',null],['bossWrite','u-acheng','u-boss',400],['pending','u-acheng','u-boss',null],['external','u-acheng','u-xiao',400]] as const) {
    const r=await boss.act('order.create',{title:key,channelId:channel,ownerId,orderDate:'2026-10-08',dueDate:null,type:'',basePrice:1000,assignees:[{userId,pay}]})
    expect(r.status).toBe(200); ids[key]=r.body.id
  }
})
afterAll(closeDb)
it('老板收入不扣自己的计价；销售提成仍按全部写作计价计算',async()=>{
  const boot=(await boss.boot()).body
  const order=(key:string)=>boot.orders.find((o:{id:string})=>o.id===ids[key])
  expect(order('self')).toMatchObject({bossIncome:1000,payPending:false})
  expect(order('bossWrite')).toMatchObject({commission:60,bossIncome:940,payPending:false})
  expect(order('external')).toMatchObject({commission:60,bossIncome:540})
  expect(order('pending').payPending).toBe(true)
  const ctx=(await getCtx(new Request('http://test.local',{headers:{cookie:boss.cookie}})))!
  expect(await query(ctx,'summarize_orders',{metric:'bossIncome'})).toMatchObject({groups:[{amount:2480,pending:1}]})
  expect(boot.income['u-boss'].filter((r:{id:string})=>r.id===ids.bossWrite)).toHaveLength(1)
  expect(boot.income['u-boss'].find((r:{id:string})=>r.id===ids.bossWrite)).toMatchObject({amount:940,date:'2026-10-08',kind:'订单收入'})
})
it('销售不能定工资；销售和写手收不到老板收入字段',async()=>{
  expect((await sales.act('order.setWriters',{id:ids.bossWrite,writers:[{userId:'u-boss',pay:100}]})).status).toBe(403)
  for(const client of [sales,writer]) {
    for(const o of (await client.boot()).body.orders) {
      expect(o).not.toHaveProperty('bossIncome'); expect(o).not.toHaveProperty('externalWriterTotal')
    }
  }
})
it('渠道改归属同步订单和未发提成，保留旧比例和已发提成',async()=>{
  await sql`insert into settlements(id,kind,payee_id,order_id,amount,status) values ('paid','销售提成','u-acheng',${ids.bossWrite},20,'已确认'),('draft','销售提成','u-acheng',${ids.bossWrite},40,'草稿')`
  await boss.act('order.delete',{ids:[ids.external]})
  expect((await boss.act('channel.update',{id:channel,patch:{ownerId:'u-yang'}})).status).toBe(200)
  await boss.act('order.restore',{ids:[ids.external]})
  const boot=(await boss.boot()).body
  expect(boot.orders.every((o:{ownerId:string})=>o.ownerId==='u-yang')).toBe(true)
  expect(boot.orders.find((o:{id:string})=>o.id===ids.bossWrite).commissionRate).toBe(0.1)
  expect((await sql`select payee_id from settlements where id='paid'`)[0].payee_id).toBe('u-acheng')
  expect((await sql`select payee_id from settlements where id='draft'`)[0].payee_id).toBe('u-yang')
  expect(boot.income['u-acheng'].find((r:{id:string})=>r.id===ids.bossWrite).amount).toBe(20)
  expect(boot.income['u-yang'].find((r:{id:string})=>r.id===ids.bossWrite).amount).toBe(40)
})
it('渠道导出双语两张表，退款为负，内部收入列不能导出',async()=>{
  await boss.act('order.addPayment',{id:ids.external,amount:300,date:'2026-10-08',tag:'定金',note:'测试定金'})
  await boss.act('order.addPayment',{id:ids.external,amount:50,date:'2026-10-08',tag:'退款',note:'退差价'})
  const request=(client:Client)=>new Request('http://test.local/api/export/channel',{method:'POST',headers:{cookie:client.cookie,'content-type':'application/json'},body:JSON.stringify({channelId:channel,language:'both',columns:['no','title','sales','received','unpaid','writerTotal','commission','bossIncome']})})
  const r=await exportChannel(request(boss),{params:Promise.resolve({})})
  expect(r.status).toBe(200)
  const book=new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await r.arrayBuffer()) as never)
  expect(book.worksheets.map(s=>s.name)).toEqual(['订单汇总','逐笔收款'])
  expect((book.worksheets[0].getRow(1).values as ExcelJS.CellValue[]).slice(1)).toEqual(['订单号','订单名称','应收','已收','未收'])
  expect((book.worksheets[0].getRow(2).values as ExcelJS.CellValue[]).slice(1)).toEqual(['Order No','Order Title','Amount Due','Received','Outstanding'])
  const amounts:unknown[]=[];book.worksheets[1].eachRow((row,n)=>{if(n>2&&typeof row.getCell(5).value==='number')amounts.push(row.getCell(5).value)})
  expect(amounts).toContain(-50); expect(amounts).toContain(300)
  expect((await exportChannel(request(writer),{params:Promise.resolve({})})).status).toBe(403)
})
it('待办和本月统计按北京时间跨天',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-07T16:30:00Z'))
  expect(iso(today())).toBe('2026-10-08');expect(businessDate(new Date())).toBe('2026-10-08')
  vi.useRealTimers()
})
