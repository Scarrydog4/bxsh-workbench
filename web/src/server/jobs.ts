import { writerInitialDone } from '@/shared/writer-stages'
import { isInitialDeliveryPending } from '@/shared/order-deadline'
import { recordAfterSaleTime } from './aftersale-clock'
import { WRITE_LOCK } from './actions'
import { businessDate, deadlineFrom } from '@/shared/format'
import { sql } from 'drizzle-orm'
import { db } from './db'
import { loadWorld } from './repo'
import { broadcast } from './events'
import { notify } from './notify'
import { money } from '@/shared/format'

const JOB_LOCK = 20261008

/**
 * 定时任务（服务启动后每分钟跑一次，多次跑结果一样）：
 * - 时间触发的提醒：初稿截止前 2 天和当天、售后确认前 15 分钟、确认超时、截止前 1 小时和逾期、进度节点到期、待收到期。每条用 key 去重，只发一次。
 * - 工资由收入页直接发放，不再自动生成结算草稿。
 */
export async function runJobs(now = new Date()) {
  let sent = 0
  const drafts = 0
  await db.transaction(async (tx) => {
    // 和写操作用不同的锁：多个进程同时跑时只有一个在干活
    const [{ ok }] = (await tx.execute(sql`select pg_try_advisory_xact_lock(${JOB_LOCK}) as ok`)) as unknown as { ok: boolean }[]
    if (!ok) return
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const w = await loadWorld(tx)
    const todayKey = businessDate(now)
    const in2 = deadlineFrom(todayKey,2)
    const live = w.orders.filter((o) => !o.deletedAt && o.status !== '退单')

    for (const o of live) {
      const writers = o.assignees.map((a) => a.userId)
      // 初稿截止：还没交初稿的
      const initialWriters = writers.filter(id => !writerInitialDone(o, id))
      if (o.dueDate && isInitialDeliveryPending(o) && initialWriters.length) {
        if (o.dueDate === in2) sent += await notify(tx, initialWriters, { kind: '截止', orderId: o.id, tab: 'overview', title: `「${o.title}」后天截止`, body: `截止 ${o.dueDate}`, key: `due2:${o.id}:${o.dueDate}` })
        if (o.dueDate === todayKey) sent += await notify(tx, initialWriters, { kind: '截止', orderId: o.id, tab: 'overview', title: `「${o.title}」今天截止`, body: `截止 ${o.dueDate}`, key: `due0:${o.id}:${o.dueDate}` })
      }
      for (const a of o.afterSales) sent += await recordAfterSaleTime(tx,w,o,a,now)
      // 进度节点：到计划日期还没完成，提醒负责人（没设负责人就提醒写手）
      for (const n of o.nodes) {
        if (n.status === '完成' || !n.planDate || n.planDate > todayKey) continue
        sent += await notify(tx, n.ownerId ? [n.ownerId] : writers, { kind: '节点到期', orderId: o.id, tab: 'nodes', title: `「${o.title}」的「${n.name}」到计划日期了`, body: `计划 ${n.planDate}`, key: `node:${n.id}:${n.planDate}` })
      }
      // 待收到期：提醒归属销售
      for (const r of o.receivables) {
        if (r.doneAt || r.cancelledAt || r.dueDate > todayKey) continue
        sent += await notify(tx, [o.ownerId], { kind: '待收到期', orderId: o.id, tab: 'payments', title: `「${o.title}」有一笔待收到期：${money(r.amount)}`, body: `${r.tag} · 预计 ${r.dueDate}`, key: `recv:${r.id}:${r.dueDate}` })
      }
    }

  })
  if (sent || drafts) broadcast()
  return { sent, drafts }
}

let started = false
/** 服务启动时调一次：30 秒后先跑一次，之后每分钟一次 */
export function startJobs() {
  if (started || process.env.DISABLE_JOBS === '1') return
  started = true
  const tick = () => runJobs().catch((e) => console.error('定时任务出错', e))
  setTimeout(tick, 30_000)
  setInterval(tick, 60_000)
}
