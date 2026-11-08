import { fileResponse } from '@/server/range-response'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { canViewFeedback, feedbackShots } from '@/server/feedback'
import { notFound, route } from '@/server/http'
import { FORUM_COPY } from '@/shared/copy/forum'
import { canViewForumPost } from '@/server/forum'
import { feedback, forumPosts } from '@/server/schema'

export const GET = route<{ id: string; hash: string }>(async (req, c, { id, hash }) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw notFound()
  const [row] = await db.select().from(feedback).where(eq(feedback.id, id))
  const url = `/api/feedback/${id}/images/${hash}`
  if (!row || !canViewFeedback(row, c) || !feedbackShots(row).includes(url)) throw notFound()
  const [migrated] = await db.select().from(forumPosts).where(eq(forumPosts.legacyFeedbackId,id))
  if (migrated && !canViewForumPost(migrated,c)) throw notFound(FORUM_COPY.errors.notFound)
  const suffix = new URL(req.url).searchParams.has('thumb') ? '.256.webp' : '.webp'
  return fileResponse(req,{path:path.join(env.storageDir,'private-images',hash+suffix),name:hash+suffix,mime:'image/webp',id:hash+suffix,inline:true,cacheControl:'private, no-store'})
})
export const HEAD = GET
