import { z } from 'zod'
import { checkin, listCheckins } from '@/server/checkin'
import { bad, deny, json, route } from '@/server/http'

export const GET = route(async (req, c) => {
  const query = new URL(req.url).searchParams
  for (const key of query.keys()) {
    if (!['month', 'scope'].includes(key) || query.getAll(key).length !== 1) throw bad('打卡查询条件不正确')
  }
  const scope = query.get('scope') ?? 'mine'
  if (scope !== 'mine' && scope !== 'team') throw bad('打卡查询范围不正确')
  return json(await listCheckins(c, query.get('month') ?? undefined, scope))
})

export const POST = route(async (req, c) => {
  if (new URL(req.url).search) throw bad('打卡不接受额外参数')
  const origin = req.headers.get('origin')
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw deny('请在平台内打卡')
  if (origin) {
    let source: URL
    try { source = new URL(origin) } catch { throw deny('请在平台内打卡') }
    // standalone 的内部 URL 可能是 localhost；浏览器的 Host 由反向代理保留。
    const host = req.headers.get('host') ?? new URL(req.url).host
    if (!['http:', 'https:'].includes(source.protocol) || source.host !== host) throw deny('请在平台内打卡')
  }
  const text = await req.text()
  let body: unknown = {}
  if (text.trim()) {
    if (text.length > 11_000_000) throw bad('照片不能超过 8MB')
    try { body = JSON.parse(text) } catch { throw bad('打卡信息格式不正确') }
  }
  const parsed = z.union([
    z.object({ kind: z.enum(['in', 'out']), photo: z.string().min(1).max(10_700_000) }).strict(),
    z.object({ kind: z.enum(['break-start', 'break-end']) }).strict(),
  ]).safeParse(body)
  if (!parsed.success) throw bad('上下班请拍照，午休请使用开始或结束按钮；日期和时间由系统记录')
  return json(await checkin(c, parsed.data.kind, 'photo' in parsed.data ? parsed.data.photo : undefined))
})
