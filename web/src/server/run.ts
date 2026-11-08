import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db, type Tx } from './db'
import * as t from './schema'
import { loadWorld, type World } from './repo'
import { ACTIONS, WRITE_LOCK, type Action } from './actions'
import { P2_ACTIONS } from './actions-p2'
import { CHANNEL_RECEIPT_ACTIONS } from './actions-channel-receipts'
import { REIMBURSEMENT_ACTIONS } from './actions-reimbursement'
import { FORUM_ACTIONS } from './actions-forum'
import { DM_ACTIONS } from './actions-dm'
import { cleanupRetractedDmAttachments } from './forum-files'
import { FORUM_COPY } from '@/shared/copy/forum'
import { FEEDBACK_ACTIONS } from './actions-feedback'
import { WRITER_STAGE_ACTIONS } from './actions-writer-stages'
import { COST_ACTIONS } from './actions-costs'
import { URGENCY_ACTIONS } from './actions-urgency'
import { bad, notFound } from './http'
import { broadcast } from './events'
import { notify } from './notify'
import type { Ctx } from './session'

const ALL = { ...ACTIONS, ...P2_ACTIONS, ...REIMBURSEMENT_ACTIONS, ...FEEDBACK_ACTIONS, ...FORUM_ACTIONS, ...DM_ACTIONS, ...CHANNEL_RECEIPT_ACTIONS, ...WRITER_STAGE_ACTIONS, ...URGENCY_ACTIONS, ...COST_ACTIONS } as Record<string, Action<z.ZodType>>

/**
 * 所有写操作的统一入口：校验 → 排队（advisory 锁）→ 读全量 → 执行 → 发提醒 → 广播。
 * 订单相关动作的提醒在这里统一发，不散在各个动作里。
 */
export async function runAction(c: Ctx, name: string, body: unknown) {
  const a = ALL[name]
  const forumAction = name.startsWith('forum.') || name.startsWith('dm.')
  if (!a) throw notFound(forumAction ? FORUM_COPY.errors.notFound : '没有这个操作')
  const parsed = a.schema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message
    const allowed: string[] = Object.values(FORUM_COPY.errors).filter(x => typeof x === 'string')
    throw bad(forumAction ? (allowed.includes(message ?? '') ? message! : FORUM_COPY.errors.unknown) : message ?? '提交的内容不对')
  }
  const input = parsed.data as Record<string, unknown>
  const requestId = input.requestId as string
  if (forumAction && (!requestId || typeof requestId !== 'string')) throw bad(FORUM_COPY.errors.unknown)
  const hash = forumAction ? createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex') : ''
  const result = await db.transaction(async (tx) => {
    // 所有写操作排队执行：先读全量再写的检查在并发下也成立
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    if (forumAction) {
      const [old] = await tx.select().from(t.forumRequests).where(and(eq(t.forumRequests.actorId,c.me.id),eq(t.forumRequests.requestId,requestId)))
      if (old) {
        if (old.action !== name || old.hash !== hash) throw bad(FORUM_COPY.errors.unknown)
        return old.result
      }
    }
    const w = await loadWorld(tx, { includeDeleted: true })
    const r = await a.run(tx, c, w, parsed.data)
    if (forumAction) await tx.insert(t.forumRequests).values({actorId:c.me.id,requestId,action:name,hash,result:r as Record<string,unknown>})
    await notifyAfter(tx, c, w, name, parsed.data as Record<string, unknown>, r as Record<string, unknown>)
    return r
  })
  if (forumAction) {
    const r = result as Record<string,unknown>
    if (name === 'dm.retract' && r.id) await cleanupRetractedDmAttachments(String(r.id))
    const resource = name.startsWith('forum.') ? {type:'post' as const,id:String(r.postId ?? r.id ?? '')} : {type:'dm' as const,id:String(r.threadId ?? r.id ?? '')}
    if(resource.id) broadcast(name.startsWith('forum.') ? 'forum' : 'dm',undefined,resource,name === 'forum.read' ? c.me.id : undefined)
  } else if (!a.quiet) {
    const i=parsed.data as Record<string,unknown>, r=result as Record<string,unknown>
    const orderIds=['order.delete','order.restore'].includes(name)?undefined:name.startsWith('order.') ? (Array.isArray(i.ids)?i.ids as string[]:[String(i.id??r.id??'')]).filter(Boolean) : name.startsWith('aftersale.') ? [String(i.orderId)] : undefined
    broadcast('changed',orderIds)
  }
  return result
}

