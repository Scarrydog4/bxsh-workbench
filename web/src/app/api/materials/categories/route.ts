import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { materialCategories } from '@/server/schema'
import { json, route } from '@/server/http'
import { categoryChange, changeCategory } from '@/server/material-categories'
import { readBody, requireLibrary, requireMaterialMaintainer } from '@/server/work-materials'

const kind = (req: Request) => new URL(req.url).searchParams.get('kind') === 'talk' ? 'talk' : 'case'
export const GET = route(async (req, c) => {
  requireLibrary(c)
  const rows = await db.select({ name: materialCategories.name }).from(materialCategories)
    .where(eq(materialCategories.kind, kind(req))).orderBy(materialCategories.name)
  return json(rows.map(row => row.name))
})
export const POST = route(async (req, c) => {
  requireMaterialMaintainer(c)
  await changeCategory(c, kind(req), await readBody(req, categoryChange))
  return json({ ok: true })
})
