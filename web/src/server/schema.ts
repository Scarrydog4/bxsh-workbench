import type { ReviewMessage } from '@/shared/work-materials'
import type { AvatarFrameId } from '@/shared/avatar-frames'
import { sql } from 'drizzle-orm'
import type { AllocationPolicy } from '@/shared/allocation'
import type { OrderUrgency, SalesMode, WriterPayPlan } from '@/shared/types'
import type { ReimbursementCategory, ReimbursementEvent, ReimbursementStatus } from '@/shared/reimbursement'
import type { FeedbackKind, FeedbackReply, FeedbackStatus } from '@/shared/feedback'
import type { CustomerRequestKind, CustomerRequestStatus } from '@/shared/customer-portal'
import { bigint, bigserial, boolean, date, doublePrecision, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' })
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  locked: boolean('locked').notNull().default(false),
  preset: boolean('preset').notNull().default(false),
  perms: jsonb('perms').$type<string[]>().notNull().default([]),
  fields: jsonb('fields').$type<Record<string, unknown>>().notNull(),
  rowScope: text('row_scope').notNull(),
  sort: integer('sort').notNull().default(0),
})

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    account: text('account').notNull(),
    name: text('name').notNull(),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    hue: integer('hue').notNull().default(166),
    salesMode: text('sales_mode').$type<SalesMode>().notNull().default('commission'),
    commissionRate: doublePrecision('commission_rate').notNull().default(0.5),
    writerRate: doublePrecision('writer_rate').notNull().default(0.2),
    avatar: text('avatar'),
    avatarFrame: text('avatar_frame').$type<AvatarFrameId>(),
    canWrite: boolean('can_write').notNull().default(false),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: ts('locked_until'),
    active: boolean('active').notNull().default(true),
    /** 销售暂停接单（封号或私事）：头像变灰，其他销售可以替他录单 */
    pausedAt: ts('paused_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_account_idx').on(t.account)],
)

/** 会话：cookie 里只放随机令牌，库里存它的哈希。桌面端以后用同一个令牌走 Authorization 头。 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    ip: text('ip'),
    ua: text('ua'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const loginRecords = pgTable('login_records', {
  id: serial('id').primaryKey(),
  userId: text('user_id'),
  account: text('account').notNull(),
  ok: boolean('ok').notNull(),
  reason: text('reason'),
  ip: text('ip'),
  ua: text('ua'),
  at: ts('at').notNull().defaultNow(),
})

export const channels = pgTable(
  'channels',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    note: text('note').notNull().default(''),
    settlementMode: text('settlement_mode').$type<'standard' | 'weekly'>().notNull().default('standard'),
    active: boolean('active').notNull().default(true),
    avatar: text('avatar'),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('channels_name_idx').on(t.name)],
)

/** 选项：订单状态、订单类型、收款标签，值是有序数组 */
export const options = pgTable('options', {
  key: text('key').primaryKey(),
  values: jsonb('values').$type<string[]>().notNull(),
})

export const counters = pgTable('counters', {
  name: text('name').primaryKey(),
  value: integer('value').notNull(),
})

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    no: text('no').notNull(),
    title: text('title').notNull(),
    orderDate: date('order_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    urgency: jsonb('urgency').$type<OrderUrgency | null>(),
    importance: jsonb('importance').$type<OrderUrgency | null>(),
    progressNote: text('progress_note').notNull().default(''),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id),
    channelId: text('channel_id').references(() => channels.id),
    channelNo: text('channel_no').notNull().default(''),
    wechatGroup: text('wechat_group').notNull().default(''),
    draftAt: ts('draft_at'),
    allocationPolicy: text('allocation_policy').$type<AllocationPolicy>().notNull().default('legacy'),
    writerRatesEnabled: boolean('writer_rates_enabled').notNull().default(false),
    writerPayPlan: text('writer_pay_plan').$type<WriterPayPlan>().notNull().default('full'),
    graduatedAt: ts('graduated_at'),
    type: text('type').notNull().default(''),
    expectedDeposit: money('expected_deposit'),
    basePrice: money('base_price').notNull(),
    status: text('status').notNull(),
    note: text('note').notNull().default(''),
    salesMode: text('sales_mode').$type<SalesMode>().notNull().default('commission'),
    commissionRate: doublePrecision('commission_rate').notNull(),
    /** 代录人：归属销售暂停时替他录单的销售；按实收的 proxyRate 从归属销售提成里分给他 */
    proxyId: text('proxy_id').references(() => users.id),
    proxyRate: doublePrecision('proxy_rate').notNull().default(0.05),
    /** 迁移时金额不明、需要老板补录的标记，例如「部分结算待核对」 */
    reviewFlag: text('review_flag'),
    paymentCheckedAt: ts('payment_checked_at'),
    paymentCheckedBy: text('payment_checked_by'),
    paymentCheckedSnapshot: text('payment_checked_snapshot'),
    feishuRecordId: text('feishu_record_id'),
    /** 飞书「系统编号」：飞书 JSON 和 Excel 导出里都有，重复导入按它去重 */
    feishuSysNo: text('feishu_sys_no'),
    /** 需求卡片：字段 id → 值（文件类字段存附件 id 数组） */
    req: jsonb('req').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [uniqueIndex('orders_no_idx').on(t.no), uniqueIndex('orders_feishu_idx').on(t.feishuRecordId), uniqueIndex('orders_feishu_sys_idx').on(t.feishuSysNo)],
)

