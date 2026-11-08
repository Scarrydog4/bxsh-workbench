import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { and, eq, desc, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db } from './db'
import * as t from './schema'
import type { Ctx } from './session'
import { bad, deny, notFound } from './http'
import { newFilePath, safeName } from './files'
import { loadWorld } from './repo'
import { can, rowVisible } from '@/shared/perm'
import { MAX_REWRITE_BATCH, MAX_REWRITE_INPUT, MAX_REWRITE_RESULT, MAX_REWRITE_TEXT, type RewriteJobView, type RewriteStatus, type RewriteLanguage } from '@/shared/toolbox'
import { listRewritePlatforms, submitRewrite, pollRewrite, downloadRewrite, wordExtension, ProviderError, providerMessage, type ProviderJob } from './rewrite-provider'
import { broadcast } from './events'
import { priceOf, reservePoints, settlePoints } from './points'

type Job = typeof t.rewriteJobs.$inferSelect
export function requireToolbox(c: Ctx) { if (!can(c.role, 'toolbox.use') && !can(c.role, 'toolbox.manage') && !can(c.role, 'points.manage')) throw deny() }

async function visibleOrders(c: Ctx) {
  const w = await loadWorld(db)
  return can(c.role, 'order.view') ? w.orders.filter((o) => rowVisible(o, c.me, c.role)) : []
}

export async function jobVisible(c: Ctx, id: string) {
  requireToolbox(c)
  const [job] = await db.select().from(t.rewriteJobs).where(eq(t.rewriteJobs.id, id))
  if (!job) throw notFound()
  if (can(c.role, 'toolbox.manage')) return job
  if (job.userId !== c.me.id || job.orderId && !(await visibleOrders(c)).some((o) => o.id === job.orderId)) throw notFound()
  return job
}

export async function listJobs(c: Ctx): Promise<RewriteJobView[]> {
  requireToolbox(c)
  const manage = can(c.role, 'toolbox.manage')
  const visible = await visibleOrders(c)
  const where = manage ? undefined : and(eq(t.rewriteJobs.userId, c.me.id), or(isNull(t.rewriteJobs.orderId), inArray(t.rewriteJobs.orderId, visible.map((o) => o.id))))
  const rows = await db.select({ job: t.rewriteJobs, actorName: t.users.name }).from(t.rewriteJobs)
    .innerJoin(t.users, eq(t.users.id, t.rewriteJobs.userId)).where(where).orderBy(desc(t.rewriteJobs.createdAt)).limit(100)
  return rows.map(({ job: j, actorName }) => {
    const order = visible.find((o) => o.id === j.orderId)
    return { id: j.id, name: j.name, platform: j.platformName, language: j.language as RewriteLanguage, status: j.status as RewriteStatus,
      message: j.message, createdAt: j.createdAt, updatedAt: j.updatedAt, orderId: order?.id ?? null, orderNo: order?.no ?? null,
      orderTitle: order?.title ?? null, userId: j.userId, actorName, resultName: j.resultName, resultAttachmentId: j.resultAttachmentId, batchId: j.batchId, points: j.points, inputKind: j.rewriteOptions?.inputKind ?? 'file', service: j.rewriteOptions?.service, progress: j.providerState.progress, hasDiff: !!j.providerState.diffUrl, sourceSize: j.size, resultSize: j.resultSize ?? undefined, hasReport: !!j.providerState.reportFiles?.html_detail_url, hasPdf: !!j.providerState.reportFiles?.pdf_enabled && !!j.providerState.reportFiles?.pdf_summary_url }
  })
}

