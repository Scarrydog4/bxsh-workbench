import { eq } from 'drizzle-orm'
import type { Tx } from './db'
import * as t from './schema'
import type { World } from './repo'
import type { AfterSale, Order } from '@/shared/types'
import { notify } from './notify'

/** 与业务写入共用锁后调用；即使无人在线，时效事件仍落库一次。 */
export async function recordAfterSaleTime(tx: Tx, w: World, o: Order, a: AfterSale, now: Date) {
  if (a.doneAt || a.cancelledAt) return 0
  let sent = 0
  const managers = w.users.filter(u => u.active && w.roles.some(r => r.id === u.roleId && r.locked)).map(u => u.id)
  const all = [a.writerId, a.by, o.ownerId, ...managers]
  const field = `第 ${a.round} 轮修改`
  const base = { orderId: o.id, tab: `aftersale:${a.id}` }
  const audit = async (action: string, to: string) => tx.insert(t.audit).values({actorId:'system',action,objectType:'order',objectId:o.id,objectLabel:o.no,field,to,at:now.toISOString()})
  const confirmEnd = a.confirmBy ? new Date(a.confirmBy).getTime() : null
  if (confirmEnd && !a.confirmedAt) {
    const left = confirmEnd - now.getTime()
    if (left > 0 && left <= 15 * 60_000) sent += await notify(tx,[a.writerId],{...base,kind:'售后待确认',title:`「${o.title}」还剩 15 分钟确认`,key:`confirm-soon:${a.id}`})
    if (left <= 0 && !a.lateConfirm) {
      await tx.update(t.afterSales).set({lateConfirm:true}).where(eq(t.afterSales.id,a.id))
      await audit('超时未确认', `按发布后 24 小时交付：${a.due}`)
      sent += await notify(tx,all,{...base,kind:'超时未确认',title:`「${o.title}」第 ${a.round} 轮未及时确认`,body:'按发布后 24 小时交付',key:`confirm-late:${a.id}`})
    }
  }
  const left = new Date(a.due).getTime() - now.getTime()
  if (left > 0 && left <= 3600_000) sent += await notify(tx,[a.writerId],{...base,kind:'售后到期',title:`「${o.title}」第 ${a.round} 轮 1 小时内到期`,key:`as1h:${a.id}:${a.due}`})
  if (left <= 0 && !a.overdueAt) {
    await tx.update(t.afterSales).set({overdueAt:now.toISOString()}).where(eq(t.afterSales.id,a.id))
    await audit('逾期未交付',a.due)
    sent += await notify(tx,all,{...base,kind:'售后逾期',title:`「${o.title}」第 ${a.round} 轮已逾期`,key:`asLate:${a.id}`})
  }
  return sent
}
