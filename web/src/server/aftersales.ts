import { and, eq, desc, like, isNull } from 'drizzle-orm'
import { db } from './db'
import * as t from './schema'
import { loadWorld } from './repo'
import type { Ctx } from './session'
import { canSeeAfterSale } from '@/shared/after-sale-access'
import type { AfterSaleTask } from '@/shared/aftersale-task'
export async function afterSaleTasks(c:Ctx):Promise<AfterSaleTask[]> {
  const w=await loadWorld(db)
  return w.orders.flatMap(o=>o.afterSales.filter(a=>canSeeAfterSale(o,a,c.me,c.role)).map(a=>({...a,extra:c.role.locked||c.role.fields.writerPay==='all'||c.role.fields.writerPay==='own'&&a.writerId===c.me.id?a.extra:undefined,orderId:o.id,no:o.no,title:o.title,channelId:o.channelId,ownerId:o.ownerId})))
}
export async function afterSaleTimeline(c:Ctx,id:string) {
  const a=(await afterSaleTasks(c)).find(a=>a.id===id)
  if(!a)return null
  const events=await db.select().from(t.audit).where(and(eq(t.audit.objectId,a.orderId),like(t.audit.field,`第 ${a.round} 轮%`),isNull(t.audit.fieldGroup))).orderBy(desc(t.audit.id)).limit(100)
  return {task:a,events:events.map(e=>({id:String(e.id),at:e.at,actorId:e.actorId,action:e.action,detail:e.to??''}))}
}
