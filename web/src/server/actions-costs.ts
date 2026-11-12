import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { act, dataImage, isoDate, log, orderFor, syncFixedAmount } from './actions'
import { bad, deny } from './http'
import { privateImageUrl, saveOrderImage } from './images'
import * as t from './schema'
import { money } from '@/shared/format'

const day = isoDate.refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, '日期无效')

export const COST_ACTIONS = {
  'order.addCost': act({
    schema: z.object({
      id: z.string(), requestId: z.string().uuid(),
      name: z.string().trim().min(1, '请填写成本项目').max(100),
      contractor: z.string().trim().max(100).default(''), contractorId: z.string().nullable().optional(),
      amount: z.number().positive('成本金额须大于 0').max(10_000_000).multipleOf(.01),
      date: day, note: z.string().trim().max(500).default(''), proof: dataImage.optional(),
    }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('只有老板能登记额外成本')
      const o = orderFor(w, c, i.id, 'order.price'), id = `cost-${i.id}-${c.me.id}-${i.requestId}`
      if (o.extraCosts?.some(line => line.id === id)) return { ok: true, id }
      let contractor = i.contractor
      if (i.contractorId) {
        const [partner] = await tx.select().from(t.contractors).where(eq(t.contractors.id, i.contractorId))
        if (!partner?.active) throw bad('外包合作方不存在或已停用')
        contractor = partner.name
      }
      const proof = i.proof ? privateImageUrl(await saveOrderImage(tx, i.proof, { orderId: o.id, by: c.me.id, purpose: 'cost-proof' })) : undefined
      const line = { id, name: i.name, contractor, contractorId: i.contractorId, amount: i.amount, date: i.date, note: i.note, proof, at: new Date().toISOString(), by: c.me.id }
      await tx.insert(t.orderCosts).values({ ...line, orderId: o.id })
      await syncFixedAmount(tx, c, w, o, { ...o, extraCosts: [...o.extraCosts ?? [], line] }, false)
      await log(tx, c, { action: '登记成本', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '额外成本', to: `${i.name} ${money(i.amount)}${i.contractor ? ` · ${i.contractor}` : ''} · ${i.date}`, fieldGroup: 'profit', note: i.note, proof })
      return { ok: true, id }
    },
  }),
  'order.revokeCost': act({
    schema: z.object({ id: z.string(), costId: z.string(), reason: z.string().trim().min(1, '请填写撤销原因').max(500) }),
    run: async (tx, c, w, i) => {
      if (!c.role.locked) throw deny('只有老板能撤销额外成本')
      const o = orderFor(w, c, i.id, 'order.price'), line = o.extraCosts?.find(line => line.id === i.costId)
      if (!line) throw bad('找不到这笔成本')
      if (line.revoked) return { ok: true }
      const revoked = { at: new Date().toISOString(), by: c.me.id, reason: i.reason }
      await tx.update(t.orderCosts).set({ revokedAt: revoked.at, revokedBy: revoked.by, revokeReason: revoked.reason }).where(eq(t.orderCosts.id, line.id))
      await syncFixedAmount(tx, c, w, o, { ...o, extraCosts: o.extraCosts?.map(item => item.id === line.id ? { ...item, revoked } : item) }, false)
      await log(tx, c, { action: '撤销成本', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '额外成本', from: `${line.name} ${money(line.amount)}`, to: '已撤销', fieldGroup: 'profit', note: i.reason })
      return { ok: true }
    },
  }),
}