export const orderWriters = pgTable('order_writers', {
  id: serial('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  /** null = 工资还没定 */
  pay: money('pay'),
  rate: doublePrecision('rate'),
  sort: integer('sort').notNull().default(0),
})

export const writerProgress = pgTable('writer_progress', {
  orderId: text('order_id').notNull().references(() => orders.id),
  userId: text('user_id').notNull().references(() => users.id),
  completedAt: ts('completed_at'),
  completedProofIds: jsonb('completed_proof_ids').$type<string[]>().notNull().default([]),
  groupSentAt: ts('group_sent_at'),
  groupProofIds: jsonb('group_proof_ids').$type<string[]>().notNull().default([]),
}, t => [primaryKey({ columns: [t.orderId, t.userId] })])

export const adjustments = pgTable('adjustments', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  amount: money('amount').notNull(),
  reason: text('reason').notNull(),
  at: date('at', { mode: 'string' }).notNull(),
  by: text('by')
    .notNull()
    .references(() => users.id),
  // 记错了由管理员撤销：不删，留着显示，不再计入销售额
  revokedAt: ts('revoked_at'),
  revokedBy: text('revoked_by'),
  revokeReason: text('revoke_reason'),
})

/** 实物外包等订单成本；撤销保留原记录。 */
export const orderCosts = pgTable('order_costs', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id),
  name: text('name').notNull(),
  contractor: text('contractor').notNull().default(''),
  contractorId: text('contractor_id'),
  amount: money('amount').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  note: text('note').notNull().default(''),
  proof: text('proof'),
  at: ts('at').notNull().defaultNow(),
  by: text('by').notNull().references(() => users.id),
  revokedAt: ts('revoked_at'),
  revokedBy: text('revoked_by'),
  revokeReason: text('revoke_reason'),
}, t => [index('order_costs_order_idx').on(t.orderId)])

