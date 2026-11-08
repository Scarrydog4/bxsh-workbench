import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { act, log, need, orderFor } from './actions'
import * as t from './schema'

export const URGENCY_ACTIONS = {
  'order.setImportance': act({
    schema: z.object({ id: z.string(), important: z.boolean(), note: z.string().trim().max(500).default('') }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.id, 'order.edit')
      need(c, 'order.create')
      if ((!i.important && !o.importance) || (i.important && o.importance?.note === i.note)) return { ok: true, changed: false }
      const importance = i.important ? { note: i.note, at: new Date().toISOString(), by: c.me.id } : null
      await tx.update(t.orders).set({ importance, updatedAt: new Date().toISOString() }).where(eq(t.orders.id, o.id))
      await log(tx, c, { action: i.important ? '标记重要' : '取消重要', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '重要', from: o.importance ? `重要 ${o.importance.note}`.trim() : '普通', to: importance ? `重要 ${importance.note}`.trim() : '普通' })
      return { ok: true, changed: true }
    },
  }),
  'order.setUrgency': act({
    schema: z.object({ id: z.string(), urgent: z.boolean(), note: z.string().trim().max(500).default('') }),
    run: async (tx, c, w, i) => {
      const o = orderFor(w, c, i.id, 'order.edit')
      need(c, 'order.create')
      if ((!i.urgent && !o.urgency) || (i.urgent && o.urgency?.note === i.note)) return { ok: true, changed: false }
      const urgency = i.urgent ? { note: i.note, at: new Date().toISOString(), by: c.me.id } : null
      await tx.update(t.orders).set({ urgency }).where(eq(t.orders.id, o.id))
      await log(tx, c, { action: i.urgent ? '标记加急' : '取消加急', objectType: 'order', objectId: o.id, objectLabel: o.no, field: '加急', from: o.urgency ? `加急 ${o.urgency.note}`.trim() : '普通', to: urgency ? `加急 ${urgency.note}`.trim() : '普通' })
      return { ok: true, changed: true }
    },
  }),
}
