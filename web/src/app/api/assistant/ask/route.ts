import { z } from 'zod'
import { bad, deny, json, route } from '@/server/http'
import { can } from '@/shared/perm'
import { checkBalance, exclusive } from '@/server/assistant/provider'
import { ask } from '@/server/assistant/query'
import { conversationHistory } from '@/shared/assistant'
const schema = z.object({ question: z.string().trim().min(1).max(1500), history: conversationHistory.default([]) })
export const POST = route(async (req, c) => {
  if (!can(c.role, 'order.view')) throw deny()
  const input = schema.safeParse(await req.json().catch(() => null))
  if (!input.success) throw bad('请输入问题（1500 字以内）')
  return exclusive(c.me.id, async () => { await checkBalance(); return json(await ask(c, input.data.question, input.data.history)) })
})
