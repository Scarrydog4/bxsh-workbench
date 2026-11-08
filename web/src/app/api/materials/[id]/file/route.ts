import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { materials } from '@/server/schema'
import { route, notFound } from '@/server/http'
import { fileResponse } from '@/server/range-response'
import { requireLibrary } from '@/server/work-materials'

export const GET = route<{id: string}>(async (req, c, {id}) => {
  requireLibrary(c)
  const [record] = await db.select({path: materials.filePath, name: materials.fileName}).from(materials).where(eq(materials.id, id))
  if (!record?.path || !record.name) throw notFound()
  return fileResponse(req, {path:record.path, name:record.name, id, mime:'application/octet-stream', cacheControl:'private, no-store'})
})
export const HEAD = GET
