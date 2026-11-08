import { z } from 'zod'
import { bad, deny, json, route } from '@/server/http'
import { canSeePaymentCodes, paymentCodeView, savePaymentCode } from '@/server/company-resources'
import { PAYMENT_CODES } from '@/shared/company-resources'

export const GET = route(async (_req, c) => {
  if (!canSeePaymentCodes(c)) throw deny()
  return json(await paymentCodeView())
})
export const POST = route(async (req, c) => {
  if (!c.role.locked) throw deny('只有老板能更换收款码')
  const parsed = z.object({ kind: z.enum(PAYMENT_CODES), image: z.string().max(11_000_000) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw bad('请选择收款码图片')
  return json(await savePaymentCode(c, parsed.data.kind, parsed.data.image))
})