export async function createRewrite(c: Ctx, input: { platform: string; language: RewriteLanguage; orderId?: string; attachmentId?: string; file?: File; text?: string; whitelist?: string; expectedPoints: number; draftOnly?: boolean }) {
  if (!can(c.role, 'toolbox.use')) throw deny()
  const platforms = await listRewritePlatforms()
  const chosen = platforms.find((p) => p.id === input.platform)
  if (!chosen || !chosen.languages.includes(input.language)) throw bad('请选择支持当前语言的检测平台')
  let bytes: Buffer, name: string
  const options = { service: chosen.service ?? '双降' as const, platform: chosen.platform ?? chosen.name,
    presetZh: chosen.presetZh, presetEn: chosen.presetEn,
    preset: chosen.preset ?? chosen.id, whitelist: (input.whitelist ?? '').replace(/，/g, ',').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).join(','),
    inputKind: input.text !== undefined ? 'text' as const : 'file' as const }
  if (input.orderId && !(await visibleOrders(c)).some((o) => o.id === input.orderId)) throw notFound()
  if (input.text !== undefined) {
    if (!input.text.trim() || input.text.length > MAX_REWRITE_TEXT || input.file || input.attachmentId) throw bad('请输入 10 万字以内的正文，文本和文件请分别提交')
    bytes = Buffer.from(input.text, 'utf8'); name = '文本改写.txt'
  } else if (input.attachmentId) {
    const [f] = await db.select().from(t.attachments).where(and(eq(t.attachments.id, input.attachmentId), isNull(t.attachments.deletedAt)))
    if (!f || f.orderId !== input.orderId) throw notFound()
    if (f.size > MAX_REWRITE_INPUT) throw bad('Word 文件不能超过 10MB')
    name = f.name
    bytes = await readFile(f.path)
  } else {
    if (!input.file || !input.file.size || input.file.size > MAX_REWRITE_INPUT) throw bad('请选择 10MB 以内的 DOCX 文件')
    name = safeName(input.file.name)
    bytes = Buffer.from(await input.file.arrayBuffer())
  }
  if (options.inputKind === 'file' && (!/\.docx$/i.test(name) || bytes.length > MAX_REWRITE_INPUT || wordExtension(bytes) !== '.docx')) throw bad('请选择有效的 DOCX 文件；DOC 请先另存为 DOCX')
  const fingerprint = createHash('sha256').update(bytes).update(JSON.stringify([chosen.id, input.language, input.orderId ?? null, options])).digest('hex')
  const [prior] = await db.select().from(t.rewriteJobs).where(and(eq(t.rewriteJobs.userId, c.me.id), eq(t.rewriteJobs.fingerprint, fingerprint)))
  if (prior) {
    if (prior.status === 'draft' && !input.draftOnly) {
      await commitRewriteBatch(c, { requestId: randomUUID(), jobIds: [prior.id], expectedPoints: input.expectedPoints })
      return { id: prior.id, reused: false }
    }
    return { id: prior.id, reused: true }
  }
  const id = randomUUID().replaceAll('-', '')
  const sourcePath = await newFilePath(`rewrite-${id}-source`)
  await writeFile(sourcePath, bytes, { flag: 'wx', mode: 0o600 })
  const result = await db.transaction(async (tx) => {
    const price = input.draftOnly ? { points: 0 } : await priceOf(tx)
    if (!price) throw bad('管理员尚未设置本次处理积分，请联系管理员')
    if (!input.draftOnly && price.points !== input.expectedPoints) throw bad('处理积分已调整，请刷新页面确认后再提交')
    const [saved] = await tx.insert(t.rewriteJobs).values({ id, userId: c.me.id, orderId: input.orderId ?? null, sourceAttachmentId: input.attachmentId ?? null,
      name, sourcePath, size: bytes.length, fingerprint, platformId: chosen.id, platformName: chosen.name, language: input.language, rewriteOptions: options, points: price.points, status: input.draftOnly ? 'draft' : 'queued', pointStatus: input.draftOnly ? 'none' : 'reserved' })
      .onConflictDoNothing({ target: [t.rewriteJobs.userId, t.rewriteJobs.fingerprint] }).returning({ id: t.rewriteJobs.id })
    if (!saved) {
      const [existing] = await tx.select({ id: t.rewriteJobs.id }).from(t.rewriteJobs).where(and(eq(t.rewriteJobs.userId, c.me.id), eq(t.rewriteJobs.fingerprint, fingerprint)))
      return { id: existing.id, reused: true }
    }
    if (!input.draftOnly) await reservePoints(tx, id, c.me.id, price.points)
    await tx.insert(t.audit).values({ actorId: c.me.id, action: input.draftOnly ? '上传待确认稿件' : '提交笔像双降', objectType: input.orderId ? 'order' : 'toolbox', objectId: input.orderId ?? id,
      objectLabel: name, to: `${chosen.name} · ${input.language}`, ip: c.ip })
    return { id, reused: false }
  }).catch(async (e) => { await unlink(sourcePath).catch(() => {}); throw e })
  if (result.reused) {
    await unlink(sourcePath).catch(() => {})
    if (!input.draftOnly) {
      const [existing] = await db.select().from(t.rewriteJobs).where(eq(t.rewriteJobs.id, result.id))
      if (existing.status === 'draft') {
        await commitRewriteBatch(c, { requestId: randomUUID(), jobIds: [result.id], expectedPoints: input.expectedPoints })
        return { id: result.id, reused: false }
      }
    }
  }
  broadcast()
  return result
}

