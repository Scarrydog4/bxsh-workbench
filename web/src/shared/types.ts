import type { AvatarFrameId } from './avatar-frames'
import type { AllocationPolicy } from './allocation'
export type RowScope = 'all' | 'owned' | 'assigned' | 'ownedOrAssigned'
export type Visibility = 'none' | 'own' | 'all'
export type SalesMode = 'commission' | 'cost'
export type WriterPayPlan = 'full' | 'staged' | 'completed_balance_50_50'

export interface FieldGroups {
  sales: boolean
  writerPay: Visibility
  commission: Visibility
  profit: boolean
  channelNo: boolean
}

export type PermKey =
  | 'forum.announce'
  | 'forum.manage'
  | 'dm.viewAll'
  | 'order.view'
  | 'order.create'
  | 'order.edit'
  | 'order.status'
  | 'order.price'
  | 'order.assign'
  | 'order.delete'
  | 'order.export'
  | 'payment.create'
  | 'aftersale.create'
  | 'aftersale.reason'
  | 'order.draft'
  | 'channel.view'
  | 'channel.manage'
  | 'income.all'
  | 'audit.view'
  | 'trash.view'
  | 'role.manage'
  | 'toolbox.use'
  | 'toolbox.manage'
  | 'points.manage'
  | 'node.edit'
  | 'card.edit'
  | 'settle.manage'
  | 'statement.view'
  | 'options.manage'

export interface Role {
  id: string
  name: string
  locked: boolean
  preset: boolean
  perms: PermKey[]
  fields: FieldGroups
  rowScope: RowScope
}

export interface User {
  id: string
  name: string
  account: string
  roleId: string
  hue: number
  commissionRate: number
  writerRate?: number
  salesMode?: SalesMode
  avatar?: string
  frame?: AvatarFrameId
  /** 能被选为写手（写手名单只列这些人） */
  canWrite: boolean
  /** 停用的账号不能登录、不能被选为新单的人，但历史订单照常显示和计算 */
  active: boolean
  /** 销售暂停接单的时间：头像变灰，其他销售可以替他录单 */
  pausedAt?: string | null
}

export interface Channel {
  deletedAt?: string | null
  id: string
  name: string
  ownerId: string
  note: string
  active: boolean
  avatar?: string
}

/** 管理员撤销记错的收款、追加 / 减免：记录还在，不再计入金额 */
export interface Revoked {
  at: string
  by: string
  reason: string
}

export interface Adjustment {
  id: string
  amount: number
  reason: string
  at: string
  by: string
  revoked?: Revoked
}

export interface Assignee {
  userId: string
  /** 本单约定比例；null 为按金额，账号默认值不会回写本单。 */
  rate?: number | null
  /** null = 工资还没定 */
  pay: number | null
}

/** 每位写手自己的完成凭据，不随改工资、排序或暂时移除写手而丢失。 */
export interface WriterProgress {
  userId: string
  completedAt: string | null
  completedProofIds: string[]
  groupSentAt: string | null
  groupProofIds: string[]
}

export type AfterSaleReason = '正常修改' | '写手返工' | '新增需求'

/** 跟进卡：订单下面的一轮修改。写手改完自己点「已改完」就结束，没有审核。 */
export interface AfterSale {
  id: string
  round: number
  reason: AfterSaleReason
  req: string[]
  shots: string[]
  start: string
  due: string
  /** 写手须在此时间前回复；历史任务为空，不追溯 */
  confirmBy?: string | null
  confirmedAt?: string | null
  chosenHours?: number | null
  lateConfirm?: boolean
  overdueAt?: string | null
  deliveredLateMin?: number
  cancelledAt?: string | null
  writerId: string
  by: string
  doneAt: string | null
  files: { id: string; name: string; size: number }[]
  /** 新增需求给写手的追加工资 */
  extra: number
  nudges: number
}

