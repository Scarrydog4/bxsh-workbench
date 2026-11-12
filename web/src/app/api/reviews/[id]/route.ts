import { z } from 'zod'
import { json, route } from '@/server/http'
import { imageData, readBody, transitionReview } from '@/server/work-materials'
const version = z.number().int().nonnegative().optional()
const images = z.array(imageData).max(5).optional()
const filled = (text: string, pictures?: string[]) => !!text || !!pictures?.length
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), version, images, reply: z.string().trim().max(8000) }),
  z.object({ action: z.literal('confirm'), version, revoke: z.boolean().optional(), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('revoke'), note: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal('supplement'), images, note: z.string().trim().max(8000), version }),
]).refine(data => data.action === 'confirm' || data.action === 'revoke' || filled(data.action === 'reply' ? data.reply : data.note, data.images))
export const POST = route<{ id: string }>(async (req, c, { id }) => {
  const data = await readBody(req, action)
  await transitionReview(c, id, data, 'version' in data ? data.version : undefined)
  return json({ ok: true })
})
