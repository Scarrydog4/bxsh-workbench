import { and, eq, inArray, isNull } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { act, log, orderFor } from './actions'
import { bad, deny } from './http'
import * as t from './schema'
import type { Tx } from './db'
import type { Ctx } from './session'
import { isStagedWriterPay, writerInitialDone, writerGroupDone } from '@/shared/writer-stages'

async function stageProof(tx: Tx, c: Ctx, orderId: string, proofIds: string[], stage: 'completed' | 'groupSent') {
  if (!proofIds.length) throw bad(stage === 'completed' ? '请附初稿完成的电脑截图' : '请附群内发稿截图')
  const ids = [...new Set(proofIds)]
  const files = await tx.select().from(t.attachments).where(and(eq(t.attachments.orderId, orderId), inArray(t.attachments.id, ids), isNull(t.attachments.deletedAt)))
  if (files.length !== ids.length || files.some(file => file.afterSaleId !== null || file.purpose !== 'file' || !file.mime.startsWith('image/'))) throw bad('截图不属于这单的有效附件')
  if (!c.role.locked && files.some(file => file.by !== c.me.id)) throw deny('请使用自己上传的截图')
  for (const file of files) {
    const meta = await sharp(file.path).metadata().catch(() => null)
    if (!meta?.width || !meta.height) throw bad('截图无法读取，请重新上传')
  }
  return ids
}

export const WRITER_STAGE_ACTIONS = {
  'order.writerStage': act({
    schema: z.object({ id: z.string(), userId: z.string(), stage: z.enum(['completed', 'groupSent']), proofIds: z.array(z.string()).max(20).default([]) }),
    run: async (tx, c, w, input) => {
      const order = orderFor(w, c, input.id, 'order.draft')
      if (!c.role.locked && input.userId !== c.me.id) throw deny('只能提交自己的写作进度')
      if (!order.assignees.some(writer => writer.userId === input.userId)) throw bad('该写手不在这单中')
      if (!isStagedWriterPay(order)) throw bad('这单沿用原交付方式')
      if (order.status === '退单') throw bad('退单不能提交写作进度')
      const previous = order.writerProgress?.find(progress => progress.userId === input.userId)
      if (input.stage === 'completed' ? writerInitialDone(order, input.userId) : writerGroupDone(order, input.userId)) return { ok: true }
      if (input.stage === 'groupSent' && !writerInitialDone(order, input.userId)) throw bad('请先确认初稿完成，再记录群内发稿')
      const proofIds = await stageProof(tx, c, order.id, input.proofIds, input.stage)
      const now = new Date().toISOString()
      const progress = { userId: input.userId, completedAt: previous?.completedAt ?? null, completedProofIds: previous?.completedProofIds ?? [], groupSentAt: previous?.groupSentAt ?? null, groupProofIds: previous?.groupProofIds ?? [] }
      if (input.stage === 'completed') { progress.completedAt = now; progress.completedProofIds = proofIds }
      else { progress.groupSentAt = now; progress.groupProofIds = proofIds }
      await tx.insert(t.writerProgress).values({ orderId: order.id, ...progress }).onConflictDoUpdate({
        target: [t.writerProgress.orderId, t.writerProgress.userId],
        set: input.stage === 'completed' ? { completedAt: now, completedProofIds: proofIds } : { groupSentAt: now, groupProofIds: proofIds },
      })
      const allProgress = [...(order.writerProgress ?? []).filter(row => row.userId !== input.userId), progress]
      const updated = { ...order, writerProgress: allProgress }
      const allSent = writerGroupDone(updated)
      // 只在全部交付时推进状态，不把已交付的单打回去。
      if (allSent) await tx.update(t.orders).set({ status: '已交付', updatedAt: now, draftAt: order.draftAt ?? now }).where(eq(t.orders.id, order.id))
      const writer = w.users.find(user => user.id === input.userId)
      await log(tx, c, { action: input.stage === 'completed' ? '初稿完成' : '群内发稿', objectType: 'order', objectId: order.id, objectLabel: order.no, field: '写作进度', to: `${writer?.name ?? input.userId} · ${input.stage === 'completed' ? '初稿完成' : '已发到群'}`, note: `${proofIds.length} 张截图` })
      return { ok: true }
    },
  }),
  'order.confirmGraduation': act({
    schema: z.object({ id: z.string() }),
    run: async (tx, c, w, input) => {
      if (!c.role.locked) throw deny('只有管理员能确认毕业')
      const order = orderFor(w, c, input.id, 'order.draft')
      if (order.writerPayPlan !== 'staged') throw bad('这单尚未启用分阶段工资')
      if (order.status === '退单') throw bad('退单不能确认毕业')
      if (order.graduatedAt) return { ok: true }
      if (!order.assignees.some(writer => order.writerProgress?.some(row => row.userId === writer.userId && row.groupSentAt))) throw bad('请先记录群内发稿，再确认毕业')
      const now = new Date().toISOString()
      await tx.update(t.orders).set({ graduatedAt: now, updatedAt: now }).where(eq(t.orders.id, order.id))
      await log(tx, c, { action: '确认毕业', objectType: 'order', objectId: order.id, objectLabel: order.no, field: '毕业', to: '已毕业' })
      return { ok: true }
    },
  }),
  'order.enableStagedPay': act({
    schema: z.object({ id: z.string(), plan: z.enum(['staged', 'completed_balance_50_50']).default('staged') }),
    run: async (tx, c, w, input) => {
      if (!c.role.locked) throw deny('只有管理员能调整工资规则')
      const order = orderFor(w, c, input.id, 'order.assign')
      if (order.writerPayPlan === input.plan) return { ok: true }
      if (order.writerPayPlan === 'completed_balance_50_50' && input.plan === 'staged') throw bad('这单已使用两期工资，请刷新后再操作')
      if (order.settlements.some(line => line.kind === '写手工资' && line.status === '草稿')) throw bad('请先处理这单的工资草稿，再启用分阶段工资')
      await tx.update(t.orders).set({ writerPayPlan: input.plan, updatedAt: new Date().toISOString() }).where(eq(t.orders.id, order.id))
      await log(tx, c, { action: '启用分阶段工资', objectType: 'order', objectId: order.id, objectLabel: order.no, field: '工资规则', from: order.writerPayPlan === 'staged' ? '初稿 50% · 群发 20% · 毕业 30%' : '原规则', to: input.plan === 'completed_balance_50_50' ? '初稿完成 50% · 群内交付且客户款收齐 50%' : '初稿 50% · 群发 20% · 毕业 30%', fieldGroup: 'writerPay' })
      return { ok: true }
    },
  }),
}
