import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { runJobs } from '@/server/jobs'
import { GET as list } from '@/app/api/aftersales/route'
import { GET as timeline } from '@/app/api/aftersales/[id]/route'
import { deliveryProof, as, resetDb, closeDb, type Client } from './helpers'
let boss:Client,sales:Client,writer:Client,other:Client,channelId:string
const hour=3600_000
beforeAll(async()=>{await resetDb();boss=await as('boss');sales=await as('acheng');writer=await as('xiaosenkai');other=await as('xiaoyang');channelId=(await boss.act('channel.create',{name:'售后验收',ownerId:'u-acheng'})).body.id})
afterEach(()=>vi.useRealTimers())
afterAll(closeDb)
async function create(){const o=await sales.act('order.create',{title:'售后时效验证',channelId,orderDate:'2026-10-08',dueDate:null,ownerId:'u-acheng',basePrice:500});expect(o.status).toBe(200);const a=await sales.act('aftersale.create',{orderId:o.body.id,req:['修改目录']});expect(a.status).toBe(200);return{orderId:o.body.id,asId:a.body.id}}
async function task(id:string){return (await db.select().from(t.afterSales).where(eq(t.afterSales.id,id)))[0]}
async function notes(orderId:string,kind:string){return (await db.select().from(t.notifications).where(and(eq(t.notifications.orderId,orderId),eq(t.notifications.kind,kind)))).map(n=>n.userId).sort()}
async function events(who:Client,id:string){const r=await timeline(new Request('http://test.local/api/aftersales/'+id,{headers:{cookie:who.cookie}}),{params:Promise.resolve({id})});return{status:r.status,...await r.json()}}
function at(time:number){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(time)}
it('确认按钮从确认时刻计时，重试不重复；按时交付通知发单人',async()=>{
 const ids=await create(),a=await task(ids.asId),now=new Date(a.start).getTime()+30*60000
 expect(await notes(ids.orderId,'新售后')).toEqual(['u-xiao'])
 at(now);expect((await writer.act('aftersale.confirm',{...ids,hours:4})).status).toBe(200)
 at(now+1000);expect((await writer.act('aftersale.confirm',{...ids,hours:4})).status).toBe(200)
 const b=await task(ids.asId);expect(b.chosenHours).toBe(4);expect(new Date(b.due).getTime()).toBe(now+4*hour)
 expect(await notes(ids.orderId,'售后已确认')).toEqual(['u-acheng'])
 at(now+3*hour);expect((await writer.act('aftersale.finish',{...ids,proofIds:await deliveryProof(writer,ids.orderId,ids.asId)})).status).toBe(200)
 expect((await task(ids.asId)).deliveredLateMin).toBe(0)
 expect(await notes(ids.orderId,'售后已交付')).toEqual(['u-acheng'])
 const e=await events(sales,ids.asId);expect(e.events.filter((x:any)=>x.action==='确认完成时间')).toHaveLength(1);expect(e.events.some((x:any)=>x.detail==='按时交付')).toBe(true)
})
it('15分钟提醒一次；超时未确认和逾期无人在线仍落库一次，提醒四类人员',async()=>{
 const ids=await create(),a=await task(ids.asId),start=new Date(a.start).getTime()
 await boss.act('order.update',{id:ids.orderId,patch:{ownerId:'u-yang'}})
 await runJobs(new Date(start+45*60000));await runJobs(new Date(start+50*60000))
 expect(await notes(ids.orderId,'售后待确认')).toEqual(['u-xiao'])
 await runJobs(new Date(start+hour));await runJobs(new Date(start+2*hour))
 expect((await task(ids.asId)).lateConfirm).toBe(true)
 expect(await notes(ids.orderId,'超时未确认')).toEqual(['u-acheng','u-boss','u-xiao','u-yang'])
 await runJobs(new Date(start+23*hour));await runJobs(new Date(start+23.5*hour))
 expect(await notes(ids.orderId,'售后到期')).toEqual(['u-xiao'])
 await runJobs(new Date(start+24*hour));await runJobs(new Date(start+25*hour))
 expect(await notes(ids.orderId,'售后逾期')).toEqual(['u-acheng','u-boss','u-xiao','u-yang'])
 const e=await events(sales,ids.asId);expect(e.status).toBe(200);expect(e.events.filter((x:any)=>x.action==='超时未确认')).toHaveLength(1);expect(e.events.filter((x:any)=>x.action==='逾期未交付')).toHaveLength(1)
 at(start+25*hour);expect((await writer.act('aftersale.confirm',{...ids,hours:8})).status).toBe(200)
 expect((await task(ids.asId)).due).toBe(a.due)
 expect((await writer.act('aftersale.finish',{...ids,proofIds:await deliveryProof(writer,ids.orderId,ids.asId)})).status).toBe(200)
 expect((await task(ids.asId)).deliveredLateMin).toBe(60)
 expect(await notes(ids.orderId,'售后已交付')).toEqual(['u-acheng','u-yang'])
})
it('截止前确认后逾期交付补记时效，销售不能代交',async()=>{
 const ids=await create(),a=await task(ids.asId),start=new Date(a.start).getTime()
 at(start+10*60000);await writer.act('aftersale.confirm',{...ids,hours:2})
 at(start+3*hour);expect((await sales.act('aftersale.finish',ids)).status).toBe(403)
 expect((await writer.act('aftersale.finish',{...ids,proofIds:await deliveryProof(writer,ids.orderId,ids.asId)})).status).toBe(200)
 const b=await task(ids.asId);expect(b.deliveredLateMin).toBe(50);expect(b.overdueAt).toBeTruthy();expect(b.lateConfirm).toBe(false)
})
it('未确认可撤回再发；已确认不可撤回；他人不可见',async()=>{
 const ids=await create();expect((await other.act('aftersale.recall',ids)).status).toBe(404)
 expect((await sales.act('aftersale.recall',ids)).status).toBe(200)
 expect((await task(ids.asId)).cancelledAt).toBeTruthy()
 const second=await sales.act('aftersale.create',{orderId:ids.orderId,req:['新意见']});expect(second.status).toBe(200);expect(second.body.round).toBe(2)
 await writer.act('aftersale.confirm',{orderId:ids.orderId,asId:second.body.id,hours:2})
 expect((await sales.act('aftersale.recall',{orderId:ids.orderId,asId:second.body.id})).status).toBe(400)
 expect((await events(other,second.body.id)).status).toBe(404)
 const r=await list(new Request('http://test.local/api/aftersales',{headers:{cookie:writer.cookie}}),{params:Promise.resolve({})});const data=await r.json();expect(data.tasks.every((a:any)=>a.writerId==='u-xiao'&&a.sales===undefined)).toBe(true)
})

