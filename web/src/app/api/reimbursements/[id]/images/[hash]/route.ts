import { fileResponse } from '@/server/range-response'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { notFound, route } from '@/server/http'
import { canViewReimbursement, reimbursementProofs } from '@/server/reimbursement'
import { reimbursements } from '@/server/schema'

export const GET = route<{ id: string; hash: string }>(async (req, c, { id, hash }) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw notFound()
  const [record] = await db.select().from(reimbursements).where(eq(reimbursements.id, id))
  const url = `/api/reimbursements/${id}/images/${hash}`
  if (!record || !canViewReimbursement(record, c) || !reimbursementProofs(record).includes(url)) throw notFound()
  const suffix = new URL(req.url).searchParams.has('thumb') ? '.256.webp' : '.webp'
  return fileResponse(req,{path:path.join(env.storageDir,'private-images',hash+suffix),name:hash+suffix,mime:'image/webp',id:hash+suffix,inline:true,cacheControl:'private, no-store'})
})
export const HEAD = GET