export interface Attachment {
  id: string
  afterSaleId?: string | null
  /** 挂在哪个进度节点上（节点的交付文件） */
  nodeId?: string | null
  name: string
  size: number
  mime?: string
  /** 图片保留缩略图；其他文件只记文件名和大小（原型不存文件内容）。 */
  preview?: string
  at: string
  by: string
}

export interface Payment {
  receiptId?: string
  id: string
  amount: number
  date: string
  tag: string
  note: string
  by: string
  /** 转账截图凭证 */
  proof?: string
  revoked?: Revoked
}

export interface ExtraCost {
  contractorId?: string | null
  id: string
  name: string
  contractor: string
  amount: number
  date: string
  note: string
  proof?: string
  at: string
  by: string
  revoked?: Revoked
}

export interface OrderUrgency {
  note: string
  at: string
  by: string
}

export interface Order {
  extraCosts?: ExtraCost[]
  urgency?: OrderUrgency | null
  importance?: OrderUrgency | null
  progressNote?: string
  allocationPolicy?: AllocationPolicy
  writerRatesEnabled?: boolean
  writerPayPlan?: WriterPayPlan
  writerProgress?: WriterProgress[]
  graduatedAt?: string | null
  id: string
  no: string
  title: string
  orderDate: string
  dueDate: string | null
  ownerId: string
  creatorId: string
  channelId: string
  channelNo: string
  /** 这单的微信群名：沟通都在群里，系统只记群名，方便对上号 */
  wechatGroup: string
  /** 初稿交出去的时间：决定写手工资进哪一期（15 日前完成进当月 15 日） */
  draftAt: string | null
  type: string
  basePrice: number
  adjustments: Adjustment[]
  assignees: Assignee[]
  status: string
  note: string
  commissionRate: number
  /** 代录人：归属销售暂停时替他录单的销售 */
  proxyId?: string | null
  /** 代录费比例，按实收总金额算，从归属销售提成里扣 */
  proxyRate?: number
  salesMode?: SalesMode
  paymentCheckedAt?: string | null
  paymentCheckedBy?: string | null
  paymentCheckedSnapshot?: string | null
  payments: Payment[]
  attachments: Attachment[]
  afterSales: AfterSale[]
  settlements: Settlement[]
  /** 需求卡片：字段 id → 值 */
  req: Record<string, unknown>
  nodes: OrderNode[]
  receivables: Receivable[]
  reviewFlag: string | null
  deletedAt: string | null
}

export type NodeStatus = '待做' | '进行中' | '完成'

export interface OrderNode {
  id: string
  name: string
  status: NodeStatus
  planDate: string | null
  doneDate: string | null
  ownerId: string | null
  note: string
  sort: number
}

/** 待收：预计哪天收到多少；收到后转成实收 */
export interface Receivable {
  id: string
  amount: number
  dueDate: string
  tag: string
  note: string
  by: string
  createdAt: string
  paymentId: string | null
  doneAt: string | null
  cancelledAt: string | null
}

export type CardFieldType = 'text' | 'longtext' | 'number' | 'select' | 'date' | 'file'

export interface CardField {
  id: string
  label: string
  type: CardFieldType
  choices: string[]
  builtin: boolean
  sort: number
  archived: boolean
}

export interface NodeTemplate {
  id: string
  name: string
  nodes: { name: string; days: number | null }[]
  sort: number
}

export type BatchStatus = '草稿' | '已确认' | '已作废'

export interface SettleBatch {
  /** 无批次的历史实发只读展示，不代表一次新的发放。 */
  historical?: boolean
  id: string
  no: string
  kind: '写手工资' | '销售提成'
  payeeId: string
  period: string | null
  status: BatchStatus
  note: string
  shots?: string[]
  createdBy: string
  createdAt: string
  confirmedAt: string | null
  confirmedBy: string | null
  receivedAt: string | null
  voidedAt: string | null
  lines: { id: string; orderId: string; no: string; title: string; amount: number; note?: string }[]
  total: number
}

