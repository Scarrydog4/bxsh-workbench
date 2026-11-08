import { FORUM_COPY } from '@/shared/copy/forum'
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, type FeedbackKind, type FeedbackStatus } from '@/shared/feedback'
import { FORUM_CATEGORIES, FORUM_SORTS, type ForumCategory, type ForumSort } from '@/shared/forum'
import { listForumPosts, type ForumListOptions } from '@/server/forum'
import { bad, json, forumRoute as route } from '@/server/http'
import { runAction } from '@/server/run'

export const GET = route(async (req, c) => {
  const params = new URL(req.url).searchParams
  const opts: ForumListOptions = { q: (params.get('q') ?? '').trim().slice(0, 200) }
  const category = params.get('category'), sort = params.get('sort'), status = params.get('status'), feedbackKind = params.get('feedbackKind')
  if (category) {
    if (!FORUM_CATEGORIES.includes(category as ForumCategory)) throw bad(FORUM_COPY.errors.unknown)
    opts.category = category as ForumCategory
  }
  if (sort) {
    if (!FORUM_SORTS.includes(sort as ForumSort)) throw bad(FORUM_COPY.errors.unknown)
    opts.sort = sort as ForumSort
  }
  if (status) {
    if (!FEEDBACK_STATUSES.includes(status as FeedbackStatus)) throw bad(FORUM_COPY.errors.unknown)
    opts.status = status as FeedbackStatus
  }
  if (feedbackKind) {
    if (!FEEDBACK_KINDS.includes(feedbackKind as FeedbackKind)) throw bad(FORUM_COPY.errors.unknown)
    opts.feedbackKind = feedbackKind as FeedbackKind
  }
  for (const field of ['offset', 'limit'] as const) {
    const value = params.get(field)
    if (value !== null) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw bad(FORUM_COPY.errors.unknown)
      opts[field] = field === 'limit' ? Math.min(100, Math.max(1, Number(value))) : Number(value)
    }
  }
  return json(await listForumPosts(c, opts))
})

export const POST = route(async (req, c) => json(await runAction(c, 'forum.create', await req.json().catch(() => ({})))))