/** 订单动作触发的提醒：被设为写手、新订单分给你、新售后、被催、换了负责人 */
export async function notifyAfter(tx: Tx, c: Ctx, w: World, name: string, input: Record<string, unknown>, result: Record<string, unknown>) {
  const by = { actorId: c.me.id }
  switch (name) {
    case 'order.setImportance': {
      if (!result.changed || !input.important) return
      const o = w.orders.find(x => x.id === input.id)!
      await notify(tx, o.assignees.map(a => a.userId), { kind: '重要订单', orderId: o.id, tab: 'overview', title: `重要：${o.title}`, body: String(input.note || '请重点关注此订单的交付质量和进度'), ...by })
      return
    }
    case 'order.setUrgency': {
      if (!result.changed) return
      const o = w.orders.find(x => x.id === input.id)!
      if (input.urgent) await notify(tx, o.assignees.map(a => a.userId), { kind: '订单加急', orderId: o.id, tab: 'overview', title: `加急：${o.title}`, body: [input.note, o.dueDate && `截止 ${o.dueDate}`].filter(Boolean).join('\n'), ...by })
      return
    }
    case 'order.create': {
      const id = result.id as string
      const [o] = await tx.select().from(t.orders).where(eq(t.orders.id, id))
      const writers = await tx.select().from(t.orderWriters).where(eq(t.orderWriters.orderId, id))
      await notify(tx, writers.map((x) => x.userId), { kind: o.urgency ? '订单加急' : '新订单', orderId: id, tab: 'overview', title: `${o.urgency ? '加急新单' : '新单交给你写'}：${o.title}`, body: [o.urgency?.note, o.dueDate && `截止 ${o.dueDate}`].filter(Boolean).join('\n'), ...by })
      await notify(tx, [o.ownerId], { kind: '新订单', orderId: id, tab: 'overview', title: `新订单分给你：${o.title}`, body: '', ...by })
      return
    }
    case 'order.bulkWriters': {
      const writerId=input.writerId as string
      for(const id of new Set(input.ids as string[])){
        const o=w.orders.find(o=>o.id===id)!
        if(!o.assignees.some(a=>a.userId===writerId))await notify(tx,[writerId],{kind:o.urgency?'订单加急':'新订单',orderId:o.id,tab:'overview',title:`${o.urgency?'加急：':''}你被设为「${o.title}」的写手`,body:[o.urgency?.note,o.dueDate&&`截止 ${o.dueDate}`].filter(Boolean).join('\n'),...by})
      }
      return
    }
    case 'order.setWriters': {
      const o = w.orders.find((x) => x.id === input.id)!
      const added = (input.writers as { userId: string }[]).map((x) => x.userId).filter((u) => !o.assignees.some((a) => a.userId === u))
      await notify(tx, added, { kind: o.urgency ? '订单加急' : '新订单', orderId: o.id, tab: 'overview', title: `${o.urgency ? '加急：' : ''}你被设为「${o.title}」的写手`, body: [o.urgency?.note, o.dueDate && `截止 ${o.dueDate}`].filter(Boolean).join('\n'), ...by })
      return
    }
    case 'order.update': {
      const o = w.orders.find((x) => x.id === input.id)!
      const owner = (input.patch as { ownerId?: string }).ownerId
      if (owner && owner !== o.ownerId) await notify(tx, [owner], { kind: '新订单', orderId: o.id, tab: 'overview', title: `订单转给你了：${o.title}`, body: '', ...by })
      const due = (input.patch as { dueDate?: string }).dueDate
      if (due && due !== o.dueDate && !c.role.locked && o.assignees.some(a => a.userId === c.me.id)) {
        const admins = w.users.filter(u => u.active && w.roles.some(r => r.id === u.roleId && r.locked)).map(u => u.id)
        await notify(tx, [o.ownerId, ...admins, ...o.assignees.map(a => a.userId)], { kind: '交期调整', orderId: o.id, tab: 'overview', title: `${c.me.name} 调整了「${o.title}」的交付日期`, body: `${o.dueDate ?? '未定'} → ${due}\n${input.reason ?? ''}`, ...by })
      }
      return
    }
    case 'aftersale.create': {
      const [x] = await tx.select().from(t.afterSales).where(eq(t.afterSales.id, result.id as string))
      const o = w.orders.find((y) => y.id === x.orderId)!
      await notify(tx, [x.writerId], { kind: o.urgency ? '订单加急' : '新售后', orderId: o.id, tab: `aftersale:${x.id}`, title: `${o.urgency ? '加急：' : ''}「${o.title}」第 ${x.round} 轮跟进，请 1 小时内确认`, body: [o.urgency?.note, (x.req as string[]).join('；').slice(0, 120) || '见截图'].filter(Boolean).join('\n'), ...by })
      return
    }
    case 'aftersale.confirm':
    case 'aftersale.finish': {
      const o = w.orders.find(o=>o.id===input.orderId)!
      const [a] = await tx.select().from(t.afterSales).where(eq(t.afterSales.id,input.asId as string))
      const done = name === 'aftersale.finish'
      await notify(tx,[a.by,o.ownerId],{kind:done?'售后已交付':'售后已确认',orderId:o.id,tab:`aftersale:${a.id}`,title:`「${o.title}」第 ${a.round} 轮${done?'已交付，可以转给客户':'已确认时间'}`,body:done?'':new Date(a.due).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),key:`${name}:${a.id}`,...by})
      return
    }
    case 'aftersale.nudge': {
      const o = w.orders.find((y) => y.id === input.orderId)!
      const x = o.afterSales.find((y) => y.id === input.asId)!
      await notify(tx, [x.writerId], { kind: '被催', orderId: o.id, tab: `aftersale:${x.id}`, title: `${c.me.name} 催你改「${o.title}」第 ${x.round} 轮`, ...by })
      return
    }
    case 'aftersale.update': {
      const o = w.orders.find((y) => y.id === input.orderId)!
      const x = o.afterSales.find((y) => y.id === input.asId)!
      const to = input.writerId as string | undefined
      if (to && to !== x.writerId) await notify(tx, [to], { kind: '新售后', orderId: o.id, tab: `aftersale:${x.id}`, title: `「${o.title}」第 ${x.round} 轮修改转给你`, ...by })
      return
    }
  }
}