export interface Notification {
  id: string
  kind: string
  orderId: string | null
  tab: string | null
  title: string
  body: string
  actorId: string | null
  at: string
  read: boolean
}

export interface Comment {
  id: string
  by: string
  body: string
  images: string[]
  mentions: string[]
  at: string
}

export interface Settlement {
  id: string
  kind: '写手工资' | '销售提成'
  payeeId: string
  amount: number
  status: '草稿' | '已确认' | '已作废'
  note: string
  migrated: boolean
  batchId: string | null
  createdAt?: string
  confirmedAt?: string | null
  /** 所在结算单收款人已确认到账 */
  received: boolean
}

export type SettleStatus = '未结算' | '部分结算' | '已结算'

export type PayStatus = '已收齐' | '部分收款' | '未收款'

/** 按当前账号权限裁剪后的订单：看不到的字段直接不存在。 */
export interface OrderView {
  extraCosts?: ExtraCost[]
  extraCostTotal?: number
  allocationBase?: number
  urgency?: OrderUrgency | null
  importance?: OrderUrgency | null
  progressNote?: string
  custStage?: import('./calc').CustomerStage
  depositAt?: string | null
  paidUpAt?: string | null
  allocationPolicy?: AllocationPolicy
  writerRatesEnabled?: boolean
  writerPayPlan?: WriterPayPlan
  /** 仅告知工资尾款条件，不向写手开放客户收款金额。 */
  customerPaidUpAt?: string | null
  writerProgress?: WriterProgress[]
  graduatedAt?: string | null
  salesMode?: SalesMode
  id: string
  no: string
  title: string
  orderDate: string
  dueDate: string | null
  ownerId: string
  creatorId: string
  channelId: string
  type: string
  status: string
  note: string
  wechatGroup: string
  draftAt: string | null
  isSelf: boolean
  assignees: { userId: string; pay?: number | null; rate?: number | null }[]
  /** 有写手工资还没定：写手工资合计、提成、利润都只能算「待定」 */
  payPending: boolean
  channelNo?: string
  basePrice?: number
  adjustments?: Adjustment[]
  sales?: number
  received?: number
  unpaid?: number
  payStatus?: PayStatus
  paymentCheckedAt?: string | null
  paymentCheckedBy?: string | null
  paymentCheckToken?: string
  payments?: Payment[]
  attachments: Attachment[]
  afterSales: (Omit<AfterSale, 'extra'> & { extra?: number })[]
  writerTotal?: number
  /** 按当前账号可见写手汇总剩余应得，只扣已确认工资，草稿不占用。 */
  writerAvailable?: number
  myPay?: number | null
  commission?: number
  commissionRate?: number
  /** 代录人（替暂停的归属销售录的单） */
  proxyId?: string | null
  /** 代录费：从归属销售提成里扣给代录人；null = 写手工资没定，还算不出 */
  proxyFee?: number | null
  bossIncome?: number
  externalWriterTotal?: number
  profit?: number
  settlements?: Settlement[]
  /** 写手工资结算状态（看得到写手工资才有） */
  writerSettle?: SettleStatus
  /** 销售提成结算状态（看得到这单提成才有） */
  salesSettle?: SettleStatus
  /** 迁移待核对标记，只给管理员 */
  reviewFlag?: string | null
  req: Record<string, unknown>
  nodes: OrderNode[]
  /** 待收：看得到销售额的人才有 */
  receivables?: Receivable[]
}

export interface AuditEntry {
  note?: string
  proof?: string | null
  id: string
  at: string
  actorId: string
  action: string
  objectType: 'order' | 'channel' | 'role' | 'user' | 'session' | 'export' | 'settle' | 'settings' | 'share' | 'reimbursement' | 'channelReceipt'
  objectId?: string
  objectLabel?: string
  field?: string
  from?: string
  to?: string
}
