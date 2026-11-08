import { getForumPost } from '@/server/forum'
import { json, forumRoute as route } from '@/server/http'
import { runAction } from '@/server/run'

export const GET = route<{ id: string }>(async (_req, c, p) => json(await getForumPost(c, p.id)))
export const PATCH = route<{ id: string }>(async (req, c, p) => json(await runAction(c, 'forum.edit', { ...await req.json().catch(() => ({})), id: p.id })))
export const DELETE = route<{ id: string }>(async (req, c, p) => json(await runAction(c, 'forum.delete', { ...await req.json().catch(() => ({})), id: p.id })))
