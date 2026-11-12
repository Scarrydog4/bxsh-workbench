import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import * as t from './schema'
import { log, WRITE_LOCK } from './actions'
import { bad, deny, notFound } from './http'
import { can } from '@/shared/perm'
import { broadcast } from './events'
import type { Ctx } from './session'
export const inquiryInput=z.object({id:z.uuid(),title:z.string().trim().min(1).max(200),channelId:z.string().nullable().default(null),quote:z.number().min(0).max(10_000_000).multipleOf(.01).nullable().default(null),note:z.string().trim().max(5000).default('')})
export function requireInquiries(c:Ctx){if(!can(c.role,'order.create'))throw deny()}
export async function listInquiries(c:Ctx){requireInquiries(c);return db.select().from(t.inquiries).where(c.role.locked?undefined:eq(t.inquiries.ownerId,c.me.id)).orderBy(t.inquiries.updatedAt)}
export type Inquiry=Awaited<ReturnType<typeof listInquiries>>[number]
export async function saveInquiry(c:Ctx,input:z.infer<typeof inquiryInput>){
  requireInquiries(c)
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const [old]=await tx.select().from(t.inquiries).where(eq(t.inquiries.id,input.id))
    if(old&&!c.role.locked&&old.ownerId!==c.me.id)throw notFound()
    if(old?.orderId)throw bad('已经转为正式订单，请在订单中修改')
    if(input.channelId){const [ch]=await tx.select().from(t.channels).where(and(eq(t.channels.id,input.channelId)));if(!ch||ch.deletedAt||!c.role.locked&&ch.ownerId!==c.me.id)throw notFound()}
    const values={...input,updatedAt:new Date().toISOString()}
    await tx.insert(t.inquiries).values({...values,ownerId:c.me.id}).onConflictDoUpdate({target:t.inquiries.id,set:values})
    await log(tx,c,{action:old?'修改意向单':'登记意向单',objectType:'inquiry',objectId:input.id,objectLabel:input.title})
  });broadcast()
}
export async function archiveInquiry(c:Ctx,id:string,status:'active'|'archived'){
  requireInquiries(c)
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const [old]=await tx.select().from(t.inquiries).where(eq(t.inquiries.id,id))
    if(!old||!c.role.locked&&old.ownerId!==c.me.id)throw notFound()
    if(old.orderId)throw bad('已转为正式订单的记录不能归档')
    await tx.update(t.inquiries).set({status,updatedAt:new Date().toISOString()}).where(eq(t.inquiries.id,id))
    await log(tx,c,{action:status==='archived'?'归档意向单':'恢复意向单',objectType:'inquiry',objectId:id,objectLabel:old.title})
  });broadcast()
}
