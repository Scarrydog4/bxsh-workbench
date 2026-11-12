import { forumAuditVisibility } from './forum'
import { dmAuditVisibility } from './dm'
import { forumNotificationVisibility } from './forum-visibility'
import type { AvatarFrameId } from '@/shared/avatar-frames'
import { isStagedWriterPay, writerStageSummary } from '@/shared/writer-stages'
import { cachedCalc as calc, cachedProject as project } from './order-cache'
import { dataVersion } from './events'
import { statfs } from 'node:fs/promises'
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from './db'
import * as t from './schema'
import { adminIdsOf, loadWorld, type World } from './repo'
import { env } from './env'
import type { Ctx } from './session'
import { customerStage, ownerCommission, proxyFee, sumMoney } from '@/shared/calc'
import type { IncomeRow } from '@/shared/income'
export type { IncomeRow } from '@/shared/income'
import { can, rowVisible } from '@/shared/perm'
import { channelAccessible, orderChannelLabels, type ChannelLabel } from '@/shared/channel-access'
import { businessDate, payday } from '@/shared/format'
import { rankOf, type Rank } from '@/shared/rank'
import type { AuditEntry, CardField, NodeTemplate, Notification, OrderView, Role, SalesMode, SettleBatch } from '@/shared/types'
import { canViewSettlement, settlementInOrderScope } from '@/shared/settlement-access'
import { incomeAmounts, settleProgress, settleState } from '@/shared/settle'
import { reimbursementAuditVisibility } from './reimbursement'
import { feedbackAuditVisibility } from './feedback'
import { canViewChannelReceipt } from './channel-receipts'

export interface PublicUser {
  salesMode?: SalesMode
  id: string
  name: string
  hue: number
  avatar?: string
  frame?: AvatarFrameId
  /** 单量头像框：只有在用的销售（含管理员）有，按当天下单的单数算；有它就不画自选框 */
  rank?: Rank
  canWrite: boolean
  isAdmin: boolean
  isSales: boolean
  roleId: string
  roleName: string
  /** 以下只给能管账号的人或本人 */
  account?: string
  commissionRate?: number
  writerRate?: number
  active?: boolean
  /** 销售暂停接单的时间：头像变灰，其他销售可以替他录单 */
  pausedAt?: string
}

export interface ShareLinkView {
  id: string
  channelId: string
  month: string
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  createdBy: string
  opens: number
}

export interface Boot {
  version: number
  changedOrderIds?: string[]
  me: PublicUser & { mustChangePassword: boolean }
  role: Role
  users: PublicUser[]
  roles: Role[]
  channels: World['channels']
  orderChannels?: ChannelLabel[]
  /** 暂停中的销售的渠道：其他销售替他代录时选用，不进自己的渠道库 */
  proxyChannels?: World['channels']
  trashChannels: World['channels']
  orders: OrderView[]
  trash: { id: string; no: string; title: string; channelId: string; ownerId: string; status: string; deletedAt: string }[]
  audit: AuditEntry[]
  income: Record<string, IncomeRow[]>
  statuses: string[]
  types: string[]
  payTags: string[]
  defaultWriterId: string | null
  readNotes: string[]
  notifications: Notification[]
  unread: number
  batches: SettleBatch[]
  /** 已确认明细汇总，含无批次历史流水；按收款人和类型供结算页筛选。 */
  settlementSummary?: { paid: number; rows: { payeeId: string; kind: '写手工资' | '销售提成'; paid: number }[] }
  cardFields: CardField[]
  nodeTemplates: NodeTemplate[]
  nodeTags: string[]
  navOrder: string[]
  shareLinks: ShareLinkView[]
  prefs: Record<string, unknown>
  disk?: { usedPct: number }
  reviewCount?: number
}

/**
 * 某人的收入明细，按看的人的权限出：
 * 只列看的人能看到的单（查看订单 + 行范围），工资 / 提成各按字段组判断（本人要「自己的」，看别人要「全部」）。
 * 原工资按初稿日期归期；新增需求的追加工资单独一行，按那一轮开始的日期归期，不改动已经过去的那期。
 */
