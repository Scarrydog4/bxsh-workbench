import { json, route } from '@/server/http'
import { confirmOrders } from '@/server/assistant/confirm'
export const POST = route(async (req, c) => json(await confirmOrders(c, await req.json().catch(() => null))))