it('空写手订单可在发布售后时指定负责人，权限和工资由订单分配规则处理', async()=>{
 const r=await boss.act('order.create',{title:'空写手售后',channelId,orderDate:'2026-10-22',dueDate:null,ownerId:'u-acheng',basePrice:1000,assignees:[],urgent:true,urgencyNote:'优先处理'})
 const id=r.body.id
 expect((await other.act('aftersale.create',{orderId:id,req:['修改目录'],writerId:'u-xiao'})).status).toBe(404)
 expect((await sales.act('aftersale.create',{orderId:id,req:['修改目录'],writerId:'u-xiao',shots:['data:image/png;base64,aW52YWxpZA==']})).status).toBe(400)
 expect(await db.select().from(t.orderWriters).where(eq(t.orderWriters.orderId,id))).toHaveLength(0)
 const sent=await sales.act('aftersale.create',{orderId:id,req:['修改目录'],writerId:'u-xiao'})
 expect(sent.status).toBe(200)
 expect((await task(sent.body.id)).writerId).toBe('u-xiao')
 expect(await db.select().from(t.orderWriters).where(eq(t.orderWriters.orderId,id))).toMatchObject([{userId:'u-xiao',pay:200,rate:.2}])
 const boot=(await writer.boot()).body
 expect(boot.orders.some((o:any)=>o.id===id)).toBe(true)
 expect(boot.notifications.some((n:any)=>n.orderId===id&&n.kind==='订单加急'&&n.title.startsWith('加急：'))).toBe(true)
})


it('写手可给自己的订单上传跟进和截图，不开放他人订单或定工资权限', async () => {
 const own = await boss.act('order.create', {title:'写手自行登记跟进',channelId,ownerId:'u-acheng',orderDate:'2026-11-06',dueDate:null,basePrice:500,assignees:[{userId:'u-xiao',pay:100}]})
 expect(own.status).toBe(200)
 const id = own.body.id, before = await db.select().from(t.settlements)
 expect((await writer.act('aftersale.create',{orderId:id,req:['追加说明'],reason:'新增需求',extra:99})).status).toBe(403)
 const otherOrder = await boss.act('order.create',{title:'其他人的订单',channelId,ownerId:'u-boss',orderDate:'2026-11-06',dueDate:null,basePrice:300,assignees:[]})
 expect((await writer.act('aftersale.create',{orderId:otherOrder.body.id,req:['不能跨单']})).status).toBe(404)
 const sent = await writer.act('aftersale.create',{orderId:id,req:['群内补充了修改要求'],shots:['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII=']})
 expect(sent.status).toBe(200)
 const saved = await task(sent.body.id)
 expect(saved).toMatchObject({by:'u-xiao',writerId:'u-xiao',req:['群内补充了修改要求'],extra:0})
 expect(saved.shots).toHaveLength(1)
 expect((await writer.act('aftersale.create',{orderId:id,req:['不能重复开轮次']})).status).toBe(400)
 expect(await db.select().from(t.settlements)).toEqual(before)
})
