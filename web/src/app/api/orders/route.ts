import { forumNotificationVisibility } from '@/server/forum-visibility'
import { cachedProject as project } from '@/server/order-cache'
import { and,desc,eq,isNull,sql } from 'drizzle-orm'
import { route,json,bad } from '@/server/http'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { loadWorld,adminIdsOf } from '@/server/repo'
import { can,rowVisible } from '@/shared/perm'
import { orderChannelLabels } from '@/shared/channel-access'
import { compactOrder } from '@/shared/order-wire'
import { dataVersion } from '@/server/events'
export const GET=route(async(req,c)=>{
 const ids=[...new Set((new URL(req.url).searchParams.get('ids')??'').split(',').filter(Boolean))]
 if(!ids.length||ids.length>200)throw bad('请选择 1–200 条订单')
 const version=dataVersion(),w=await loadWorld(db,{includeDeleted:true}),wanted=new Set(ids),admins=adminIdsOf(w)
 const orders=can(c.role,'order.view')?w.orders.filter(o=>wanted.has(o.id)&&!o.deletedAt&&rowVisible(o,c.me,c.role)).map(o=>compactOrder(project(o,c.me,c.role,admins))):[]
 const [[count],notes]=await Promise.all([
  db.select({n:sql<number>`count(*)`}).from(t.notifications).where(and(eq(t.notifications.userId,c.me.id),forumNotificationVisibility(c),isNull(t.notifications.readAt))),
  db.select().from(t.notifications).where(and(eq(t.notifications.userId,c.me.id),forumNotificationVisibility(c))).orderBy(desc(t.notifications.id)).limit(3),
 ])
 return json({version,orders,orderChannels:orderChannelLabels(w.channels,orders as {channelId:string}[]),removed:ids.filter(id=>!orders.some(o=>o.id===id)),unread:Number(count.n),notifications:notes.map(n=>({id:String(n.id),kind:n.kind,orderId:n.orderId,tab:n.tab,title:n.title,body:n.body,actorId:n.actorId,at:n.at,read:!!n.readAt}))})
})