export const channelReceipts = pgTable('channel_receipts', {
  id: text('id').primaryKey(),
  no: text('no').notNull().unique(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  ownerId: text('owner_id').notNull().references(() => users.id),
  amount: money('amount').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  tag: text('tag').notNull(),
  note: text('note').notNull().default(''),
  proof: text('proof'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
  revokedBy: text('revoked_by'),
  revokeReason: text('revoke_reason'),
  revision: integer('revision').notNull().default(1),
  requests: jsonb('requests').$type<Record<string, { actor: string; action: string; hash: string }>>().notNull().default({}),
}, t => [index('channel_receipts_channel_idx').on(t.channelId)])

export const payments = pgTable('payments', {
  receiptId: text('receipt_id').references(() => channelReceipts.id),
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  amount: money('amount').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  tag: text('tag').notNull(),
  note: text('note').notNull().default(''),
  by: text('by')
    .notNull()
    .references(() => users.id),
  proof: text('proof'),
  createdAt: ts('created_at').notNull().defaultNow(),
  // 记错了由管理员撤销：不删，留着显示，不再计入已收
  revokedAt: ts('revoked_at'),
  revokedBy: text('revoked_by'),
  revokeReason: text('revoke_reason'),
},t=>[index('payments_order_idx').on(t.orderId), index('payments_receipt_idx').on(t.receiptId)])

export const afterSales = pgTable('after_sales', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  round: integer('round').notNull(),
  reason: text('reason').notNull(),
  req: jsonb('req').$type<string[]>().notNull(),
  shots: jsonb('shots').$type<string[]>().notNull(),
  start: ts('start').notNull(),
  due: ts('due').notNull(),
  confirmBy: ts('confirm_by'),
  confirmedAt: ts('confirmed_at'),
  chosenHours: integer('chosen_hours'),
  lateConfirm: boolean('late_confirm').notNull().default(false),
  overdueAt: ts('overdue_at'),
  deliveredLateMin: integer('delivered_late_min').notNull().default(0),
  cancelledAt: ts('cancelled_at'),
  writerId: text('writer_id')
    .notNull()
    .references(() => users.id),
  by: text('by')
    .notNull()
    .references(() => users.id),
  doneAt: ts('done_at'),
  extra: money('extra').notNull().default(0),
  nudges: integer('nudges').notNull().default(0),
}, (t) => [
  // 一单的轮次不重号；同一时间只有一轮在改
  index('after_sales_pending_due_idx').on(t.due).where(sql`${t.doneAt} is null and ${t.cancelledAt} is null`),
  uniqueIndex('after_sales_round_idx').on(t.orderId, t.round),
  uniqueIndex('after_sales_open_idx').on(t.orderId).where(sql`${t.doneAt} is null and ${t.cancelledAt} is null`),
])

/** 附件存磁盘卷，这里只记元数据；修改稿也是附件，挂在某一轮售后上 */
export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  afterSaleId: text('after_sale_id'),
  /** 挂在某个进度节点上的交付文件 */
  nodeId: text('node_id'),
  name: text('name').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  mime: text('mime').notNull().default('application/octet-stream'),
  path: text('path').notNull(),
  preview: text('preview'),
  thumbPath: text('thumb_path'),
  purpose: text('purpose').notNull().default('file'),
  at: ts('at').notNull().defaultNow(),
  by: text('by')
    .notNull()
    .references(() => users.id),
  deletedAt: ts('deleted_at'),
})

/** 分片上传：先建一条，再按偏移量追加，传完转成附件；断了可以按 received 续传 */
export const uploads = pgTable('uploads', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  orderId: text('order_id').notNull(),
  afterSaleId: text('after_sale_id'),
  nodeId: text('node_id'),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  received: bigint('received', { mode: 'number' }).notNull().default(0),
  path: text('path').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  doneAt: ts('done_at'),
})

