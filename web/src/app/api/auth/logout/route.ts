import { db } from '@/server/db'
import { audit } from '@/server/schema'
import { clearCookie, getCtx, revokeSession } from '@/server/session'
import { json } from '@/server/http'
import { trustedWriteRequest } from '@/server/request-security'

export async function POST(req: Request) {
  if (!trustedWriteRequest(req)) return json({ error: '请在平台页面内操作' }, { status: 403 })
  const c = await getCtx(req)
  if (c) {
    await revokeSession(c.sessionId)
    await db.insert(audit).values({ actorId: c.me.id, action: '登出', objectType: 'session', objectLabel: c.me.name, ip: c.ip })
  }
  return json({ ok: true }, { headers: { 'set-cookie': clearCookie() } })
}
