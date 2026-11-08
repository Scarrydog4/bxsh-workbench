import { z } from 'zod'
import { json, route } from '@/server/http'
import { imageData, readBody, transitionReview } from '@/server/work-materials'
const version = z.number().int().nonnegative().optional()
const images = z.array(imageData).max(5).optional()
const filled = (text: string, pictures?: string[]) => !!text || !!pictures?.length
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), version, images, reply: z.string().trim().max(8000) }),
  z.object({ action: z.literal('confirm'), version }),
  z.object({ action: z.literal('supplement'), images, note: z.string().trim().max(8000), version }),
]).refine(data => data.action === 'confirm' || filled(data.action === 'reply' ? data.reply : data.note, data.images))
export const POST = route<{ id: string }>(async (req, c, { id }) => {
  const data = await readBody(req, action)
  await transitionReview(c, id, data, data.version)
  return json({ ok: true })
})
