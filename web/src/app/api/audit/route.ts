import { forumAuditVisibility } from '@/server/forum'
import { dmAuditVisibility } from '@/server/dm'
import { and,desc,eq,gt,inArray,isNull,lt,ne,notInArray,or } from 'drizzle-orm'
import { json,route,deny } from '@/server/http'
import { can } from '@/shared/perm'
import { db } from '@/server/db'
import { audit } from '@/server/schema'
import { reimbursementAuditVisibility } from '@/server/reimbursement'
import { feedbackAuditVisibility } from '@/server/feedback'
import { loadWorld } from '@/server/repo'
import { canViewChannelReceipt } from '@/server/channel-receipts'
export const GET=route(async(req,c)=>{
 if(!can(c.role,'audit.view'))throw deny()
 const q=new URL(req.url).searchParams,cursor=Number(q.get('before')),limit=q.get('recent')==='1'?20:100
 const w=await loadWorld(db,{includeDeleted:true})
 const receipts=(w.channelReceipts??[]).filter(receipt=>canViewChannelReceipt(w,c,receipt)).map(receipt=>receipt.id)
 const filters=[reimbursementAuditVisibility(c),feedbackAuditVisibility(c),forumAuditVisibility(c),dmAuditVisibility(c),or(ne(audit.objectType,'channelReceipt'),inArray(audit.objectId,receipts))!]
 if(!c.role.locked)filters.push(or(isNull(audit.fieldGroup),and(ne(audit.fieldGroup,'writerRate'),...(c.role.fields.profit?[]:[ne(audit.fieldGroup,'profit')])))!)
 if(cursor)filters.push(lt(audit.id,cursor))
 if(Number(q.get('after')))filters.push(gt(audit.id,Number(q.get('after'))))
 if(q.get('actor'))filters.push(eq(audit.actorId,q.get('actor')!))
 if(q.get('action'))filters.push(eq(audit.action,q.get('action')!))
 if(q.get('views')!=='1')filters.push(notInArray(audit.action,['查看详情','AI 调用','AI 失败','换头像']))
 const rows=await db.select().from(audit).where(and(...filters)).orderBy(desc(audit.id)).limit(limit+1)
 return json({rows:rows.slice(0,limit).map(a=>({...a,id:String(a.id)})),next:rows.length>limit?rows[limit-1].id:null})
})
