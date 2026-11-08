import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import type { DB } from './db'
import * as t from './schema'

/** Explicit cutover migration; never run as a side effect of reading forum data. */
export async function migrateFeedback(database: DB, storageDir: string) {
  return database.transaction(async tx => {
    // Serialize migration and old/new action writes so source rows cannot change during verification.
    await tx.execute(sql`select pg_advisory_xact_lock(20261007)`)
    await tx.execute(sql`LOCK TABLE feedback IN SHARE MODE`)
    const source = await tx.select().from(t.feedback)
    let expectedReplies = 0, expectedImages = 0
    const attach = async (ownerKind: 'post'|'reply', ownerId: string, authorId: string, urls: string[], createdAt: string, feedbackId: string) => {
      for (const url of [...new Set(urls)]) {
        const match = /^\/api\/feedback\/([^/]+)\/images\/([a-f0-9]{64})$/.exec(url)
        if (!match || match[1] !== feedbackId) throw new Error(`Invalid legacy screenshot reference: ${feedbackId}`)
        const file = path.join(storageDir,'private-images',`${match[2]}.webp`)
        const thumb = path.join(storageDir,'private-images',`${match[2]}.256.webp`)
        const info = await stat(file), thumbInfo = await stat(thumb)
        if (!info.isFile() || !thumbInfo.isFile()) throw new Error(`Missing legacy image: ${feedbackId}`)
        const id = 'legacy_image_' + createHash('sha256').update(`${ownerKind}:${ownerId}:${url}`).digest('hex')
        await tx.insert(t.forumAttachments).values({id,ownerKind,ownerId,uploadedBy:authorId,name:'截图.webp',size:info.size,mime:'image/webp',path:file,thumbPath:thumb,legacyUrl:url,createdAt}).onConflictDoNothing()
        const [saved] = await tx.select().from(t.forumAttachments).where(eq(t.forumAttachments.id,id))
        if (!saved || saved.ownerId !== ownerId || saved.legacyUrl !== url || saved.path !== file || saved.size !== info.size) throw new Error(`Legacy attachment mismatch: ${id}`)
        expectedImages++
      }
    }
    for (const row of source) {
      const id = `forum_${row.id}`
      // Old feedback is writable until frontend cutover. Detect changed source rather than
      // silently accepting stale imported text/status or overwriting later forum edits.
      const sourceHash = createHash('sha256').update(JSON.stringify({no:row.no,authorId:row.authorId,kind:row.kind,title:row.title,body:row.body,shots:row.shots,status:row.status,createdAt:row.createdAt,updatedAt:row.updatedAt,replies:row.replies})).digest('hex')
      const requestId = `legacy-feedback:${row.id}`
      const [snapshot] = await tx.select().from(t.forumRequests).where(and(eq(t.forumRequests.actorId,row.authorId),eq(t.forumRequests.requestId,requestId)))
      if (snapshot && (snapshot.action !== 'migration.feedback' || snapshot.hash !== sourceHash)) throw new Error(`Legacy feedback changed after migration; freeze old feedback writes and reconcile before cutover: ${row.id}`)
      if (!snapshot) await tx.insert(t.forumRequests).values({actorId:row.authorId,requestId,action:'migration.feedback',hash:sourceHash,result:{id}})
      await tx.insert(t.forumPosts).values({id,no:row.no,category:'feedback',authorId:row.authorId,title:row.title,body:row.body,feedbackKind:row.kind,status:row.status,private:true,createdAt:row.createdAt,updatedAt:row.updatedAt,lastActivityAt:row.updatedAt,legacyFeedbackId:row.id}).onConflictDoNothing()
      const [post] = await tx.select().from(t.forumPosts).where(eq(t.forumPosts.id,id))
      // After cutover authors may edit/make public; reruns must never overwrite those changes.
      if (!post || post.legacyFeedbackId !== row.id || post.no !== row.no || post.authorId !== row.authorId) throw new Error(`Legacy post mismatch: ${row.id}`)
      await attach('post',id,row.authorId,row.shots,row.createdAt,row.id)
      for (const reply of row.replies) {
        const replyId = `legacy_${row.id}_${reply.id}`
        await tx.insert(t.forumReplies).values({id:replyId,postId:id,authorId:reply.by,body:reply.body,createdAt:reply.at}).onConflictDoNothing()
        const [saved] = await tx.select().from(t.forumReplies).where(eq(t.forumReplies.id,replyId))
        if (!saved || saved.postId !== id || saved.authorId !== reply.by) throw new Error(`Legacy reply mismatch: ${replyId}`)
        expectedReplies++
        await attach('reply',replyId,reply.by,reply.shots,reply.at,row.id)
      }
    }
    const [{n:posts}] = await tx.execute<{n:number}>(sql`select count(*)::int as n from forum_posts where legacy_feedback_id is not null`)
    const [{n:replies}] = await tx.execute<{n:number}>(sql`select count(*)::int as n from forum_replies where id like 'legacy_%'`)
    const [{n:images}] = await tx.execute<{n:number}>(sql`select count(*)::int as n from forum_attachments where legacy_url is not null`)
    if (posts !== source.length || replies !== expectedReplies || images !== expectedImages) throw new Error(`Legacy migration counts differ: ${JSON.stringify({posts,replies,images,expectedPosts:source.length,expectedReplies,expectedImages})}`)
    return {posts,replies,images}
  })
}
