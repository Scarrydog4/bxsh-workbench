import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import * as t from './schema'
import { log, WRITE_LOCK, isoDate, dataImage } from './actions'
import { bad, deny, notFound } from './http'
import { saveAvatar } from './images'
import { broadcast } from './events'
import type { Ctx } from './session'
import { sumMoney } from '@/shared/calc'

const date = isoDate.refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, '日期无效')
export const contractorInput = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100), note: z.string().trim().max(1000).default(''), avatar: dataImage.optional(), active: z.boolean().default(true) })
export const contractorPaymentInput = z.object({ id: z.uuid(), contractorId: z.uuid(), amount: z.number().positive().max(10_000_000).multipleOf(.01), date, note: z.string().trim().min(1,'请填写付款依据').max(1000) })
export function requireContractors(c: Ctx) { if (!c.role.locked) throw deny() }

export async function contractorReport(c: Ctx) {
  requireContractors(c)
  const [partners, costs, payments] = await Promise.all([
    db.select().from(t.contractors).orderBy(t.contractors.name),
    db.select({ id:t.orderCosts.id, contractorId:t.orderCosts.contractorId, contractor:t.orderCosts.contractor, title:t.orders.title, orderId:t.orders.id, orderDeleted:t.orders.deletedAt, name:t.orderCosts.name, amount:t.orderCosts.amount, date:t.orderCosts.date, note:t.orderCosts.note, proof:t.orderCosts.proof }).from(t.orderCosts).innerJoin(t.orders, eq(t.orderCosts.orderId,t.orders.id)).where(isNull(t.orderCosts.revokedAt)),
    db.select().from(t.contractorPayments).orderBy(t.contractorPayments.date),
  ])
  const rows = partners.map(partner => {
    // 历史文字成本按名称读取；不改写原成本，也不触碰订单工资。
    const names = new Set([partner.name,...partner.aliases])
    const lines = costs.filter(line => line.contractorId === partner.id || !line.contractorId && names.has(line.contractor))
    const paidLines = payments.filter(p => p.contractorId === partner.id)
    const cost = sumMoney(lines.map(line => line.amount)), paid = sumMoney(paidLines.filter(p=>!p.revokedAt).map(p=>p.amount))
    return { ...partner, cost, paid, remaining:Math.max(0,sumMoney([cost,-paid])), advance:Math.max(0,sumMoney([paid,-cost])), lines, payments:paidLines }
  })
  return { rows, unfiled: [...new Set(costs.filter(cost=>!cost.contractorId && cost.contractor && !partners.some(p=>[p.name,...p.aliases].includes(cost.contractor))).map(c=>c.contractor))] }
}
export type ContractorReport = Awaited<ReturnType<typeof contractorReport>>

export async function saveContractor(c: Ctx, body: z.infer<typeof contractorInput>) {
  requireContractors(c)
  const avatar = body.avatar ? await saveAvatar(body.avatar) : undefined
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const all = await tx.select().from(t.contractors)
    const old = all.find(p=>p.id===body.id)
    if (all.some(p=>p.id!==body.id && [p.name,...p.aliases].includes(body.name))) throw bad('已有同名或曾用名的合作方')
    const aliases = [...new Set([...(old?.aliases??[]),...(old && old.name!==body.name ? [old.name]:[])])]
    const values = {name:body.name,note:body.note,active:body.active,aliases,updatedAt:new Date().toISOString(),...(avatar ? {avatar}:{})}
    await tx.insert(t.contractors).values({id:body.id,...values}).onConflictDoUpdate({target:t.contractors.id,set:values})
    await log(tx,c,{action:old?'修改外包合作方':'新建外包合作方',objectType:'contractor',fieldGroup:'profit',objectId:body.id,objectLabel:body.name})
  })
  broadcast()
}
export async function payContractor(c: Ctx, body: z.infer<typeof contractorPaymentInput>) {
  requireContractors(c)
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const [partner] = await tx.select().from(t.contractors).where(eq(t.contractors.id,body.contractorId))
    if (!partner?.active) throw bad('合作方不存在或已停用')
    const [old] = await tx.select().from(t.contractorPayments).where(eq(t.contractorPayments.id,body.id))
    if (old) {
      if(old.contractorId!==body.contractorId || old.amount!==body.amount || old.date!==body.date || old.note!==body.note) throw bad('这笔付款已记录，请刷新')
      return
    }
    await tx.insert(t.contractorPayments).values({...body,by:c.me.id})
    await log(tx,c,{action:'登记外包付款',objectType:'contractor',fieldGroup:'profit',objectId:partner.id,objectLabel:partner.name,to:String(body.amount),note:body.note})
  })
  broadcast()
}
export async function revokeContractorPayment(c: Ctx, id: string, reason: string) {
  requireContractors(c)
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const [old] = await tx.select().from(t.contractorPayments).where(eq(t.contractorPayments.id,id))
    if(!old) throw notFound()
    if(old.revokedAt) return
    await tx.update(t.contractorPayments).set({revokedAt:new Date().toISOString(),revokeReason:reason}).where(and(eq(t.contractorPayments.id,id),isNull(t.contractorPayments.revokedAt)))
    await log(tx,c,{action:'撤销外包付款',objectType:'contractor',fieldGroup:'profit',objectId:old.contractorId,from:String(old.amount),to:'已撤销',note:reason})
  })
  broadcast()
}
