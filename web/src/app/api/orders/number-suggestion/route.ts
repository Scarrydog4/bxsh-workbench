import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/server/db'
import { users, roles } from '@/server/schema'
import { bad, deny, json, notFound, route } from '@/server/http'
import { suggestOrderNumber } from '@/server/order-number-suggestion'
import { can } from '@/shared/perm'
import { businessDate } from '@/shared/format'

export const GET = route(async (req, c) => {
  if (!can(c.role, 'order.create')) throw deny()
  const query = new URL(req.url).searchParams
  const date = query.get('date') ?? businessDate(new Date())
  if (!z.iso.date().safeParse(date).success) throw bad('请选择有效的下单日期')
  const ownerId = query.get('ownerId') || c.me.id
  if (ownerId !== c.me.id && !can(c.role, 'order.assign')) throw deny()
  const [owner] = await db.select({ id: users.id, account: users.account, active: users.active, locked: roles.locked, perms: roles.perms })
    .from(users).innerJoin(roles, eq(users.roleId, roles.id)).where(eq(users.id, ownerId))
  if (!owner || !owner.active || (!owner.locked && !owner.perms.includes('order.create'))) throw notFound()
  return json(await suggestOrderNumber(db, owner, date))
})
