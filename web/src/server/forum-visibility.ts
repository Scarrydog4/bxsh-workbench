import { eq, sql } from 'drizzle-orm'
import type { Ctx } from './session'
import { db } from './db'
import { dmThreads, forumPosts, notifications } from './schema'
import type { ChangeEvent } from './events'

/** 提醒每次返回前按内容的当前权限过滤，公开帖改私密后不泄露旧提醒。 */
export function forumNotificationVisibility(c: Ctx) {
  return sql`(
    (${notifications.tab} IS NULL OR ${notifications.tab} NOT LIKE 'page:forum:%') OR EXISTS (
      SELECT 1 FROM forum_posts p WHERE p.id = substring(${notifications.tab} from 12)
      AND p.deleted_at IS NULL AND (${c.role.locked} OR NOT p.private OR p.author_id = ${c.me.id})
    )
  ) AND (
    (${notifications.tab} IS NULL OR ${notifications.tab} NOT LIKE 'page:dm:%') OR EXISTS (
      SELECT 1 FROM dm_threads d WHERE d.id = substring(${notifications.tab} from 9)
      AND (${c.me.id} = d.participant_a OR ${c.me.id} = d.participant_b)
    )
  )`
}

/** SSE 只有资源编号；仍要重新鉴权，不能只信事件产生时的收件人名单。 */
export async function canReceiveForumEvent(c: Ctx, event: ChangeEvent) {
  if (event.userId && event.userId !== c.me.id) return false
  if (!event.resource) return true
  if (event.resource.type === 'post') {
    const [post] = await db.select().from(forumPosts).where(eq(forumPosts.id,event.resource.id))
    return !!post && (c.role.locked || !post.private || post.authorId === c.me.id)
  }
  const [thread] = await db.select().from(dmThreads).where(eq(dmThreads.id,event.resource.id))
  return !!thread && (c.role.locked || [thread.participantA,thread.participantB].includes(c.me.id))
}
