import type postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import path from 'node:path'
import * as t from './schema'
import { eq } from 'drizzle-orm'
import { ALL_PERMS } from '@/shared/perm'

/** P2 新加的权限给已有的预置角色补上（只补一次，之后管理员怎么改都不再动） */
const P2_PERMS: Record<string, string[]> = { 'r-sales': ['node.edit', 'card.edit', 'statement.view'], 'r-writer': ['node.edit'] }

/** 需求卡片的基础字段；管理员可以再加自定义字段 */
export const BUILTIN_CARD_FIELDS = [
  { id: 'f-school', label: '学校', type: 'text', sort: 0 },
  { id: 'f-major', label: '专业', type: 'text', sort: 1 },
  { id: 'f-level', label: '学历层次', type: 'select', choices: ['专科', '本科', '硕士'], sort: 2 },
  { id: 'f-words', label: '字数', type: 'number', sort: 3 },
  { id: 'f-desc', label: '要求说明', type: 'longtext', sort: 4 },
  { id: 'f-files', label: '要求附件（任务书、模板）', type: 'file', sort: 5 },
]

export const PRESET_ROLES = [
  { id: 'r-admin', name: '管理员', locked: true, preset: true, perms: ALL_PERMS as string[], fields: { sales: true, writerPay: 'all', commission: 'all', profit: true, channelNo: true }, rowScope: 'all', sort: 0 },
  {
    id: 'r-sales',
    name: '销售',
    locked: false,
    preset: true,
    perms: ['order.view', 'order.create', 'order.edit', 'order.status', 'order.price', 'order.delete', 'order.export', 'payment.create', 'aftersale.create', 'channel.view', 'node.edit', 'card.edit', 'statement.view', 'toolbox.use'],
    fields: { sales: true, writerPay: 'none', commission: 'own', profit: false, channelNo: true },
    rowScope: 'owned',
    sort: 1,
  },
  {
    id: 'r-writer',
    name: '写手',
    locked: false,
    preset: true,
    perms: ['order.view', 'order.draft', 'aftersale.create', 'node.edit', 'toolbox.use'],
    fields: { sales: false, writerPay: 'own', commission: 'none', profit: false, channelNo: false },
    rowScope: 'assigned',
    sort: 2,
  },
]

/** 建表（按 drizzle/ 里的迁移）+ 预置角色和选项；可以反复执行 */
export async function migrateAndSeed(sql: ReturnType<typeof postgres>, migrationsFolder = path.resolve(process.cwd(), 'drizzle')) {
  const db = drizzle(sql, { schema: t })
  await migrate(db, { migrationsFolder })
  for (const r of PRESET_ROLES) await db.insert(t.roles).values(r).onConflictDoNothing()
  await db
    .insert(t.options)
    .values([
      { key: 'statuses', values: ['未交付', '已发演示', '已交付', '退单'] },
      { key: 'types', values: [] },
      { key: 'payTags', values: ['定金', '尾款', '全款', '退款'] },
      { key: 'nodeTags', values: ['选题', '开题报告', '任务书', '初稿', '中期', '修改', '定稿', '查重', '答辩 PPT'] },
    ])
    .onConflictDoNothing()
  for (const f of BUILTIN_CARD_FIELDS) await db.insert(t.cardFields).values({ choices: [], ...f, builtin: true }).onConflictDoNothing()
  const [seed] = await db.select().from(t.options).where(eq(t.options.key, 'seeds'))
  if (!seed?.values.includes('p2-perms')) {
    for (const [id, add] of Object.entries(P2_PERMS)) {
      const [r] = await db.select().from(t.roles).where(eq(t.roles.id, id))
      if (r) await db.update(t.roles).set({ perms: Array.from(new Set([...r.perms, ...add])) }).where(eq(t.roles.id, id))
    }
    const values = [...(seed?.values ?? []), 'p2-perms']
    await db.insert(t.options).values({ key: 'seeds', values }).onConflictDoUpdate({ target: t.options.key, set: { values } })
  }
  const [currentSeeds] = await db.select().from(t.options).where(eq(t.options.key, 'seeds'))
  if (!currentSeeds?.values.includes('sales-delete-reason-20261112')) {
    const [sales] = await db.select().from(t.roles).where(eq(t.roles.id, 'r-sales'))
    if (sales) await db.update(t.roles).set({ perms: [...new Set([...sales.perms, 'order.delete'])] }).where(eq(t.roles.id, sales.id))
    const values = [...(currentSeeds?.values ?? []), 'sales-delete-reason-20261112']
    await db.insert(t.options).values({ key: 'seeds', values }).onConflictDoUpdate({ target: t.options.key, set: { values } })
  }
}
