import {beforeAll,afterAll,expect,it} from 'vitest'
import {as,resetDb,closeDb,type Client} from './helpers'
let boss:Client,sales:Client,writer:Client,channelId:string
beforeAll(async()=>{await resetDb();boss=await as('boss');sales=await as('acheng');writer=await as('xiaosenkai');channelId=(await boss.act('channel.create',{name:'批量写手验收',ownerId:'u-acheng'})).body.id;await boss.act('user.update',{id:'u-boss',patch:{canWrite:true}})})
afterAll(closeDb)
it('有分配权限录单明确清空保持未指定，省略写手仍默认分配',async()=>{
 const base={title:'清空默认写手',channelId,ownerId:'u-acheng',orderDate:'2026-10-08',dueDate:null,basePrice:500}
 const cleared=await boss.act('order.create',{...base,assignees:[]})
 const omitted=await boss.act('order.create',{...base,title:'省略写手字段'})
 expect(cleared.status).toBe(200);expect(omitted.status).toBe(200)
 const boot=(await boss.boot()).body
 expect(boot.orders.find((o:any)=>o.id===cleared.body.id).assignees).toEqual([])
 expect(boot.orders.find((o:any)=>o.id===omitted.body.id).assignees).toEqual([{userId:'u-xiao',pay:100,rate:.2}])
})
it('销售录单可以选写手或不指定，但填的工资不算、归属仍是自己',async()=>{
 const base={title:'销售选写手',channelId,ownerId:'u-boss',orderDate:'2026-10-08',dueDate:null,basePrice:500}
 const ids:string[]=[]
 for(const override of [{},{assignees:[]},{assignees:[{userId:'u-boss',pay:null}]}]){
  const result=await sales.act('order.create',{...base,...override})
  expect(result.status).toBe(200);ids.push(result.body.id)
 }
 const boot=(await boss.boot()).body
 const [omitted,cleared,picked]=ids.map(id=>boot.orders.find((o:any)=>o.id===id))
 for(const o of [omitted,cleared,picked])expect(o.ownerId).toBe('u-acheng')
 expect(omitted.assignees.map((a:any)=>a.userId)).toEqual(['u-xiao'])
 expect(cleared.assignees).toEqual([])
 expect(picked.assignees.map((a:any)=>a.userId)).toEqual(['u-boss'])
 expect(picked.assignees[0].pay).not.toBe(999)
})
async function order(title:string){return (await boss.act('order.create',{title,channelId,ownerId:'u-acheng',orderDate:'2026-10-08',dueDate:null,basePrice:500,assignees:[{userId:'u-xiao',pay:120}]})).body.id as string}
it('销售不能批量定写手；老板替换后套用默认比例，同一写手保留原工资',async()=>{
 const a=await order('批量一'),b=await order('批量二')
 expect((await sales.act('order.bulkWriters',{ids:[a,b],writerId:'u-boss'})).status).toBe(403)
 const keep=await boss.act('order.bulkWriters',{ids:[a],writerId:'u-xiao'});expect(keep.status).toBe(200)
 expect((await boss.boot()).body.orders.find((o:any)=>o.id===a).assignees[0].pay).toBe(120)
 expect((await boss.act('order.bulkWriters',{ids:[a,b],writerId:'u-boss'})).body.count).toBe(2)
 const boot=(await boss.boot()).body;for(const id of [a,b])expect(boot.orders.find((o:any)=>o.id===id).assignees).toEqual([{userId:'u-boss',pay:100,rate:.2}])
})
it('仍有原写手负责的售后时整批撤回，不留下半批修改',async()=>{
 const a=await order('可更换'),b=await order('有售后')
 expect((await sales.act('aftersale.create',{orderId:b,req:['修改目录']})).status).toBe(200)
 expect((await boss.act('order.bulkWriters',{ids:[a,b],writerId:'u-boss'})).status).toBe(400)
 const boot=(await boss.boot()).body;for(const id of[a,b])expect(boot.orders.find((o:any)=>o.id===id).assignees[0].userId).toBe('u-xiao')
})