/** 结算明细（一单一行）。P2 的结算单界面建在这张表上；迁移时先把飞书里已结的写进来 */
export const settlements = pgTable('settlements', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // 写手工资 | 销售提成
  payeeId: text('payee_id')
    .notNull()
    .references(() => users.id),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  amount: money('amount').notNull(),
  status: text('status').notNull(), // 草稿 | 已确认 | 已作废
  note: text('note').notNull().default(''),
  migrated: boolean('migrated').notNull().default(false),
  confirmedAt: ts('confirmed_at'),
  confirmedDate: date('confirmed_date', { mode: 'string' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  /** 属于哪张结算单；迁移来的没有 */
  batchId: text('batch_id'),
})

/** 结算单：一个收款人、一种类型，多行明细（settlements）。草稿 → 已确认（已付款）；可作废 */
export const settleBatches = pgTable(
  'settle_batches',
  {
    id: text('id').primaryKey(),
    no: text('no').notNull(),
    kind: text('kind').notNull(), // 写手工资 | 销售提成
    payeeId: text('payee_id')
      .notNull()
      .references(() => users.id),
    /** 写手工资的发放期，如 2026-10-15；系统每月 13 日按它生成草稿 */
    period: date('period', { mode: 'string' }),
    status: text('status').notNull(), // 草稿 | 已确认 | 已作废
    note: text('note').notNull().default(''),
    shots: jsonb('shots').$type<string[]>().notNull().default([]),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    confirmedAt: ts('confirmed_at'),
    confirmedDate: date('confirmed_date', { mode: 'string' }),
    confirmedBy: text('confirmed_by'),
    receivedAt: ts('received_at'),
    voidedAt: ts('voided_at'),
    voidedBy: text('voided_by'),
  },
  (t) => [
    uniqueIndex('settle_batches_no_idx').on(t.no),
    // 同一人同一期只有一张系统生成的工资草稿（作废的不算）
    uniqueIndex('settle_batches_period_idx').on(t.kind, t.payeeId, t.period).where(sql`${t.period} is not null and ${t.voidedAt} is null`),
  ],
)

/** 待收：预计某天收到的钱，到期提醒；收到后转成一笔实收 */
export const receivables = pgTable('receivables', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  amount: money('amount').notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  tag: text('tag').notNull(),
  note: text('note').notNull().default(''),
  by: text('by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  /** 转成实收后指向那笔收款 */
  paymentId: text('payment_id'),
  doneAt: ts('done_at'),
  cancelledAt: ts('cancelled_at'),
})

/** 提醒：发给某个人；时间触发的（截止、到期）用 key 去重，只发一次 */
export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    orderId: text('order_id'),
    /** 点开去哪：订单的哪个页签，或某个页面 */
    tab: text('tab'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    actorId: text('actor_id'),
    key: text('key'),
    at: ts('at').notNull().defaultNow(),
    readAt: ts('read_at'),
  },
  (t) => [index('notifications_unread_idx').on(t.userId).where(sql`${t.readAt} is null`), index('notifications_user_idx').on(t.userId, t.at), uniqueIndex('notifications_key_idx').on(t.userId, t.key)],
)

/** 订单评论：可以 @ 人、贴图 */
export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    by: text('by').notNull(),
    body: text('body').notNull(),
    images: jsonb('images').$type<string[]>().notNull().default([]),
    mentions: jsonb('mentions').$type<string[]>().notNull().default([]),
    at: ts('at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('comments_order_idx').on(t.orderId)],
)

/** 进度节点：每单任意多个，可拖动排序 */
export const orderNodes = pgTable(
  'order_nodes',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('待做'), // 待做 | 进行中 | 完成
    planDate: date('plan_date', { mode: 'string' }),
    doneDate: date('done_date', { mode: 'string' }),
    ownerId: text('owner_id'),
    note: text('note').notNull().default(''),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('order_nodes_order_idx').on(t.orderId)],
)

/** 节点模板：常用的节点组合，一键套用 */
export const nodeTemplates = pgTable('node_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 节点名 + 距下单几天（计划日期，可空） */
  nodes: jsonb('nodes').$type<{ name: string; days: number | null }[]>().notNull(),
  sort: integer('sort').notNull().default(0),
})

/** 需求卡片字段：基础字段 + 管理员加的自定义字段，可拖动排序 */
export const cardFields = pgTable('card_fields', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  type: text('type').notNull(), // text | longtext | number | select | date | file
  choices: jsonb('choices').$type<string[]>().notNull().default([]),
  builtin: boolean('builtin').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  archivedAt: ts('archived_at'),
})

/** 渠道对账单的只读分享链接：库里只存令牌哈希，可设有效期、随时撤销 */
export const shareLinks = pgTable('share_links', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  channelId: text('channel_id')
    .notNull()
    .references(() => channels.id),
  month: text('month').notNull(), // 2026-10
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  opens: integer('opens').notNull().default(0),
}, (t) => [uniqueIndex('share_links_token_idx').on(t.tokenHash)])

/** 客户链接只保存令牌哈希；重新生成后旧链接立即失效。 */
export const customerLinks = pgTable('customer_links', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id),
  tokenHash: text('token_hash').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
}, t => [
  uniqueIndex('customer_links_token_idx').on(t.tokenHash),
  uniqueIndex('customer_links_active_order_idx').on(t.orderId).where(sql`${t.revokedAt} is null`),
  index('customer_links_order_idx').on(t.orderId),
])