function income(w: World, viewer: Ctx, targetId: string, adminIds: Set<string>): IncomeRow[] {
  const role = viewer.role
  if (!can(role, 'order.view')) return []
  const f = role.locked ? { writerPay: 'all', commission: 'all' } : role.fields
  const self = targetId === viewer.me.id
  const seePay = f.writerPay === 'all' || (self && f.writerPay === 'own')
  const seeComm = f.commission === 'all' || (self && f.commission === 'own')
  if (!seePay && !seeComm) return []
  const out: IncomeRow[] = []
  for (const o of w.orders) {
    const inactive = !!o.deletedAt || o.status === '退单'
    const visible = rowVisible(o, viewer.me, role)
    const base = { id: o.id, no: o.no, title: o.title, status: o.status, ...(role.locked ? { allocationPolicy: o.allocationPolicy } : {}), salesMode: o.salesMode }
    // 转交、删除或退单不撤回已经收到的提成；历史行不恢复订单访问权限。
    const activeProxy = !inactive && visible && o.proxyId === targetId && o.ownerId !== targetId && o.salesMode !== 'cost'
    if (seeComm && (visible || self) && !activeProxy && (inactive || o.ownerId !== targetId || o.salesMode === 'cost') && !adminIds.has(targetId)) {
      const paid = sumMoney(o.settlements.filter(s => s.kind === '销售提成' && s.status === '已确认' && s.payeeId === targetId).map(s => s.amount))
      if (paid) out.push({ ...base, key: `${o.id}:paid-comm`, date: o.orderDate, kind: '已发提成', amount: paid, pay: '已发放' })
    }
    const a = o.assignees.find((x) => x.userId === targetId)
    const hasCurrentWage = !!a && a.pay !== 0 || o.afterSales.some(x => x.writerId === targetId && x.extra > 0)
    // 删除、退单或更换写手后，本人历史实发仍保留；不重新生成工资应付。
    if (seePay && (visible || self) && (inactive || !visible || !hasCurrentWage) && !adminIds.has(targetId)) {
      const paid = sumMoney(o.settlements.filter(s => s.kind === '写手工资' && s.status === '已确认' && s.payeeId === targetId).map(s => s.amount))
      if (paid) out.push({ ...base, key: `${o.id}:paid-wage`, date: o.orderDate, kind: '已发工资', amount: paid, pay: '已发放' })
    }
    if (inactive || !visible) continue
    if (adminIds.has(targetId) && viewer.role.locked) {
      const c = calc(o, adminIds)
      out.push({ ...base, key: `${o.id}:boss`, date: o.orderDate, kind: '订单收入', amount: c.payPending ? null : c.bossIncome, pay: '—' })
      continue
    }
    if (seePay && a && a.pay !== 0) out.push({ ...base, key: `${o.id}:pay`, date: o.orderDate, kind: '工资', amount: a.pay, pay: '自主发放', ...(role.locked && isStagedWriterPay(o) ? { writerStages: writerStageSummary(o, targetId) } : {}) })
    if (seePay) {
      for (const x of o.afterSales) {
        if (x.writerId !== targetId || x.extra <= 0) continue
        out.push({ ...base, key: `${o.id}:as:${x.id}`, date: businessDate(x.start), kind: '追加工资', amount: x.extra, pay: payday(x.start)! })
      }
    }
    if (seeComm && o.salesMode !== 'cost' && o.ownerId === targetId && !adminIds.has(targetId)) {
      const c = calc(o, adminIds)
      out.push({ ...base, key: `${o.id}:comm`, date: o.orderDate, kind: '提成', amount: c.payPending ? null : ownerCommission(o, c.commission), pay: '—' })
    }
    // 替暂停的销售代录的单：代录费按实收总金额算，从归属销售提成里扣
    if (seeComm && activeProxy && !adminIds.has(targetId)) {
      const c = calc(o, adminIds)
      out.push({ ...base, key: `${o.id}:proxy`, date: o.orderDate, kind: '代录费', amount: c.payPending ? null : proxyFee(o, c.commission), pay: '—' })
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** A small, permission-filtered shell lets navigation render while the full workspace is in flight. */
export const buildBootShell = (c: Ctx) => buildBoot(c, true, true)

export async function buildBoot(c: Ctx, lightweight=false, shell=false): Promise<Boot> {
  const version=dataVersion()
  const w = await loadWorld(db, { includeDeleted: true })
  const role = w.roles.find((r) => r.id === c.me.roleId)!
  const manage = can(role, 'role.manage')
  const adminIds = adminIdsOf(w)

  // 单量评级看全部订单，不按看的人裁剪；只发档位，不发单数
  const today = businessDate(new Date())
  const todayCount = new Map<string, number>()
  for (const o of w.orders) {
    if (o.deletedAt || o.status === '退单' || o.orderDate !== today) continue
    todayCount.set(o.ownerId, (todayCount.get(o.ownerId) ?? 0) + 1)
  }

  const pub = (u: World['users'][number]): PublicUser => {
    const r = w.roles.find((x) => x.id === u.roleId)
    const self = u.id === c.me.id
    const isSales = !!r && (r.locked || r.perms.includes('order.create'))
    return {
      id: u.id,
      name: u.name,
      hue: u.hue,
      avatar: u.avatar,
      frame: u.frame ?? 'none',
      canWrite: u.canWrite,
      salesMode: u.salesMode ?? 'commission',
      isAdmin: !!r?.locked,
      isSales,
      ...(isSales && u.active ? { rank: rankOf(todayCount.get(u.id) ?? 0) } : {}),
      roleId: u.roleId,
      roleName: r?.name ?? '',
      active: u.active,
      ...(isSales && u.active && u.pausedAt ? { pausedAt: u.pausedAt } : {}),
      ...(manage || self ? { account: u.account } : {}),
      ...(role.locked ? { commissionRate: u.commissionRate, writerRate: u.writerRate ?? .2 } : {}),
    }
  }

  const live = shell ? [] : w.orders.filter((o) => !o.deletedAt && rowVisible(o, c.me, role))
  const orders = can(role, 'order.view') ? live.map((o) => project(o, c.me, role, adminIds)) : []

  const trash = !shell && can(role, 'trash.view')
    ? w.orders.filter((o) => o.deletedAt && can(role, 'order.view') && rowVisible(o, c.me, role)).map((o) => ({ id: o.id, no: o.no, title: o.title, channelId: o.channelId, ownerId: o.ownerId, status: o.status, deletedAt: o.deletedAt! }))
    : []

  const visibleReceiptIds = !lightweight && can(role, 'audit.view') ? (w.channelReceipts ?? []).filter(receipt => canViewChannelReceipt(w, { ...c, role }, receipt)).map(receipt => receipt.id) : []
  const audit: AuditEntry[] = !lightweight && can(role, 'audit.view')
    ? (await db.select().from(t.audit).where(and(reimbursementAuditVisibility({ ...c, role }), feedbackAuditVisibility({ ...c, role }), forumAuditVisibility({ ...c, role }), dmAuditVisibility({ ...c, role }), role.locked ? undefined : or(isNull(t.audit.fieldGroup), and(ne(t.audit.fieldGroup, 'writerRate'), ...(role.fields.profit ? [] : [ne(t.audit.fieldGroup, 'profit')]))), or(ne(t.audit.objectType, 'channelReceipt'), inArray(t.audit.objectId, visibleReceiptIds)))).orderBy(desc(t.audit.id)).limit(800)).map((a) => ({
        id: String(a.id),
        at: a.at,
        actorId: a.actorId,
        action: a.action,
        objectType: a.objectType as AuditEntry['objectType'],
        objectId: a.objectId ?? undefined,
        objectLabel: a.objectLabel ?? undefined,
        field: a.field ?? undefined,
        from: a.from ?? undefined,
        to: a.to ?? undefined,
        note: a.note,
        proof: a.proof,
      }))
    : []

  const targets = lightweight ? [] : can(role, 'income.all') ? w.users.map((u) => u.id) : [c.me.id]
  const inc: Record<string, IncomeRow[]> = {}
  for (const id of targets) {
    const rows = income(w, c, id, adminIds).map((r) => {
      const o = w.orders.find((x) => x.id === r.id)!
      return withSettlement(r, o, id, adminIds, c.role)
    })
    if (rows.length || id === c.me.id) inc[id] = rows
  }

  const [noteRows, [unreadRow], [navRow], reads, prefRows, shareRows] = await Promise.all([
    shell ? Promise.resolve([]) : db.select().from(t.notifications).where(and(eq(t.notifications.userId, c.me.id), forumNotificationVisibility(c))).orderBy(desc(t.notifications.id)).limit(200),
    db.select({ n: sql<number>`count(*)` }).from(t.notifications).where(and(eq(t.notifications.userId, c.me.id), forumNotificationVisibility(c), isNull(t.notifications.readAt))),
    db.select().from(t.options).where(eq(t.options.key, 'navOrder')),
    shell ? Promise.resolve([]) : db.select({ id: t.notesRead.noteId }).from(t.notesRead).where(eq(t.notesRead.userId, c.me.id)),
    db.select().from(t.userPrefs).where(eq(t.userPrefs.userId, c.me.id)),
    !shell && can(role, 'statement.view') ? db.select().from(t.shareLinks).orderBy(desc(t.shareLinks.createdAt)) : Promise.resolve([]),
  ])

  let disk: Boot['disk']
  if (!shell && role.locked) {
    try {
      const s = await statfs(env.storageDir)
      disk = { usedPct: Math.round((1 - s.bavail / s.blocks) * 100) }
    } catch {
      /* 存储目录还没建，不报 */
    }
  }

  const meUser = w.users.find((u) => u.id === c.me.id)!
  return {
    version,
    me: { ...pub(meUser), mustChangePassword: c.me.mustChangePassword },
    role,
    users: w.users.map(pub),
    roles: manage ? w.roles : w.roles.map((r) => ({ ...r, perms: [], fields: { sales: false, writerPay: 'none', commission: 'none', profit: false, channelNo: false } })),
    channels: shell ? [] : w.channels.filter(ch => !ch.deletedAt && channelAccessible(ch, c.me, role)),
    orderChannels: orderChannelLabels(w.channels, [...orders, ...trash]),
    proxyChannels: shell || role.locked || !can(role, 'order.create') ? [] : w.channels.filter(ch => !ch.deletedAt && ch.ownerId !== c.me.id && !!w.users.find(u => u.id === ch.ownerId && u.active && u.pausedAt)),
    trashChannels: !shell && role.locked && can(role, 'trash.view') && can(role, 'channel.manage') ? w.channels.filter(ch => !!ch.deletedAt && channelAccessible(ch, c.me, role)) : [],
    orders,
    trash,
    audit,
    income: inc,
    statuses: w.statuses,
    types: w.types,
    payTags: w.payTags,
    defaultWriterId: (() => {
      const ok = w.users.filter((u) => u.active && u.canWrite)
      return (ok.find((u) => u.id === w.defaultWriterId) ?? ok.find((u) => !adminIds.has(u.id)) ?? ok[0])?.id ?? null
    })(),
    readNotes: reads.map((r) => r.id),
    notifications: noteRows.map((n) => ({ id: String(n.id), kind: n.kind, orderId: n.orderId, tab: n.tab, title: n.title, body: n.body, actorId: n.actorId, at: n.at, read: !!n.readAt })),
    unread: Number(unreadRow?.n ?? 0),
    batches: shell ? [] : visibleBatches(w, c),
    settlementSummary: shell ? undefined : settlementSummary(w, c),
    cardFields: w.cardFields,
    nodeTemplates: w.nodeTemplates,
    nodeTags: w.nodeTags,
    navOrder: navRow?.values ?? [],
    shareLinks: shareRows.filter((l) => role.locked || l.createdBy === c.me.id)
      .map((l) => ({ id: l.id, channelId: l.channelId, month: l.month, expiresAt: l.expiresAt, revokedAt: l.revokedAt, createdAt: l.createdAt, createdBy: l.createdBy, opens: l.opens })),
    prefs: Object.fromEntries(prefRows.map((p) => [p.key, p.value])),
    disk,
    reviewCount: !shell && role.locked ? w.orders.filter((o) => !o.deletedAt && o.reviewFlag).length : undefined,
  }
}

/** 订单「动态」：按看的人的权限去掉看不到的字段改动（写手看不到改价、收款、别人的工资） */
export async function orderActivity(c: Ctx, orderId: string) {
  const w = await loadWorld(db, { includeDeleted: true })
  const o = w.orders.find((x) => x.id === orderId)
  if (!o || !rowVisible(o, c.me, c.role) || !can(c.role, 'order.view')) return null
  const f = c.role.locked ? { sales: true, writerPay: 'all', commission: 'all', profit: true, channelNo: true } : c.role.fields
  const rows = await db.select().from(t.audit).where(eq(t.audit.objectId, orderId)).orderBy(desc(t.audit.id)).limit(300)
  return rows
    .filter((a) => a.action !== '查看详情')
    .filter((a) => {
      switch (a.fieldGroup) {
        case 'profit':
          return f.profit
        case 'writerRate':
          return c.role.locked
        case 'sales':
          return f.sales
        case 'writerPay':
          return f.writerPay === 'all'
        case 'channelNo':
          return f.channelNo
        default:
          return true
      }
    })
    .map((a) => ({ id: String(a.id), at: a.at, actorId: a.actorId, action: a.action, field: a.field ?? undefined, from: a.from ?? undefined, to: a.to ?? undefined, note: a.note, proof: a.proof }))
}

/**
 * 看得到哪些结算单：能管这类结算（且看得到全部对应金额）的看全部；
 * 其余人只看自己是收款人的，并且自己的这类金额要看得到。
 */
function visibleBatches(w: World, c: Ctx): SettleBatch[] {
  const batches = w.batches
    .filter(b => canViewSettlement(b, c.me.id, c.role) && (b.payeeId === c.me.id || settlementInOrderScope(b, w.orders, c.me.id, c.role)))
    .reverse()
  // 飞书迁入的实发可能只有逐单流水。按原明细展示，不补造批次或发放日期。
  const historical: SettleBatch[] = []
  for (const order of w.orders) for (const line of order.settlements) {
    if (line.batchId || line.status === '草稿' || !canViewSettlement(line, c.me.id, c.role)) continue
    if (line.payeeId !== c.me.id && !rowVisible(order, c.me, c.role)) continue
    historical.push({
      historical: true, id: `history:${line.id}`, no: '历史明细',
      kind: line.kind, payeeId: line.payeeId, period: null, status: line.status,
      note: line.note, shots: [], createdBy: '', createdAt: line.createdAt ?? '',
      confirmedAt: line.confirmedAt ?? null, confirmedBy: null, receivedAt: null, voidedAt: null,
      lines: [{ id: line.id, orderId: order.id, no: order.no, title: order.title, amount: line.amount }],
      total: line.amount,
    })
  }
  return [...batches, ...historical]
}

/** 汇总只读已确认的明细，不依赖批次存在。本人历史款保留，管理人员遵循订单行权限。 */
function settlementSummary(w: World, c: Ctx): NonNullable<Boot['settlementSummary']> {
  const groups = new Map<string, { payeeId: string; kind: '写手工资' | '销售提成'; paid: number }>()
  for (const order of w.orders) for (const s of order.settlements) {
    if (s.status !== '已确认' || !canViewSettlement(s, c.me.id, c.role)) continue
    if (s.payeeId !== c.me.id && !rowVisible(order, c.me, c.role)) continue
    const key = `${s.payeeId}:${s.kind}`
    const row = groups.get(key) ?? { payeeId: s.payeeId, kind: s.kind, paid: 0 }
    row.paid = sumMoney([row.paid, s.amount])
    groups.set(key, row)
  }
  const rows = [...groups.values()]
  return { paid: sumMoney(rows.map(row => row.paid)), rows }
}

function withSettlement(r: IncomeRow, order: World['orders'][number], payee: string, admins: Set<string>, role: Role): IncomeRow {
  if (r.kind === '订单收入') return { ...r, due: r.amount, paid: 0, left: Math.max(0, r.amount ?? 0), over: 0, ...customerStage(order), ...(can(role, 'settle.manage') ? { suggest: 0 } : {}) }
  const kind = r.kind === '提成' || r.kind === '已发提成' || r.kind === '代录费' ? '销售提成' : '写手工资'
  const { suggest, ...amounts } = incomeAmounts(order, kind, payee, admins)
  const settlement = { ...settleProgress(order, kind, payee, admins), unpaid: amounts.left }
  return { ...r, ...amounts, ...(can(role, 'settle.manage') ? { suggest } : {}), settle: settleState(order, kind, payee, admins), settlement, available: amounts.left, reserved: 0, pending: 0 }
}

export async function incomeRows(c:Ctx,targetId:string,world?:World) {
  if(targetId!==c.me.id&&!can(c.role,'income.all'))return []
  const w=world??await loadWorld(db,{includeDeleted:true}),admins=adminIdsOf(w),orders=new Map(w.orders.map(o=>[o.id,o]))
  return income(w,c,targetId,admins).map(r=>withSettlement(r, orders.get(r.id)!, targetId, admins, c.role))
}
