import { runAction } from '@/server/run'
import { json, route, forumRoute } from '@/server/http'

/** 所有写操作的统一入口：POST /api/act/<动作名>，body 是 JSON。权限、校验、留痕都在服务端做 */
const handle = async (req: Request, c: import('@/server/session').Ctx, p: {name:string}) => {
  const body = await req.json().catch(() => ({}))
  return json(await runAction(c, p.name, body))
}
const ordinary = route(handle), forum = forumRoute(handle)
export async function POST(req: Request, extra: {params:Promise<{name:string}>}) {
  const {name} = await extra.params
  return (name.startsWith('forum.') || name.startsWith('dm.') ? forum : ordinary)(req,extra)
}
