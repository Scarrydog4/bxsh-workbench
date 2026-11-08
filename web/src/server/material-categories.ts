import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { UNCATEGORIZED, type MaterialKind } from '@/shared/work-materials'
import { WRITE_LOCK, log } from './actions'
import { db } from './db'
import { materialCategories, materials } from './schema'
import type { Ctx } from './session'
import { bad, notFound } from './http'
import { requireMaterialMaintainer } from './work-materials'
import { broadcast } from './events'

const name = z.string().trim().min(1).max(40)
export const categoryChange = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name }),
  z.object({ action: z.literal('rename'), name, next: name }),
  z.object({ action: z.literal('remove'), name }),
])
export async function changeCategory(c: Ctx, kind: MaterialKind, change: z.infer<typeof categoryChange>) {
  requireMaterialMaintainer(c)
  const next = change.action === 'rename' ? change.next : change.name
  if ([next, change.name].some(label => ['全部', UNCATEGORIZED].includes(label))) throw bad('请换一个分类名称')
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const where = and(eq(materialCategories.kind, kind), eq(materialCategories.name, change.name))
    if (change.action !== 'add') {
      const [old] = await tx.select().from(materialCategories).where(where)
      if (!old) throw notFound('该分类已移除，请刷新')
      if (change.action === 'rename' && next === change.name) return
    }
    if (change.action !== 'remove') {
      const rows = await tx.insert(materialCategories).values({kind, name: next}).onConflictDoNothing().returning()
      if (!rows.length) throw bad('该分类名称已存在')
    }
    if (change.action !== 'add') {
      await tx.update(materials).set({category: change.action === 'remove' ? UNCATEGORIZED : next})
        .where(and(eq(materials.kind,kind),eq(materials.category,change.name)))
      await tx.delete(materialCategories).where(where)
    }
    await log(tx, c, {action:'修改素材分类', objectType:'materialCategory', from:change.action === 'add' ? '' : change.name, to:change.action === 'remove' ? '' : next})
  })
  broadcast('changed', [])
}
