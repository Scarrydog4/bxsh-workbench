import { beforeAll,afterAll,it,expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as,resetDb,closeDb,type Client } from './helpers'
import { GET as contractorsGet,POST as contractorsPost } from '@/app/api/contractors/route'
import { GET as exportGet } from '@/app/api/contractors/export/route'
import { GET as inquiriesGet,POST as inquiriesPost } from '@/app/api/inquiries/route'
import { POST as tokensPost,GET as tokensGet } from '@/app/api/agent/tokens/route'
import { POST as agentQuery } from '@/app/api/agent/query/route'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import ExcelJS from 'exceljs'
let boss:Client,sales:Client,other:Client,writer:Client,channel:string
beforeAll(async()=>{await resetDb();boss=await as('boss');sales=await as('acheng');other=await as('xiaoyang');writer=await as('xiaosenkai');channel=(await boss.act('channel.create',{name:'隔离渠道',ownerId:'u-acheng'})).body.id})
afterAll(closeDb)
async function call(handler:any,c:Client,body?:unknown,path='http://test.local/api/test'){
 const response=await handler(new Request(path,{method:body===undefined?'GET':'POST',headers:{cookie:c.cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({})})
 return {status:response.status,body:await response.json()}
}
const order=(title:string,patch={})=>({title,ownerId:'u-acheng',channelId:channel,basePrice:1000,orderDate:'2026-11-12',dueDate:'2026-11-25',...patch})
it('外包账按历史名称读取；改名不丢明细，付款不重复扣成本、不改工资；销售和写手均无权读取',async()=>{
 const id=randomUUID(),orderId=(await boss.act('order.create',order('外包测试'))).body.id
 expect((await boss.act('order.addCost',{id:orderId,requestId:randomUUID(),name:'设计外包',contractor:'工作室甲',amount:400,date:'2026-11-12'})).status).toBe(200)
 const protectedRows=JSON.stringify({payments:await db.select().from(t.payments),settlements:await db.select().from(t.settlements),writers:await db.select().from(t.orderWriters),costs:await db.select().from(t.orderCosts)})
 expect((await call(contractorsPost,boss,{action:'save',id,name:'工作室甲'})).status).toBe(200)
 const request={action:'pay',id:randomUUID(),contractorId:id,amount:150,date:'2026-11-12',note:'测试转账'}
 expect((await call(contractorsPost,boss,request)).status).toBe(200)
 expect((await call(contractorsPost,boss,request)).status).toBe(200)
 expect((await call(contractorsPost,boss,{action:'save',id,name:'工作室乙'})).status).toBe(200)
 const p=(await call(contractorsGet,boss)).body.rows[0]
 expect(p).toMatchObject({cost:400,paid:150,remaining:250});expect(p.lines[0].title).toBe('外包测试');expect(p.payments).toHaveLength(1)
 const xlsx=await exportGet(new Request(`http://test.local/api/contractors/export?id=${id}`,{headers:{cookie:boss.cookie}}),{params:Promise.resolve({})})
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as any)
 expect(book.worksheets[0].getRow(2).getCell(4).value).toBe('外包测试')
 expect(JSON.stringify({payments:await db.select().from(t.payments),settlements:await db.select().from(t.settlements),writers:await db.select().from(t.orderWriters),costs:await db.select().from(t.orderCosts)})).toBe(protectedRows)
 for(const c of [sales,writer])expect((await call(contractorsGet,c)).status).toBe(403)
 expect((await call(contractorsPost,boss,{action:'revoke',id:request.id,reason:'测试撤销'})).status).toBe(200)
 expect((await call(contractorsGet,boss)).body.rows[0]).toMatchObject({paid:0,remaining:400})
})
it('意向单隔离，不计订单；正式保存后原子转单，重复提交不新增第二单，跨销售不可查看和转换',async()=>{
 const id=randomUUID(),before=(await boss.boot()).body.orders.length
 expect((await call(inquiriesPost,sales,{action:'save',id,title:'待商量的机械',quote:800,channelId:channel})).status).toBe(200)
 expect((await boss.boot()).body.orders.length).toBe(before)
 expect((await call(inquiriesGet,other)).body.rows).toHaveLength(0)
 expect((await call(inquiriesGet,writer)).status).toBe(403)
 expect((await other.act('order.create',order('越权',{inquiryId:id}))).status).toBe(404)
 const converted=await sales.act('order.create',order('正式机械',{inquiryId:id}))
 expect(converted.status).toBe(200)
 expect((await sales.act('order.create',order('重复',{inquiryId:id}))).body.id).toBe(converted.body.id)
 expect((await boss.boot()).body.orders.length).toBe(before+1)
 expect((await call(inquiriesGet,sales)).body.rows[0]).toMatchObject({status:'converted',orderId:converted.body.id})
 expect((await call(inquiriesPost,sales,{action:'archive',id,status:'archived'})).status).toBe(400)
})
it('Agent 令牌仅查本人行和允许字段，不能用于写接口；收入需单独授权，撤销后立即拒绝',async()=>{
 const own=(await sales.act('order.create',order('阿城的专用订单'))).body.id
 const hidden=(await boss.act('order.create',order('小羊的私有订单',{ownerId:'u-yang',channelId:(await boss.act('channel.create',{name:'羊渠道',ownerId:'u-yang'})).body.id}))).body.id
 const token=(await call(tokensPost,sales,{action:'create',name:'测试 Agent',scopes:['orders'],days:7})).body
 expect(token.token).toMatch(/^bxsh_ro_/)
 const query=async(body:unknown)=>{const r=await agentQuery(new Request('http://test.local/api/agent/query',{method:'POST',headers:{authorization:`Bearer ${token.token}`,'content-type':'application/json'},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()}}
 const rows=(await query({tool:'orders_search'})).body.rows
 expect(rows.some((r:any)=>r.id===own)).toBe(true);expect(rows.some((r:any)=>r.id===hidden)).toBe(false)
 expect(rows.every((r:any)=>!('sales'in r)&&!('myPay'in r)&&!('profit'in r))).toBe(true)
 expect((await query({tool:'income_rows'})).status).toBe(403)
 const write=await fetchFakeAct(token.token,own);expect(write.status).toBe(401)
 expect(JSON.stringify((await call(tokensGet,sales)).body)).not.toContain(token.token)
 expect((await call(tokensPost,other,{action:'revoke',id:token.id})).status).toBe(200)
 expect((await query({tool:'orders_search'})).status).toBe(200)
 await call(tokensPost,sales,{action:'revoke',id:token.id})
 expect((await query({tool:'orders_search'})).status).toBe(401)
})
async function fetchFakeAct(token:string,id:string){const {POST}=await import('@/app/api/act/[name]/route');return POST(new Request('http://test.local/api/act/order.delete',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({ids:[id],reason:'must not delete'})}),{params:Promise.resolve({name:'order.delete'})})}
