import { avatarFrame } from '@/shared/avatar-frames'
import type { ChannelReceipt } from '@/shared/channel-receipts'
import { channelReceiptView } from './channel-receipts'
import { dataVersion } from './events'
import { db as primaryDb } from './db'
import { asc, eq, isNull, sql } from 'drizzle-orm'
import type { DB, Tx } from './db'
import * as t from './schema'
import type { AfterSale, CardField, Channel, NodeTemplate, Order, Role, SettleBatch, User } from '@/shared/types'

export interface World {
  channelReceipts?: ChannelReceipt[]
  users: User[]
  roles: Role[]
  channels: Channel[]
  orders: Order[]
  statuses: string[]
  types: string[]
  payTags: string[]
  nodeTags: string[]
  cardFields: CardField[]
  nodeTemplates: NodeTemplate[]
  batches: SettleBatch[]
  /** 新单默认的写手（系统设置里的一个账号） */
  defaultWriterId: string | null
}

/**
 * 读出整个业务数据并拼成 Order（和共享层 calc / project 用的结构一致）。
 * 订单量在几千以内，每次请求全量读最简单也最不容易错；以后量大了再分页。
 */
const worldCache=new Map<string,{at:number;version:number;value:Promise<World>}>()
export async function loadWorld(db: DB | Tx, opts: { includeDeleted?: boolean } = {}): Promise<World> {
  // 写事务始终读自己的最新快照；进程缓存只服务读请求。
  if(db!==primaryDb||process.env.TEST_DATABASE_URL)return readWorld(db,opts)
  const key=opts.includeDeleted?'all':'live',version=dataVersion(),cached=worldCache.get(key)
  if(cached&&cached.version===version&&Date.now()-cached.at<1000)return cached.value
  const value=readWorld(db,opts);worldCache.set(key,{at:Date.now(),version,value})
  try{return await value}catch(e){worldCache.delete(key);throw e}
}
async function readWorld(db: DB | Tx, opts: { includeDeleted?: boolean } = {}): Promise<World> {
  const [rRoles, rUsers, rChannels, rOptions, rOrders, rWriters, rAdj, rPay, rAs, rAtt, rSet, rNodes, rRecv, rBatches, rFields, rTpl, rReceipts, rProgress, rCosts] = await Promise.all([
    db.select().from(t.roles).orderBy(asc(t.roles.sort)),
    db.select().from(t.users).orderBy(asc(t.users.createdAt)),
    db.select().from(t.channels).orderBy(asc(t.channels.createdAt)),
    db.select().from(t.options),
    opts.includeDeleted ? db.select().from(t.orders) : db.select().from(t.orders).where(isNull(t.orders.deletedAt)),
    db.select().from(t.orderWriters).orderBy(asc(t.orderWriters.sort), asc(t.orderWriters.id)),
    db.select().from(t.adjustments),
    db.select().from(t.payments).orderBy(asc(t.payments.createdAt)),
    db.select().from(t.afterSales).orderBy(asc(t.afterSales.round)),
    db.select().from(t.attachments).where(isNull(t.attachments.deletedAt)).orderBy(asc(t.attachments.at)),
    db.select().from(t.settlements),
    db.select().from(t.orderNodes).orderBy(asc(t.orderNodes.sort)),
    db.select().from(t.receivables).orderBy(asc(t.receivables.dueDate)),
    db.select().from(t.settleBatches).orderBy(asc(t.settleBatches.createdAt)),
    db.select().from(t.cardFields).orderBy(asc(t.cardFields.sort)),
    db.select().from(t.nodeTemplates).orderBy(asc(t.nodeTemplates.sort)),
    db.select().from(t.channelReceipts).orderBy(asc(t.channelReceipts.createdAt)),
    db.select().from(t.writerProgress),
    db.select().from(t.orderCosts).orderBy(asc(t.orderCosts.at), asc(t.orderCosts.id)),
  ])

  const by = <T extends { orderId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) (m.get(r.orderId) ?? m.set(r.orderId, []).get(r.orderId)!).push(r)
    return m
  }
  const C = by(rCosts)
  const WP = by(rProgress)
  const W = by(rWriters)
  const A = by(rAdj)
  const P = by(rPay)
  const S = by(rAs)
  const F = by(rAtt)
  const X = by(rSet)
  const N = by(rNodes)
  const R = by(rRecv)
  const batchOf = new Map(rBatches.map((b) => [b.id, b]))
  const revoked = (r: { revokedAt: string | null; revokedBy: string | null; revokeReason: string | null }) => (r.revokedAt ? { at: r.revokedAt, by: r.revokedBy ?? '', reason: r.revokeReason ?? '' } : undefined)
  const opt = (k: string, d: string[]) => rOptions.find((o) => o.key === k)?.values ?? d

  const orders: Order[] = rOrders.map((o) => {
    const files = F.get(o.id) ?? []
    return {
      id: o.id,
      no: o.no,
      title: o.title,
      orderDate: o.orderDate,
      dueDate: o.dueDate,
      urgency: o.urgency,
      importance: o.importance,
      progressNote: o.progressNote,
      extraCosts: (C.get(o.id) ?? []).map(a => ({ id: a.id, name: a.name, contractor: a.contractor, contractorId: a.contractorId, amount: a.amount, date: a.date, note: a.note, proof: a.proof ?? undefined, at: a.at, by: a.by, revoked: revoked(a) })),
      ownerId: o.ownerId,
      creatorId: o.creatorId,
      channelId: o.channelId ?? '',
      channelNo: o.channelNo,
      wechatGroup: o.wechatGroup,
      draftAt: o.draftAt,
      allocationPolicy: o.allocationPolicy,
      writerRatesEnabled: o.writerRatesEnabled,
      writerPayPlan: o.writerPayPlan,
      graduatedAt: o.graduatedAt,
      writerProgress: (WP.get(o.id) ?? []).map(({ orderId: _, ...progress }) => progress),
      type: o.type,
      basePrice: o.basePrice,
      adjustments: (A.get(o.id) ?? []).map((a) => ({ id: a.id, amount: a.amount, reason: a.reason, at: a.at, by: a.by, revoked: revoked(a) })),
      assignees: (W.get(o.id) ?? []).map((w) => ({ userId: w.userId, pay: w.pay, ...(o.writerRatesEnabled ? { rate: w.rate } : {}) })),
      status: o.status,
      note: o.note,
      commissionRate: o.commissionRate,
      proxyId: o.proxyId,
      proxyRate: o.proxyRate,
      salesMode: o.salesMode,
      paymentCheckedAt: o.paymentCheckedAt, paymentCheckedBy: o.paymentCheckedBy, paymentCheckedSnapshot: o.paymentCheckedSnapshot,
      payments: (P.get(o.id) ?? []).map((p) => ({ receiptId: p.receiptId ?? undefined, id: p.id, amount: p.amount, date: p.date, tag: p.tag, note: p.note, by: p.by, proof: p.proof ?? undefined, revoked: revoked(p) })),
      attachments: files.filter((f) => !f.afterSaleId && f.purpose === 'file').map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, preview: f.preview ?? undefined, at: f.at, by: f.by, nodeId: f.nodeId })),
      afterSales: (S.get(o.id) ?? []).map(
        (a): AfterSale => ({
          id: a.id,
          round: a.round,
          reason: a.reason as AfterSale['reason'],
          req: a.req,
          shots: a.shots,
          start: a.start,
          due: a.due,
          confirmBy: a.confirmBy,
          confirmedAt: a.confirmedAt,
          chosenHours: a.chosenHours, lateConfirm: a.lateConfirm, overdueAt: a.overdueAt, deliveredLateMin: a.deliveredLateMin, cancelledAt: a.cancelledAt,
          writerId: a.writerId,
          by: a.by,
          doneAt: a.doneAt,
          files: files.filter((f) => f.afterSaleId === a.id && f.purpose === 'file').map((f) => ({ id: f.id, name: f.name, size: f.size })),
          extra: a.extra,
          nudges: a.nudges,
        }),
      ),
      settlements: (X.get(o.id) ?? []).map((x) => ({ id: x.id, kind: x.kind as '写手工资', payeeId: x.payeeId, amount: x.amount, status: x.status as '已确认', note: x.note, migrated: x.migrated, batchId: x.batchId, createdAt: x.createdAt, confirmedAt: x.confirmedAt ?? x.confirmedDate, received: !!(x.batchId && batchOf.get(x.batchId)?.receivedAt) })),
      req: o.req ?? {},
      nodes: (N.get(o.id) ?? []).map((n) => ({ id: n.id, name: n.name, status: n.status as '待做', planDate: n.planDate, doneDate: n.doneDate, ownerId: n.ownerId, note: n.note, sort: n.sort })),
      receivables: (R.get(o.id) ?? []).map((r) => ({ id: r.id, amount: r.amount, dueDate: r.dueDate, tag: r.tag, note: r.note, by: r.by, createdAt: r.createdAt, paymentId: r.paymentId, doneAt: r.doneAt, cancelledAt: r.cancelledAt })),
      reviewFlag: o.reviewFlag,
      deletedAt: o.deletedAt,
    }
  })

  return {
    roles: rRoles.map((r) => ({ id: r.id, name: r.name, locked: r.locked, preset: r.preset, perms: r.perms as Role['perms'], fields: r.fields as unknown as Role['fields'], rowScope: r.rowScope as Role['rowScope'] })),
    // 停用的账号也要留着：历史订单的人名、是否自营（决定提成和利润）都靠它
    users: rUsers.map((u) => ({ id: u.id, name: u.name, account: u.account, roleId: u.roleId, hue: u.hue, commissionRate: u.commissionRate, writerRate: u.writerRate, salesMode: u.salesMode, avatar: u.avatar ?? undefined, frame: avatarFrame(u.avatarFrame), canWrite: u.canWrite, active: u.active, pausedAt: u.pausedAt })),
    channels: rChannels.map((c) => ({ id: c.id, deletedAt: c.deletedAt, name: c.name, ownerId: c.ownerId, note: c.note, active: c.active, avatar: c.avatar ?? undefined })),
    orders,
    channelReceipts: rReceipts.map(row => channelReceiptView(row, rPay, rOrders)),
    statuses: opt('statuses', ['未交付', '已发演示', '已交付', '退单']),
    types: opt('types', []),
    payTags: opt('payTags', ['定金', '尾款', '全款', '退款']),
    nodeTags: opt('nodeTags', []),
    cardFields: rFields.map((f) => ({ id: f.id, label: f.label, type: f.type as CardField['type'], choices: f.choices, builtin: f.builtin, sort: f.sort, archived: !!f.archivedAt })),
    nodeTemplates: rTpl.map((x) => ({ id: x.id, name: x.name, nodes: x.nodes, sort: x.sort })),
    batches: rBatches.map((b) => {
      const lines = rSet
        .filter((x) => x.batchId === b.id)
        .map((x) => {
          const o = rOrders.find((y) => y.id === x.orderId)
          return { id: x.id, orderId: x.orderId, no: o?.no ?? '', title: o?.title ?? '', amount: x.amount, note: x.note }
        })
      return { id: b.id, no: b.no, kind: b.kind as SettleBatch['kind'], payeeId: b.payeeId, period: b.period, status: b.status as SettleBatch['status'], note: b.note, shots: b.shots, createdBy: b.createdBy, createdAt: b.createdAt, confirmedAt: b.confirmedAt ?? b.confirmedDate, confirmedBy: b.confirmedBy, receivedAt: b.receivedAt, voidedAt: b.voidedAt, lines, total: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100 }
    }),
    defaultWriterId: opt('defaultWriter', [])[0] ?? null,
  }
}

