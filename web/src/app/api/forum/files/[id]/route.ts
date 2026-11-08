import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { forumAttachments } from '@/server/schema'
import { canReadForumAttachment } from '@/server/forum-files'
import { notFound, forumRoute as route } from '@/server/http'
import { fileResponse } from '@/server/range-response'
import { FORUM_COPY } from '@/shared/copy/forum'

export const GET=route<{id:string}>(async(req,c,p)=>{
  const [file]=await db.select().from(forumAttachments).where(and(eq(forumAttachments.id,p.id),isNull(forumAttachments.deletedAt)))
  if(!file || !await canReadForumAttachment(db,file,c))throw notFound(FORUM_COPY.errors.notFound)
  const query=new URL(req.url).searchParams,thumbnail=query.has('thumb') && !!file.thumbPath
  const response=await fileResponse(req,{path:thumbnail?file.thumbPath!:file.path,name:thumbnail?`${file.id}.webp`:file.name,mime:thumbnail?'image/webp':file.mime,id:`${file.id}-${thumbnail?'thumb':'file'}`,inline:thumbnail || query.get('inline')==='1',notFoundMessage:FORUM_COPY.errors.notFound})
  // Count explicit full downloads once, not previews, HEAD requests or every video/PDF range request.
  if(req.method!=='HEAD' && response.status===200 && !thumbnail && query.get('inline')!=='1' && !req.headers.has('range')){
    await db.update(forumAttachments).set({downloads:sql`${forumAttachments.downloads}+1`}).where(eq(forumAttachments.id,file.id))
  }
  return response
})
export const HEAD=GET
