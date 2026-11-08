import { FORUM_COPY } from '@/shared/copy/forum'
import { canManageForum, getForumPost, listForumPosts } from '@/server/forum'
import { bad, deny, json, forumRoute as route } from '@/server/http'

/** 回收站入口只给老板；恢复统一走 forum.restore。 */
export const GET = route(async (req, c) => {
  if (!canManageForum(c)) throw deny(FORUM_COPY.errors.forbidden)
  const params = new URL(req.url).searchParams, id = params.get('id')
  if (id) return json(await getForumPost(c, id, true))
  const offsetText = params.get('offset') ?? '0'
  if (!/^\d+$/.test(offsetText) || !Number.isSafeInteger(Number(offsetText))) throw bad(FORUM_COPY.errors.unknown)
  return json(await listForumPosts(c, { deleted: true, q: (params.get('q') ?? '').trim().slice(0, 200), offset: Number(offsetText), limit: 50 }))
})
