import {beforeAll,afterAll,expect,it} from 'vitest'
import {as,resetDb,closeDb,type Client} from './helpers'
import {GET as bootstrap} from '@/app/api/bootstrap/route'
import {GET as orders} from '@/app/api/orders/route'
import {GET as income} from '@/app/api/income/route'
import {GET as events} from '@/app/api/events/route'
import {expandOrder} from '@/shared/order-wire'
let boss:Client,sales:Client,writer:Client,other:Client,id:string
const extra={params:Promise.resolve({})}
const request=(c:Client,path:string)=>new Request('http://test.local'+path,{headers:{cookie:c.cookie}})
beforeAll(async()=>{await resetDb();boss=await as('boss');sales=await as('acheng');writer=await as('xiaosenkai');other=await as('xiaoyang');const channelId=(await boss.act('channel.create',{name:'增量测试',ownerId:'u-acheng'})).body.id;id=(await boss.act('order.create',{title:'仅更新这条订单',channelId,ownerId:'u-acheng',orderDate:'2026-10-08',dueDate:null,basePrice:500,assignees:[{userId:'u-xiao',pay:100}]})).body.id})
afterAll(closeDb)
it('首屏不携带审计和收入明细，空字段恢复后含义不变',async()=>{const b=await(await bootstrap(request(boss,'/api/bootstrap'),extra)).json();expect(b.income).toEqual({});expect(b.audit).toEqual([]);const o=expandOrder(b.orders[0]);expect(o.note).toBe('');expect(o.afterSales).toEqual([]);expect(o.sales).toBe(500);expect(o.dueDate).toBe('2026-10-18');const w=await(await bootstrap(request(writer,'/api/bootstrap'),extra)).json();expect(expandOrder(w.orders[0]).sales).toBeUndefined()})
it('一条修改只获取所选订单，更新小于5KB，不泄露其他销售的订单',async()=>{const before=(await(await orders(request(boss,'/api/orders?ids='+id),extra)).json()).version;await sales.act('order.update',{id,patch:{type:'专科'}});const r=await orders(request(sales,'/api/orders?ids='+id),extra),text=await r.text(),data=JSON.parse(text);expect(data.version).toBeGreaterThan(before);expect(data.orders).toHaveLength(1);expect(data.orders[0].type).toBe('专科');expect(Buffer.byteLength(text)).toBeLessThan(5000);const hidden=await(await orders(request(other,'/api/orders?ids='+id),extra)).json();expect(hidden.orders).toEqual([]);expect(hidden.removed).toEqual([id])})
it('收入分页接口沿用角色与字段权限，增量能返回当前订单收入',async()=>{expect((await income(request(writer,'/api/income?user=u-boss'),extra)).status).toBe(403);const own=await(await income(request(sales,'/api/income?orders='+id),extra)).json();expect(own.rows).toHaveLength(1);expect(own.rows[0].kind).toBe('提成')})
it('实时事件只给有权限的人传订单id，改归属后旧销售能移除旧行',async()=>{const ctrl=new AbortController(),r=await events(new Request('http://test.local/api/events',{headers:{cookie:sales.cookie},signal:ctrl.signal}),extra),reader=r.body!.getReader();await reader.read();try{await boss.act('order.update',{id,patch:{ownerId:'u-yang'}});const data=new TextDecoder().decode((await reader.read()).value);expect(data).toContain(id);const removed=await(await orders(request(sales,'/api/orders?ids='+id),extra)).json();expect(removed.orders).toEqual([])}finally{ctrl.abort();await reader.cancel()}})
