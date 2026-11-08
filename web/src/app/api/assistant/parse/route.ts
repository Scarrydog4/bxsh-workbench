import { bad, deny, json, route } from '@/server/http'
import { can } from '@/shared/perm'
import { parseInput } from '@/shared/assistant'
import { checkBalance, exclusive } from '@/server/assistant/provider'
import { parseOrders } from '@/server/assistant/parse'
export const POST = route(async (req, c) => {
  if (!can(c.role, 'order.create')) throw deny()
  const input = parseInput.safeParse(await req.json().catch(() => null))
  if (!input.success) throw bad(input.error.issues[0]?.message ?? '内容格式有误')
  return exclusive(c.me.id, async () => { await checkBalance(); return json(await parseOrders(c, input.data)) })
})