/** 确认整批后统一预占；断线重试同一批次不会再次计费。 */
export async function commitRewriteBatch(c: Ctx, input: { requestId: string; jobIds: string[]; expectedPoints: number }) {
  if (!can(c.role, 'toolbox.use')) throw deny()
  const ids = [...new Set(input.jobIds)].sort()
  if (!ids.length || ids.length > MAX_REWRITE_BATCH) throw bad('每批请选择 1–20 份稿件')
  const visible = await visibleOrders(c)
  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(t.rewriteBatches).values({ id: input.requestId, userId: c.me.id, jobIds: ids, unitPoints: input.expectedPoints })
      .onConflictDoNothing().returning()
    if (!inserted) {
      const [prior] = await tx.select().from(t.rewriteBatches).where(eq(t.rewriteBatches.id, input.requestId))
      if (prior.userId !== c.me.id) throw notFound()
      if (JSON.stringify(prior.jobIds) !== JSON.stringify(ids) || prior.unitPoints !== input.expectedPoints) throw bad('批次编号已使用，请重新确认稿件')
      return { batchId: prior.id, jobIds: prior.jobIds, totalPoints: prior.totalPoints, createdCount: prior.createdCount, reusedCount: prior.reusedCount, reused: true }
    }
    const jobs = await tx.select().from(t.rewriteJobs).where(inArray(t.rewriteJobs.id, ids)).orderBy(t.rewriteJobs.id).for('update')
    if (jobs.length !== ids.length || jobs.some((j) => j.userId !== c.me.id || j.orderId && !visible.some((o) => o.id === j.orderId))) throw notFound()
    const drafts = jobs.filter((j) => j.status === 'draft')
    if (drafts.length) {
      const price = await priceOf(tx)
      if (!price || price.points !== input.expectedPoints) throw bad('处理积分已调整，请刷新页面确认后再提交')
      for (const j of drafts) {
        await reservePoints(tx, j.id, c.me.id, price.points)
        await tx.update(t.rewriteJobs).set({ status: 'queued', batchId: input.requestId, points: price.points, pointStatus: 'reserved', updatedAt: new Date().toISOString() }).where(eq(t.rewriteJobs.id, j.id))
      }
    }
    const receipt = { totalPoints: drafts.length * input.expectedPoints, createdCount: drafts.length, reusedCount: ids.length - drafts.length }
    await tx.update(t.rewriteBatches).set(receipt).where(eq(t.rewriteBatches.id, input.requestId))
    await tx.insert(t.audit).values({ actorId: c.me.id, action: '批量提交笔像双降', objectType: 'toolbox', objectId: input.requestId,
      objectLabel: `${drafts.length} 份稿件 · ${receipt.totalPoints} 积分`, ip: c.ip })
    return { batchId: input.requestId, jobIds: ids, ...receipt, reused: false }
  })
  broadcast()
  return result
}

