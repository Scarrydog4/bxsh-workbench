import { randomUUID } from 'node:crypto'
import { rename } from 'node:fs/promises'
import sharp from 'sharp'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { db } from '@/server/db'
import { env } from '@/server/env'
import * as t from '@/server/schema'
import { migrateFeedback } from '@/server/migrate-feedback'
import { getCtx } from '@/server/session'
import { buildBoot } from '@/server/bootstrap'
import { GET as legacyImage } from '@/app/api/feedback/[id]/images/[hash]/route'
import { GET as forumFile } from '@/app/api/forum/files/[id]/route'
import { GET as events } from '@/app/api/events/route'
import { canReceiveForumEvent } from '@/server/forum-visibility'
import { GET as auditGet } from '@/app/api/audit/route'

vi.mock('next/headers',()=>({headers:async()=>new Headers()}))
let boss:Client, sales:Client, writer:Client, other:Client, feedbackId:string, screenshot:string
const req=(client:Client,url:string,signal?:AbortSignal)=>new Request(`http://test.local${url}`,{headers:{cookie:client.cookie},signal})
const ctx=async(client:Client)=>(await getCtx(req(client,'/')) )!
const noParams={params:Promise.resolve({})}
beforeAll(async()=>{
 await resetDb();boss=await as('boss');sales=await as('acheng');writer=await as('xiaosenkai');other=await as('xiaoyang')
 const png=await sharp({create:{width:3,height:3,channels:3,background:'purple'}}).png().toBuffer()
 const input={requestId:randomUUID(),kind:'问题',title:'旧反馈迁移测试',body:'保留原正文',shots:[`data:image/png;base64,${png.toString('base64')}`]}
 const created=await writer.act('feedback.create',input);expect(created.status).toBe(200);feedbackId=created.body.id
 expect((await boss.act('feedback.reply',{requestId:randomUUID(),id:feedbackId,body:'回复保留',shots:input.shots})).status).toBe(200)
 expect((await boss.act('feedback.update',{requestId:randomUUID(),id:feedbackId,status:'处理中'})).status).toBe(200)
 expect((await sales.act('feedback.create',{requestId:randomUUID(),kind:'建议',title:'第二条',body:'',shots:[]})).status).toBe(200)
 screenshot=(await db.select().from(t.feedback).where(eq(t.feedback.id,feedbackId)))[0].shots[0]
})
afterAll(closeDb)
it('旧反馈迁移保留编号、正文、时间、回复、状态和截图；重跑无重复且不覆盖后续编辑',async()=>{
 expect(await migrateFeedback(db,env.storageDir)).toEqual({posts:2,replies:1,images:2})
 const [source]=await db.select().from(t.feedback).where(eq(t.feedback.id,feedbackId))
 const [post]=await db.select().from(t.forumPosts).where(eq(t.forumPosts.legacyFeedbackId,feedbackId))
 expect(post).toMatchObject({no:source.no,title:source.title,body:source.body,createdAt:source.createdAt,updatedAt:source.updatedAt,status:source.status,private:true})
 const [reply]=await db.select().from(t.forumReplies).where(eq(t.forumReplies.postId,post.id))
 expect(reply).toMatchObject({authorId:source.replies[0].by,body:source.replies[0].body})
 expect(Date.parse(reply.createdAt)).toBe(Date.parse(source.replies[0].at))
 const [file]=await db.select().from(t.forumAttachments).where(and(eq(t.forumAttachments.ownerKind,'post'),eq(t.forumAttachments.ownerId,post.id)))
 const hash=screenshot.split('/').at(-1)!
 const legacy=await legacyImage(req(writer,screenshot),{params:Promise.resolve({id:feedbackId,hash})})
 const fresh=await forumFile(req(writer,`/api/forum/files/${file.id}`),{params:Promise.resolve({id:file.id})})
 expect(Buffer.from(await legacy.arrayBuffer())).toEqual(Buffer.from(await fresh.arrayBuffer()))
 expect((await forumFile(req(other,`/api/forum/files/${file.id}`),{params:Promise.resolve({id:file.id})})).status).toBe(404)
 expect((await legacyImage(req(other,screenshot),{params:Promise.resolve({id:feedbackId,hash})})).status).toBe(404)
 expect(await migrateFeedback(db,env.storageDir)).toEqual({posts:2,replies:1,images:2})
 expect((await writer.act('forum.edit',{requestId:randomUUID(),id:post.id,private:false,body:'迁移后的修改'})).status).toBe(200)
 expect(await migrateFeedback(db,env.storageDir)).toEqual({posts:2,replies:1,images:2})
 expect((await db.select().from(t.forumPosts).where(eq(t.forumPosts.id,post.id)))[0]).toMatchObject({private:false,body:'迁移后的修改'})
 // A later old-frontend edit must fail loudly, not silently lose an updated state.
 await db.update(t.feedback).set({body:'旧入口后续修改'}).where(eq(t.feedback.id,feedbackId))
 await expect(migrateFeedback(db,env.storageDir)).rejects.toThrow('changed after migration')
 await db.update(t.feedback).set({body:source.body}).where(eq(t.feedback.id,feedbackId))
 // Rollback on missing screenshot instead of claiming partial migration succeeded.
 await rename(file.path,file.path+'.test-hidden')
 try { await expect(migrateFeedback(db,env.storageDir)).rejects.toThrow() }
 finally {await rename(file.path+'.test-hidden',file.path)}
})
it('私密内容的旧提醒、审计和SSE不能被其他员工读取，普通角色不能获得管理员论坛权限',async()=>{
 const created=await writer.act('forum.create',{requestId:randomUUID(),category:'feedback',title:'private-secret',body:'secret-body',private:true})
 expect(created.status).toBe(200);const id=created.body.id
 // Deliberately plant stale notifications to prove reads independently re-authorize.
 await db.insert(t.notifications).values({userId:'u-acheng',kind:'反馈',tab:`page:forum:${id}`,title:'secret-title',body:'secret-body'})
 await db.update(t.roles).set({perms:['audit.view','forum.manage','forum.announce','dm.viewAll']}).where(eq(t.roles.id,'r-sales'))
 const salesCtx=await ctx(sales)
 const boot=await buildBoot(salesCtx)
 expect(JSON.stringify(boot.notifications)).not.toContain('secret')
 const audit=await auditGet(req(sales,'/api/audit?views=1'),noParams)
 expect(JSON.stringify(await audit.json())).not.toContain('private-secret')
 expect((await sales.act('forum.pin',{requestId:randomUUID(),id,pinned:true})).status).toBe(403)
 expect((await sales.act('forum.create',{requestId:randomUUID(),category:'announcement',title:'forbidden'})).status).toBe(403)
 const event={kind:'forum',at:Date.now(),version:1,resource:{type:'post' as const,id}}
 expect(await canReceiveForumEvent(salesCtx,event)).toBe(false)
 expect(await canReceiveForumEvent(await ctx(boss),event)).toBe(true)
 expect(await canReceiveForumEvent(await ctx(writer),event)).toBe(true)
 // Existing public reply notifications disappear as soon as the parent becomes private.
 const pub=await writer.act('forum.create',{requestId:randomUUID(),category:'feedback',title:'public-then-private'})
 await db.insert(t.notifications).values({userId:'u-acheng',kind:'反馈',tab:`page:forum:${pub.body.id}`,title:'public-then-private'})
 expect((await writer.act('forum.edit',{requestId:randomUUID(),id:pub.body.id,private:true})).status).toBe(200)
 expect(JSON.stringify((await buildBoot(salesCtx)).notifications)).not.toContain('public-then-private')
})
it('真实SSE处理器只给私密帖作者及老板推送；不向旁观员工发资源事件',async()=>{
 const ba=new AbortController(),sa=new AbortController()
 const br=(await events(req(boss,'/api/events',ba.signal),noParams)).body!.getReader()
 const sr=(await events(req(other,'/api/events',sa.signal),noParams)).body!.getReader()
 await br.read();await sr.read() // hello
 const nextBoss=br.read(),nextOther=sr.read()
 try {
  const result=await writer.act('forum.create',{requestId:randomUUID(),category:'feedback',title:'sse-private',private:true})
  expect(result.status).toBe(200)
  const chunk=await Promise.race([nextBoss,new Promise<null>(resolve=>setTimeout(()=>resolve(null),3000))])
  expect(chunk).not.toBeNull()
  expect(new TextDecoder().decode(chunk!.value)).toContain(result.body.id)
  expect(await Promise.race([nextOther.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),150))])).toBe(false)
 } finally {ba.abort();sa.abort();await br.cancel();await sr.cancel()}
})
it('退款、订单、工资表不受论坛写入和迁移影响',async()=>{
 for(const table of [t.orders,t.payments,t.settleBatches,t.settlements])expect(await db.select().from(table)).toHaveLength(0)
})