/** 管理员（自营单的归属人）；含已停用的，停用账号不改变历史单是不是自营 */
export function adminIdsOf(w: World) {
  return new Set(w.users.filter((u) => w.roles.find((r) => r.id === u.roleId)?.locked).map((u) => u.id))
}

export async function loadOrder(db: DB | Tx, id: string) {
  const w = await loadWorld(db, { includeDeleted: true })
  return { world: w, order: w.orders.find((o) => o.id === id) }
}

/**
 * 订单编号：DD + 下单日期 YYMMDD + 当天 4 位序号，每天从 0001 起。
 * 每个下单日期一个计数器，INSERT ... ON CONFLICT DO UPDATE 原子自增，并发下不重号；
 * 第一次用某天的计数器时从这天已有的最大序号接着数，不和导入的、旧规则生成的单号撞。
 */
export async function nextOrderNo(tx: Tx, orderDate: string) {
  const prefix = `DD${orderDate.slice(2).replaceAll('-', '')}`
  const existing = sql`(select coalesce(max(substr(${t.orders.no}, 9)::int), 0) + 1 from ${t.orders} where ${t.orders.no} ~ ${`^${prefix}[0-9]{4,}$`})`
  for (;;) {
    const [r] = await tx
      .insert(t.counters)
      .values({ name: `order_serial:${orderDate}`, value: existing })
      .onConflictDoUpdate({ target: t.counters.name, set: { value: sql`${t.counters.value} + 1` } })
      .returning()
    const no = `${prefix}${String(r.value).padStart(4, '0')}`
    const [taken] = await tx.select({ id: t.orders.id }).from(t.orders).where(eq(t.orders.no, no))
    if (!taken) return no
  }
}