async function saveResult(job: Job) {
  const [latest] = await db.select().from(t.rewriteJobs).where(eq(t.rewriteJobs.id, job.id))
  let bytes: Buffer = await downloadRewrite(job.id, latest.providerState)
  const resultMessage = '已保存上游完整返回稿'
  const providerState = { ...latest.providerState, formatPreserved: false }
  delete providerState.preservation
  const ext = job.rewriteOptions?.inputKind === 'text' ? (bytes.toString('utf8').trim() ? '.txt' : null) : wordExtension(bytes)
  if (!ext || bytes.length > MAX_REWRITE_RESULT) throw new ProviderError('response_invalid')
  const name = safeName(`${job.name.replace(/\.(docx|txt)$/i, '').slice(0, 70)}_${job.rewriteOptions?.service ?? '双降'}_${job.platformName.slice(0, 90)}`).slice(0, 190) + ext
  const resultPath = await newFilePath(`rewrite-${job.id}-result`)
  const temp = `${resultPath}.tmp`
  await writeFile(temp, bytes, { mode: 0o600 })
  await rename(temp, resultPath)
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(t.rewriteJobs).where(eq(t.rewriteJobs.id, job.id)).for('update')
    if (current.status === 'completed') return
    const attachmentId = job.orderId ? `f_rewrite_${job.id}` : null
    if (job.orderId && attachmentId) {
      await tx.insert(t.attachments).values({ id: attachmentId, orderId: job.orderId, name, size: bytes.length,
        mime: ext === '.txt' ? 'text/plain; charset=utf-8' : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword', path: resultPath, by: job.userId }).onConflictDoNothing()
    }
    await tx.update(t.rewriteJobs).set({ status: 'completed', message: resultMessage, providerState, resultPath, resultName: name, resultSize: bytes.length,
      resultAttachmentId: attachmentId, leaseUntil: null, updatedAt: new Date().toISOString() }).where(eq(t.rewriteJobs.id, job.id))
    await settlePoints(tx, job.id, true)
    await tx.insert(t.audit).values({ actorId: job.userId, action: '笔像双降完成', objectType: job.orderId ? 'order' : 'toolbox', objectId: job.orderId ?? job.id, objectLabel: name })
  })
  broadcast()
}

const terminal = new Set(['failed', 'not_started'])
const uncertain = new Set(['unknown', 'unconfirmed', 'poll_timeout'])
async function applyProvider(job: Job, p: ProviderJob) {
  if (p.state) await db.update(t.rewriteJobs).set({ providerState: p.state }).where(eq(t.rewriteJobs.id, job.id))
  if (p.status === 'completed' || p.status === 'succeeded') {
    await db.update(t.rewriteJobs).set({ status: 'saving', message: null }).where(eq(t.rewriteJobs.id, job.id))
    await saveResult(job)
    return
  }
  const status = terminal.has(p.status) ? 'failed' : uncertain.has(p.status) ? 'unknown' : 'processing'
  await db.transaction(async (tx) => {
    await tx.update(t.rewriteJobs).set({ status, message: p.errorCode ? providerMessage(p.errorCode) : null, leaseUntil: null,
      nextPollAt: new Date(Date.now() + 20_000).toISOString(), updatedAt: new Date().toISOString() }).where(eq(t.rewriteJobs.id, job.id))
    if (status === 'failed') await settlePoints(tx, job.id, false)
  })
}