/** 外部要求独立存储，不自动创建内部跟进，也不触碰工资/收款。 */
export const customerRequests = pgTable('customer_requests', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id),
  linkId: text('link_id').notNull().references(() => customerLinks.id),
  clientId: text('client_id').notNull(),
  requestId: text('request_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  kind: text('kind').$type<CustomerRequestKind>().notNull(),
  name: text('name').notNull().default(''),
  body: text('body').notNull().default(''),
  shots: jsonb('shots').$type<string[]>().notNull().default([]),
  status: text('status').$type<CustomerRequestStatus>().notNull().default('pending'),
  reply: text('reply').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(),
  handledAt: ts('handled_at'),
  handledBy: text('handled_by').references(() => users.id),
}, t => [
  uniqueIndex('customer_requests_idempotency_idx').on(t.orderId, t.clientId, t.requestId),
  index('customer_requests_order_at_idx').on(t.orderId, t.createdAt),
  index('customer_requests_inbox_idx').on(t.orderId, t.status, t.createdAt),
  index('customer_requests_client_idx').on(t.orderId, t.clientId, t.createdAt),
])

export const audit = pgTable(
  'audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: ts('at').notNull().defaultNow(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id'),
    objectLabel: text('object_label'),
    field: text('field'),
    from: text('from_value'),
    to: text('to_value'),
    /** 改动涉及哪类字段，用来按权限过滤订单「动态」（比如写手看不到改价记录） */
    fieldGroup: text('field_group'),
    note: text('note').notNull().default(''),
    proof: text('proof'),
    ip: text('ip'),
  },
  (t) => [index('audit_object_at_idx').on(t.objectId,t.at), index('audit_object_idx').on(t.objectId), index('audit_at_idx').on(t.at)],
)

export const notesRead = pgTable('notes_read', { userId: text('user_id').notNull(), noteId: text('note_id').notNull() }, (t) => [primaryKey({ columns: [t.userId, t.noteId] })])

export const userPrefs = pgTable('user_prefs', { userId: text('user_id').notNull(), key: text('key').notNull(), value: jsonb('value') }, (t) => [primaryKey({ columns: [t.userId, t.key] })])

