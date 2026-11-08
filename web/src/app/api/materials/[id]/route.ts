import { z } from 'zod'
import { route, json } from '@/server/http'
import { favoriteMaterial, readBody, removeMaterial } from '@/server/work-materials'
export const PATCH = route<{ id: string }>(async (req, c, { id }) => {
  const { favorite } = await readBody(req, z.object({ favorite: z.boolean() }))
  await favoriteMaterial(c, id, favorite)
  return json({ ok: true })
})
export const DELETE = route<{ id: string }>(async (_, c, { id }) => {
  await removeMaterial(c, id)
  return json({ ok: true })
})