/** 数据库行锁和租约跨进程生效；重启后提交过的任务只查状态。 */
export async function runRewriteWorkerOnce() {
  const now = new Date().toISOString()
  const job = await db.transaction(async (tx) => {
    // 同一上游服务只有一个处理通道；锁在各进程之间共享。
    await tx.execute(sql`select pg_advisory_xact_lock(74820319)`)
    const [active] = await tx.select().from(t.rewriteJobs).where(inArray(t.rewriteJobs.status, ['submitting', 'processing', 'unknown', 'saving']))
      .orderBy(t.rewriteJobs.createdAt, t.rewriteJobs.id).limit(1)
    if (active && (new Date(active.nextPollAt).getTime() > Date.now() || active.leaseUntil && new Date(active.leaseUntil).getTime() > Date.now())) return null
    const [j] = await tx.select().from(t.rewriteJobs).where(active ? eq(t.rewriteJobs.id, active.id) : and(
      eq(t.rewriteJobs.status, 'queued'), lte(t.rewriteJobs.nextPollAt, sql`now()`),
      or(isNull(t.rewriteJobs.leaseUntil), lt(t.rewriteJobs.leaseUntil, now)),
    )).orderBy(t.rewriteJobs.createdAt, t.rewriteJobs.id).limit(1).for('update', { skipLocked: true })
    if (!j) return null
    await tx.update(t.rewriteJobs).set({ status: j.status === 'queued' ? 'submitting' : j.status, leaseUntil: new Date(Date.now() + 1_500_000).toISOString() }).where(eq(t.rewriteJobs.id, j.id))
    return j
  })
  if (!job) return
  try {
    if (!job.rewriteOptions) throw new ProviderError('legacy_disabled', true)
    if (!job.submitStartedAt) {
      // 文件读取失败不应被标成已发送。
      const bytes = await readFile(job.sourcePath)
      await db.update(t.rewriteJobs).set({ submitStartedAt: now, status: 'submitting', updatedAt: now }).where(eq(t.rewriteJobs.id, job.id))
      await applyProvider(job, await submitRewrite(job.id, job.name, job.platformId, job.language, bytes, job.rewriteOptions, async (state) => {
        await db.update(t.rewriteJobs).set({ providerState: state, status: 'processing', updatedAt: new Date().toISOString() }).where(eq(t.rewriteJobs.id, job.id))
        broadcast()
      }))
    } else if (job.status === 'saving') {
      await saveResult(job)
    } else {
      await applyProvider(job, await pollRewrite(job.id, job.providerState, job.rewriteOptions))
    }
  } catch (e) {
    const beforeSubmitErrors = new Set(['invalid_document', 'docx_required', 'no_safe_text', 'busy_not_started', 'invalid_platform', 'file_too_large'])
    const definitive = e instanceof ProviderError && (e.definitive || beforeSubmitErrors.has(e.code))
    const [current] = await db.select({ submitStartedAt: t.rewriteJobs.submitStartedAt, status: t.rewriteJobs.status }).from(t.rewriteJobs).where(eq(t.rewriteJobs.id, job.id))
    await db.transaction(async (tx) => {
      const status = definitive || !current.submitStartedAt ? 'failed' : current.status === 'saving' ? 'saving' : 'unknown'
      await tx.update(t.rewriteJobs).set({ status,
        message: e instanceof ProviderError ? e.message : '文件读写暂时失败，请联系管理员', leaseUntil: null,
        nextPollAt: new Date(Date.now() + 60_000).toISOString(), updatedAt: new Date().toISOString() }).where(eq(t.rewriteJobs.id, job.id))
      if (status === 'failed') await settlePoints(tx, job.id, false)
    })
  }
}

const g = globalThis as unknown as { __bxshRewriteWorker?: ReturnType<typeof setInterval>; __bxshRewriteBusy?: boolean }
export function startRewriteWorker() {
  if (g.__bxshRewriteWorker || process.env.NODE_ENV === 'test' || process.env.DISABLE_REWRITE_WORKER === '1') return
  const tick = async () => {
    if (g.__bxshRewriteBusy) return
    g.__bxshRewriteBusy = true
    try { await runRewriteWorkerOnce() } catch { /* 数据库启动中，下个周期继续 */ }
    finally { g.__bxshRewriteBusy = false }
  }
  g.__bxshRewriteWorker = setInterval(tick, 10_000)
  g.__bxshRewriteWorker.unref()
  void tick()
}
