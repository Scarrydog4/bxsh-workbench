import { json, route } from '@/server/http'
import { configured, monthUsage } from '@/server/assistant/provider'
export const GET = route(async (_req, c) => json({ configured: configured(), ...(c.role.locked ? { usage: await monthUsage() } : {}) }))
