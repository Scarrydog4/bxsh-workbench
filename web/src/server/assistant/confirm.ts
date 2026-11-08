import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { audit } from '../schema'
import { loadWorld } from '../repo'
import { ACTIONS } from '../actions'
import { notifyAfter } from '../run'
import { bad, deny } from '../http'
import { broadcast } from '../events'
import type { Ctx } from '../session'
import { can } from '@/shared/perm'
import { confirmInput, type CreatedOrder } from '@/shared/assistant'

export async function confirmOrders(c: Ctx, body: unknown): Promise<{ orders: CreatedOrder[] }> {
  const parsed = confirmInput.safeParse(body)
  if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? '请先补齐必填字段')
  const i = parsed.data
  const key = `ai-batch:${i.batchId}`
  const hash = createHash('sha256').update(JSON.stringify(i.orders)).digest('hex')
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(20261007)`)
    let w = await loadWorld(tx, { includeDeleted: true })
    const user = w.users.find((u) => u.id === c.me.id && u.active)
    const role = w.roles.find((r) => r.id === user?.roleId)
    if (!user || !role || !can(role, 'order.create')) throw deny('当前账号没有录单权限')
    const fresh = { ...c, me: { ...user, mustChangePassword: c.me.mustChangePassword }, role }
    const [previous] = await tx.select().from(audit).where(and(eq(audit.objectId, key), eq(audit.objectType, 'assistantBatch')))
    if (previous) {
      if (previous.actorId !== c.me.id || previous.from !== hash) throw bad('这批订单已确认，请刷新结果后再录下一批')
      return JSON.parse(previous.to!) as { orders: CreatedOrder[] }
    }
    const orders: CreatedOrder[] = []
    for (const input of i.orders) {
      let channelId = input.channelId
      if (!channelId && input.newChannelName) {
        const same = w.channels.find((ch) => ch.name === input.newChannelName)
        if (same) channelId = same.id
        else {
          const channel = await ACTIONS['channel.create'].run(tx, fresh, w, { name: input.newChannelName, ownerId: input.ownerId }) as { id: string }
          channelId = channel.id
          w = await loadWorld(tx, { includeDeleted: true })
        }
      }
      if (channelId ? !w.channels.some((ch) => ch.id === channelId && ch.active && !ch.deletedAt) : input.salesMode !== 'cost') throw bad('请选择有效渠道，底价结算可不填渠道')
      const payload = ACTIONS['order.create'].schema.parse({ ...input, channelId, via: 'AI 录入' })
      const created = await ACTIONS['order.create'].run(tx, fresh, w, payload) as CreatedOrder
      orders.push(created)
      await notifyAfter(tx, fresh, w, 'order.create', payload, created)
      // 同一事务的多单共享选项，避免后一单覆盖前一单的新类型。
      if (input.type && !w.types.includes(input.type)) w.types.push(input.type)
    }
    const receipt = { orders }
    await tx.insert(audit).values({ actorId: c.me.id, action: 'AI 批量确认', objectType: 'assistantBatch', objectId: key, objectLabel: `${orders.length} 单`, from: hash, to: JSON.stringify(receipt), ip: c.ip })
    return receipt
  })
  broadcast()
  return result
}
