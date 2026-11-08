/** 将内联图片搬到文件；默认仅统计，--apply 才执行。 */
import { db, sql } from '../src/server/db'
import * as t from '../src/server/schema'
import { eq, sql as query } from 'drizzle-orm'
import { saveAvatar, saveOrderImage, privateImageUrl, savePreview } from '../src/server/images'
const dataImage=(s:unknown):s is string=>typeof s==='string'&&s.startsWith('data:image/')
try {
  await db.transaction(async tx=>{
    await tx.execute(query`select pg_advisory_xact_lock(20261007)`)
    const [channels,users,sales,payments,files]=await Promise.all([tx.select().from(t.channels),tx.select().from(t.users),tx.select().from(t.afterSales),tx.select().from(t.payments),tx.select().from(t.attachments)])
    const counts={channels:channels.filter(c=>dataImage(c.avatar)).length,users:users.filter(u=>dataImage(u.avatar)).length,shots:sales.reduce((n,a)=>n+a.shots.filter(dataImage).length,0),proofs:payments.filter(p=>dataImage(p.proof)).length,previews:files.filter(f=>dataImage(f.preview)).length}
    console.log(JSON.stringify({apply:process.argv.includes('--apply'),...counts}))
    if(!process.argv.includes('--apply'))return
    for(const c of channels)if(dataImage(c.avatar))await tx.update(t.channels).set({avatar:await saveAvatar(c.avatar)}).where(eq(t.channels.id,c.id))
    for(const u of users)if(dataImage(u.avatar))await tx.update(t.users).set({avatar:await saveAvatar(u.avatar)}).where(eq(t.users.id,u.id))
    for(const a of sales){if(!a.shots.some(dataImage))continue;const shots:string[]=[];for(const shot of a.shots)shots.push(dataImage(shot)?await saveOrderImage(tx,shot,{orderId:a.orderId,afterSaleId:a.id,by:a.by,purpose:'aftersale-shot'}):shot);await tx.update(t.afterSales).set({shots}).where(eq(t.afterSales.id,a.id))}
    for(const p of payments)if(dataImage(p.proof))await tx.update(t.payments).set({proof:privateImageUrl(await saveOrderImage(tx,p.proof,{orderId:p.orderId,by:p.by,purpose:'payment-proof'}))}).where(eq(t.payments.id,p.id))
    for(const f of files)if(dataImage(f.preview))await tx.update(t.attachments).set({thumbPath:await savePreview(f.preview),preview:`/api/files/${f.id}?thumb=1`}).where(eq(t.attachments.id,f.id))
    await tx.insert(t.audit).values({actorId:'system',action:'迁移图片存储',objectType:'settings',to:JSON.stringify(counts)})
  })
}finally{await sql.end()}
