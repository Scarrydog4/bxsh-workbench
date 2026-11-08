import {afterEach,expect,it,vi} from 'vitest'
import type {Order,Role,User} from '@/shared/types'
import {cachedCalc,cachedProject} from '@/server/order-cache'
import {previewChange,previewTask} from '@/client/optimistic'
vi.mock('sonner',()=>({toast:{error:vi.fn()}}))
const order=():Order=>({id:'cache-order',no:'DD2610080001',title:'测试',orderDate:'2026-10-08',dueDate:null,ownerId:'sales',creatorId:'sales',channelId:'channel',channelNo:'',wechatGroup:'',draftAt:null,type:'',basePrice:1000,adjustments:[],assignees:[{userId:'a',pay:100},{userId:'b',pay:200}],status:'未交付',note:'',commissionRate:.5,payments:[],attachments:[],afterSales:[],settlements:[],req:{},nodes:[],receivables:[],reviewFlag:null,deletedAt:null})
const role:Role={id:'writer',name:'写手',preset:true,locked:false,perms:['order.view'],rowScope:'assigned',fields:{sales:false,writerPay:'own',commission:'none',profit:false,channelNo:false}}
const user=(id:string)=>({id} as User)
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules()})
it('未变化订单复用计算；收款变化、角色权限、本人身份和老板名单分别使对应缓存失效',()=>{
 const o=order(),admins=new Set(['boss']),c=cachedCalc(o,admins)
 expect(cachedCalc(structuredClone(o),admins)).toBe(c)
 const a=cachedProject(o,user('a'),role,admins),b=cachedProject(o,user('b'),role,admins)
 expect(a.myPay).toBe(100);expect(b.myPay).toBe(200);expect(a.assignees[1].pay).toBeUndefined();expect(b.assignees[0].pay).toBeUndefined()
 expect(cachedProject(o,user('a'),{...role,fields:{...role.fields,writerPay:'none'}},admins).myPay).toBeUndefined()
 o.payments.push({id:'payment',amount:250,date:'2026-10-08',tag:'定金',note:'',by:'sales'})
 expect(cachedCalc(o,admins).unpaid).toBe(750);expect(cachedCalc(o,admins)).not.toBe(c)
 expect(cachedCalc(o,new Set(['sales'])).commission).toBe(0)
})
it('确认时间立即反映在独立跟进列表，超时确认保留原截止',()=>{
 const now=Date.now(),a={id:'as',orderId:'o',due:new Date(now+86400000).toISOString(),confirmBy:new Date(now+3600000).toISOString(),doneAt:null} as any
 const preview=previewChange('aftersale.confirm',{orderId:'o',asId:'as',hours:4},'writer',now)!
 expect(previewTask(a,preview).due).toBe(new Date(now+4*3600000).toISOString())
 const expired={...a,confirmBy:new Date(now-1).toISOString()}
 expect(previewTask(expired,preview).due).toBe(a.due)
})
it.each(['rejected','offline'] as const)('跟进交付等待服务器确认，%s 后仍留在待办，重试成功才移除',async failure=>{
 const raw=order(),at='2026-10-26T12:00:00.000Z'
 raw.afterSales=[{id:'as',round:1,reason:'正常修改',req:['补充图注'],shots:[],start:at,due:at,doneAt:null,writerId:'a',by:'sales',files:[{id:'proof',name:'售后交付截图.png',size:100}],extra:0,nudges:0}]
 let canonical=cachedProject(raw,user('a'),role,new Set(['boss']))
 let reply!:(r:Response)=>void,fail!:(e:Error)=>void
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/bootstrap')return Response.json({me:{id:'a'},role,orders:[canonical],trash:[],notifications:[],users:[],channels:[],income:{},audit:[],version:1})
  if(url.includes('/api/orders?'))return Response.json({orders:[canonical],removed:[],notifications:[],unread:0,version:2})
  expect(url).toBe('/api/act/aftersale.finish')
  expect(JSON.parse(init!.body as string)).toEqual({orderId:raw.id,asId:'as',proofIds:['proof']})
  return new Promise<Response>((resolve,reject)=>{reply=resolve;fail=reject})
 }))
 const store=await import('@/client/store');await store.refresh()
 const task={...raw.afterSales[0],orderId:raw.id,no:raw.no,title:raw.title,channelId:raw.channelId,ownerId:raw.ownerId}
 const pending=store.finishAfterSale(raw.id,'as',['proof'])
 // 两种页面都不能先隐藏任务，否则嵌在任务内的截图草稿会被卸载。
 expect(store.getState().orders[0].afterSales[0].doneAt).toBeNull()
 expect(store.pendingAfterSaleTasks([task])[0].doneAt).toBeNull()
 if(failure==='rejected')reply(Response.json({error:'本次交付未确认'},{status:409}))
 else fail(new Error('network offline'))
 expect(await pending).toBe(false)
 expect(store.getState().orders[0].afterSales[0].doneAt).toBeNull()
 expect(store.pendingAfterSaleTasks([task])[0].doneAt).toBeNull()
 const retry=store.finishAfterSale(raw.id,'as',['proof'])
 expect(store.pendingAfterSaleTasks([task])[0].doneAt).toBeNull()
 canonical={...canonical,afterSales:canonical.afterSales.map(a=>({...a,doneAt:at}))}
 reply(Response.json({ok:true}));expect(await retry).toBe(true)
 expect(store.getState().orders[0].afterSales[0].doneAt).toBe(at)
 expect(store.pendingAfterSaleTasks([task])[0].doneAt).toBe(at)
})
it('记款立即显示，服务器先同步同一笔不重复；失败只回滚本次，保留并发成功状态',async()=>{
 const raw=order(),boss={...role,locked:true},view=cachedProject(raw,user('boss'),boss,new Set(['boss']))
 let canonical={...view},paymentReply!:(r:Response)=>void
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/bootstrap')return Response.json({me:{id:'boss'},role:boss,orders:[canonical],trash:[],notifications:[],users:[],channels:[],income:{},audit:[],version:1})
  if(url.includes('/api/orders?'))return Response.json({orders:[canonical],removed:[],notifications:[],unread:0,version:2})
  const body=JSON.parse(init!.body as string)
  if(url.endsWith('order.update')){canonical={...canonical,...body.patch};return Response.json({ok:true})}
  return new Promise<Response>(resolve=>{paymentReply=resolve})
 }))
 const store=await import('@/client/store');await store.refresh()
 const pending=store.addPayment(raw.id,{amount:300,date:'2026-10-08',tag:'定金',note:''})
 expect(store.getState().orders[0].unpaid).toBe(700)
 await store.updateOrder(raw.id,{status:'已交付'})
 expect(store.getState().orders[0].status).toBe('已交付');expect(store.getState().orders[0].unpaid).toBe(700)
 paymentReply(Response.json({error:'失败'},{status:409}));expect(await pending).toBe(false)
 expect(store.getState().orders[0].unpaid).toBe(1000);expect(store.getState().orders[0].status).toBe('已交付')
 const p=previewChange('order.addPayment',{id:raw.id,requestId:'test',amount:250,date:'2026-10-08',tag:'定金',note:''},'boss')!
 const next=p.order(canonical);expect(p.order(next).received).toBe(250)
 const hidden=cachedProject(raw,user('a'),role,new Set(['boss']));expect(p.order(hidden).sales).toBeUndefined()
})