/** 双降任务先落库再提交。提交时间一旦写入，只查询原任务，不自动重发付费请求。 */
export const rewriteJobs = pgTable('rewrite_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  orderId: text('order_id').references(() => orders.id),
  sourceAttachmentId: text('source_attachment_id'),
  name: text('name').notNull(),
  sourcePath: text('source_path').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  fingerprint: text('fingerprint').notNull(),
  platformId: text('platform_id').notNull(),
  platformName: text('platform_name').notNull(),
  language: text('language').notNull(),
  rewriteOptions: jsonb('rewrite_options').$type<import('@/shared/toolbox').RewriteOptions>(),
  providerState: jsonb('provider_state').$type<import('@/shared/toolbox').RewriteProviderState>().notNull().default({}),
  status: text('status').notNull().default('queued'),
  message: text('message'),
  submitStartedAt: ts('submit_started_at'),
  leaseUntil: ts('lease_until'),
  nextPollAt: ts('next_poll_at').notNull().defaultNow(),
  resultPath: text('result_path'),
  resultName: text('result_name'),
  resultSize: bigint('result_size', { mode: 'number' }),
  resultAttachmentId: text('result_attachment_id'),
  points: integer('points').notNull().default(0),
  pointStatus: text('point_status').notNull().default('none'),
  batchId: text('batch_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('rewrite_jobs_dedupe_idx').on(t.userId, t.fingerprint), index('rewrite_jobs_poll_idx').on(t.status, t.nextPollAt)])

export const pointAccounts = pgTable('point_accounts', {
  userId: text('user_id').primaryKey().references(() => users.id),
  balance: integer('balance').notNull().default(0),
  reserved: integer('reserved').notNull().default(0),
})
export const pointEntries = pgTable('point_entries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  actorId: text('actor_id').notNull().references(() => users.id),
  kind: text('kind').notNull(),
  delta: integer('delta').notNull().default(0),
  reservedDelta: integer('reserved_delta').notNull().default(0),
  jobId: text('job_id'),
  note: text('note').notNull(),
  at: ts('at').notNull().defaultNow(),
}, (t) => [index('point_entries_user_idx').on(t.userId, t.at)])
export const toolPrices = pgTable('tool_prices', {
  id: text('id').primaryKey(),
  points: integer('points').notNull(),
})

export const rewriteBatches = pgTable('rewrite_batches', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  jobIds: jsonb('job_ids').$type<string[]>().notNull(),
  unitPoints: integer('unit_points').notNull(),
  totalPoints: integer('total_points').notNull().default(0),
  createdCount: integer('created_count').notNull().default(0),
  reusedCount: integer('reused_count').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export const reimbursements = pgTable('reimbursements', {
  id: text('id').primaryKey(),
  no: text('no').notNull(),
  applicantId: text('applicant_id').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  category: text('category').$type<ReimbursementCategory>().notNull(),
  amount: money('amount').notNull(),
  expenseDate: date('expense_date', { mode: 'string' }).notNull(),
  note: text('note').notNull(),
  proofs: jsonb('proofs').$type<string[]>().notNull().default([]),
  orderId: text('order_id').references(() => orders.id, { onDelete: 'set null' }),
  status: text('status').$type<ReimbursementStatus>().notNull().default('待处理'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  paidDate: date('paid_date', { mode: 'string' }),
  paidAt: ts('paid_at'),
  paidBy: text('paid_by').references(() => users.id),
  paymentNote: text('payment_note').notNull().default(''),
  paymentProofs: jsonb('payment_proofs').$type<string[]>().notNull().default([]),
  reason: text('reason').notNull().default(''),
  history: jsonb('history').$type<ReimbursementEvent[]>().notNull().default([]),
  requests: jsonb('requests').$type<Record<string, { action: string; actor: string; hash: string }>>().notNull().default({}),
}, table => [
  uniqueIndex('reimbursements_no_idx').on(table.no),
  index('reimbursements_applicant_idx').on(table.applicantId, table.createdAt),
  index('reimbursements_status_idx').on(table.status, table.createdAt),
])

export const feedback = pgTable('feedback', {
  id: text('id').primaryKey(),
  no: text('no').notNull(),
  authorId: text('author_id').notNull().references(() => users.id),
  kind: text('kind').$type<FeedbackKind>().notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  shots: jsonb('shots').$type<string[]>().notNull().default([]),
  status: text('status').$type<FeedbackStatus>().notNull().default('待处理'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  replies: jsonb('replies').$type<Omit<FeedbackReply, 'author'>[]>().notNull().default([]),
  requests: jsonb('requests').$type<Record<string, { action: string; actor: string; hash: string }>>().notNull().default({}),
}, table => [
  uniqueIndex('feedback_no_idx').on(table.no),
  index('feedback_author_idx').on(table.authorId, table.updatedAt),
  index('feedback_status_idx').on(table.status, table.updatedAt),
])

// 论坛、私信与附件独立于订单，不改变任何账目表。
export const forumPosts = pgTable('forum_posts', {
  id: text('id').primaryKey(), no: text('no').notNull(),
  category: text('category').$type<'announcement'|'feedback'|'skill'|'document'|'showcase'>().notNull(),
  authorId: text('author_id').notNull().references(() => users.id),
  title: text('title').notNull(), body: text('body').notNull().default(''),
  feedbackKind: text('feedback_kind').$type<FeedbackKind>(), status: text('status').$type<FeedbackStatus>(),
  private: boolean('private').notNull().default(false), pinned: boolean('pinned').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
  lastActivityAt: ts('last_activity_at').notNull().defaultNow(), editedAt: ts('edited_at'), deletedAt: ts('deleted_at'),
  legacyFeedbackId: text('legacy_feedback_id'),
}, t => [uniqueIndex('forum_posts_no_idx').on(t.no), uniqueIndex('forum_posts_legacy_idx').on(t.legacyFeedbackId), index('forum_posts_activity_idx').on(t.pinned,t.lastActivityAt,t.id), index('forum_posts_author_idx').on(t.authorId)])
export const forumReplies = pgTable('forum_replies', {
  id: text('id').primaryKey(), postId: text('post_id').notNull().references(() => forumPosts.id),
  authorId: text('author_id').notNull().references(() => users.id), body: text('body').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(), editedAt: ts('edited_at'), deletedAt: ts('deleted_at'),
}, t => [index('forum_replies_post_idx').on(t.postId,t.createdAt)])
export const forumReads = pgTable('forum_reads', {
  postId: text('post_id').notNull().references(() => forumPosts.id), userId: text('user_id').notNull().references(() => users.id), readAt: ts('read_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.postId,t.userId] })])
export const forumLikes = pgTable('forum_likes', {
  postId: text('post_id').notNull().references(() => forumPosts.id), userId: text('user_id').notNull().references(() => users.id), createdAt: ts('created_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.postId,t.userId] })])
export const dmThreads = pgTable('dm_threads', {
  id: text('id').primaryKey(), participantA: text('participant_a').notNull().references(() => users.id), participantB: text('participant_b').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
}, t => [uniqueIndex('dm_threads_pair_idx').on(t.participantA,t.participantB)])
export const dmMessages = pgTable('dm_messages', {
  id: text('id').primaryKey(), threadId: text('thread_id').notNull().references(() => dmThreads.id), senderId: text('sender_id').notNull().references(() => users.id),
  body: text('body').notNull().default(''), createdAt: ts('created_at').notNull().defaultNow(), retractedAt: ts('retracted_at'),
}, t => [index('dm_messages_thread_idx').on(t.threadId,t.createdAt,t.id)])
export const dmReads = pgTable('dm_reads', {
  threadId: text('thread_id').notNull().references(() => dmThreads.id), userId: text('user_id').notNull().references(() => users.id), readAt: ts('read_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.threadId,t.userId] })])
export const forumAttachments = pgTable('forum_attachments', {
  id: text('id').primaryKey(), ownerKind: text('owner_kind').$type<'post'|'reply'|'dm'>(), ownerId: text('owner_id'),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id), name: text('name').notNull(),
  size: bigint('size', {mode:'number'}).notNull(), mime: text('mime').notNull(), path: text('path').notNull(), thumbPath: text('thumb_path'),
  version: text('version'), downloads: integer('downloads').notNull().default(0), legacyUrl: text('legacy_url'),
  createdAt: ts('created_at').notNull().defaultNow(), deletedAt: ts('deleted_at'),
}, t => [index('forum_attachments_owner_idx').on(t.ownerKind,t.ownerId)])
export const forumUploads = pgTable('forum_uploads', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id), requestId: text('request_id').notNull(),
  name: text('name').notNull(), size: bigint('size',{mode:'number'}).notNull(), mime: text('mime').notNull(), version: text('version'),
  received: bigint('received',{mode:'number'}).notNull().default(0), path: text('path').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(), doneAt: ts('done_at'), attachmentId: text('attachment_id').references(() => forumAttachments.id),
}, t => [uniqueIndex('forum_uploads_request_idx').on(t.userId,t.requestId)])
export const forumRequests = pgTable('forum_requests', {
  actorId: text('actor_id').notNull().references(() => users.id), requestId: text('request_id').notNull(), action: text('action').notNull(), hash: text('hash').notNull(),
  result: jsonb('result').$type<Record<string,unknown>>().notNull(), createdAt: ts('created_at').notNull().defaultNow(),
}, t => [primaryKey({columns:[t.actorId,t.requestId]})])

/** 每日上下班与午休节点；只存服务器确认的北京时间日期和首次点击时间。 */
export const dailyCheckins = pgTable('daily_checkins', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  day: date('day', { mode: 'string' }).notNull(),
  clockInAt: ts('clock_in_at').notNull().defaultNow(),
  clockOutAt: ts('clock_out_at'),
  clockInPhoto: text('clock_in_photo').notNull(),
  clockOutPhoto: text('clock_out_photo'),
  breakStartAt: ts('break_start_at'),
  breakEndAt: ts('break_end_at'),
}, t => [uniqueIndex('daily_checkins_user_day_idx').on(t.userId, t.day), index('daily_checkins_day_idx').on(t.day)])

export const checkinRequests = pgTable('checkin_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  requestId: text('request_id').notNull(),
  kind: text('kind').$type<'late' | 'early' | 'leave' | 'overtime' | 'weekend'>().notNull(),
  startAt: ts('start_at').notNull(),
  endAt: ts('end_at').notNull(),
  reason: text('reason').notNull(),
  status: text('status').$type<'pending' | 'approved' | 'rejected'>().notNull().default('pending'),
  decisionReason: text('decision_reason'),
  decidedAt: ts('decided_at'),
  decidedBy: text('decided_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
}, t => [uniqueIndex('checkin_requests_user_request_idx').on(t.userId, t.requestId), index('checkin_requests_user_start_idx').on(t.userId, t.startAt)])

export const materials = pgTable('work_materials', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'case' | 'talk'>().notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: text('category').notNull(),
  major: text('major').notNull().default(''),
  imageHash: text('image_hash'),
  originalFormats: jsonb('original_formats').$type<Record<string,string>>().notNull().default({}),
  extraImageHashes: jsonb('extra_image_hashes').$type<string[]>().notNull().default([]),
  filePath: text('file_path'),
  fileName: text('file_name'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})
export const materialFavorites = pgTable('work_material_favorites', {
  userId: text('user_id').notNull().references(() => users.id),
  materialId: text('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.userId, t.materialId] })])

/** 奖惩（原复盘）：惩罚走写手回复、老板确认的流程；金额可空，空的就是只复盘不扣钱；奖励直接记完 */
export const qualityReviews = pgTable('quality_reviews', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'penalty' | 'reward'>().notNull().default('penalty'),
  category: text('category').notNull().default(''),
  amount: money('amount'),
  /** 可不关联订单，比如提出新制度 */
  orderId: text('order_id').references(() => orders.id),
  writerId: text('writer_id').notNull().references(() => users.id),
  creatorId: text('creator_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  issue: text('issue').notNull(),
  imageHash: text('image_hash'),
  extraImageHashes: jsonb('extra_image_hashes').$type<string[]>().notNull().default([]),
  status: text('status').$type<'pending' | 'waiting' | 'done'>().notNull().default('pending'),
  history: jsonb('history').$type<ReviewMessage[]>().notNull().default([]),
  reply: text('reply').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(),
  repliedAt: ts('replied_at'),
  confirmedAt: ts('confirmed_at'),
  revokedAt: ts('revoked_at'),
  revokedBy: text('revoked_by'),
  revokeReason: text('revoke_reason').notNull().default(''),
  /** 随写手工资一起结清的时间；结清后不能撤销 */
  settledAt: ts('settled_at'),
  settledBy: text('settled_by'),
}, t => [index('quality_reviews_writer_status').on(t.writerId, t.status)])

export const materialCategories = pgTable('work_material_categories', {
  kind: text('kind').$type<'case' | 'talk'>().notNull(),
  name: text('name').notNull(),
}, t => [primaryKey({ columns: [t.kind, t.name] })])


/** 外包往来独立记账；成本仍只在原订单中计算一次。 */
export const contractors = pgTable('contractors', {
  id: text('id').primaryKey(), name: text('name').notNull().unique(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]), avatar: text('avatar'),
  note: text('note').notNull().default(''), active: boolean('active').notNull().default(true),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})
export const contractorPayments = pgTable('contractor_payments', {
  id: text('id').primaryKey(), contractorId: text('contractor_id').notNull().references(() => contractors.id),
  amount: money('amount').notNull(), date: date('date', { mode: 'string' }).notNull(),
  note: text('note').notNull(), by: text('by').notNull().references(() => users.id),
  at: ts('at').notNull().defaultNow(), revokedAt: ts('revoked_at'), revokeReason: text('revoke_reason'),
})

/** 意向单与正式订单分开；未转单不进入业绩、收款和工资。 */
export const inquiries = pgTable('inquiries', {
 id: text('id').primaryKey(), title: text('title').notNull(), ownerId: text('owner_id').notNull().references(() => users.id),
 channelId: text('channel_id').references(() => channels.id), quote: money('quote'), note: text('note').notNull().default(''),
 status: text('status').notNull().default('active'), orderId: text('order_id').references(() => orders.id),
 updatedAt: ts('updated_at').notNull().defaultNow(),
})

/** 专用只读令牌，不能作为网页会话用于写接口。 */
export const agentTokens = pgTable('agent_tokens', {
 id: text('id').primaryKey(), hash: text('hash').notNull().unique(), userId: text('user_id').notNull().references(() => users.id),
 name: text('name').notNull(), scopes: jsonb('scopes').$type<('orders'|'income')[]>().notNull(),
 expiresAt: ts('expires_at').notNull(), revokedAt: ts('revoked_at'), createdAt: ts('created_at').notNull().defaultNow(),
})
