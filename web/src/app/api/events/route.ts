import { canReceiveForumEvent } from '@/server/forum-visibility'
import { bus,dataVersion,type ChangeEvent } from '@/server/events'
import { route } from '@/server/http'
import { getCtx } from '@/server/session'
import { loadWorld } from '@/server/repo'
import { db } from '@/server/db'
import { canSeeAfterSale } from '@/shared/after-sale-access'
import { can,rowVisible } from '@/shared/perm'
export const dynamic='force-dynamic'
export const GET=route(async(req,c)=>{
 const enc=new TextEncoder(),world=await loadWorld(db,{includeDeleted:true})
 let visible=new Set(can(c.role,'order.view')?world.orders.filter(o=>rowVisible(o,c.me,c.role)||o.afterSales.some(a=>canSeeAfterSale(o,a,c.me,c.role))).map(o=>o.id):[])
 let cleanup=()=>{},closed=false
 const stream=new ReadableStream({start(ctrl){
  const enqueue=(data:string)=>{if(!closed)ctrl.enqueue(enc.encode(data))}
  let queue=Promise.resolve()
  const send=(e:ChangeEvent)=>{queue=queue.then(async()=>{
   const current=await getCtx(req)
   if(!current){cleanup();try{ctrl.close()}catch{};return}
   if(e.resource){
    if(await canReceiveForumEvent(current,e))enqueue(`event: ${e.kind}\ndata: ${JSON.stringify({version:e.version,resource:e.resource})}\n\n`)
    return
   }
   const w=await loadWorld(db,{includeDeleted:true})
   const next=new Set(can(current.role,'order.view')?w.orders.filter(o=>rowVisible(o,current.me,current.role)||o.afterSales.some(a=>canSeeAfterSale(o,a,current.me,current.role))).map(o=>o.id):[])
   const ids=e.orderIds?.filter(id=>visible.has(id)||next.has(id))
   visible=next
   enqueue(`event: ${e.kind}\ndata: ${JSON.stringify({version:e.version,...(ids?{orderIds:ids}:{})})}\n\n`)
  }).catch(()=>{})}
  const ping=setInterval(()=>enqueue(': ping\n\n'),25000)
  bus.on('event',send)
  enqueue(`retry: 3000\nevent: hello\ndata: ${dataVersion()}\n\n`)
  cleanup=()=>{closed=true;clearInterval(ping);bus.off('event',send)}
  req.signal.addEventListener('abort',()=>{cleanup();try{ctrl.close()}catch{}})
 },cancel(){cleanup()}})
 return new Response(stream,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store',connection:'keep-alive','x-accel-buffering':'no'}})
})
