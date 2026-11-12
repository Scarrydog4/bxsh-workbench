import type { FieldGroups, Order, OrderView, PermKey, Role, RowScope, SettleStatus, User } from './types'
import { calc, customerStage, ownerCommission, proxyFee, sumMoney } from './calc'
import { paymentSnapshot } from './reconciliation'
import { remaining } from './settle'

export const PERM_GROUPS: { module: string; items: { key: PermKey; label: string }[] }[] = [
  {
    module: '订单',
    items: [
      { key: 'order.view', label: '查看订单' },
      { key: 'order.create', label: '录单' },
      { key: 'order.edit', label: '改基础信息、选写手' },
      { key: 'order.status', label: '改订单状态' },
      { key: 'order.price', label: '改原价、追加与减免' },
      { key: 'order.assign', label: '定写手工资与归属' },
      { key: 'order.draft', label: '提交交付、调整交期（自己写的单）' },
      { key: 'node.edit', label: '改进度节点' },
      { key: 'card.edit', label: '填需求卡片' },
      { key: 'order.delete', label: '删除订单' },
      { key: 'order.export', label: '导出 Excel' },
    ],
  },
  {
    module: '跟进',
    items: [
      { key: 'aftersale.create', label: '登记跟进' },
      { key: 'aftersale.reason', label: '修改跟进类型与工资' },
    ],
  },
  { module: '收款', items: [{ key: 'payment.create', label: '记收款、待收' }] },
  { module: '结算', items: [{ key: 'settle.manage', label: '发起、确认、作废结算单' }] },
  { module: '工具箱', items: [{ key: 'toolbox.use', label: '使用笔像双降、查看自己的处理记录' }, { key: 'toolbox.manage', label: '查看全部工具任务与服务设置' }, { key: 'points.manage', label: '查看并分配账号积分、设置工具价格' }] },
  {
    module: '渠道',
    items: [
      { key: 'channel.view', label: '查看渠道库' },
      { key: 'channel.manage', label: '管理渠道' },
      { key: 'statement.view', label: '对账单与分享链接' },
    ],
  },
  {
    module: '系统',
    items: [
      { key: 'income.all', label: '查看所有人收入' },
      { key: 'audit.view', label: '审计日志' },
      { key: 'trash.view', label: '回收站与恢复' },
      { key: 'options.manage', label: '选项、节点模板、需求卡片字段' },
      { key: 'role.manage', label: '角色与账号' },
    ],
  },
]

// 论坛管理和旁观私信仅限管理员，不在自定义角色的授权列表中开放。
export const ADMIN_ONLY_PERMS: PermKey[] = ['forum.announce', 'forum.manage', 'dm.viewAll']
export const ALL_PERMS: PermKey[] = [...PERM_GROUPS.flatMap((g) => g.items.map((i) => i.key)), ...ADMIN_ONLY_PERMS]

export const ROW_SCOPES: { value: RowScope; label: string }[] = [
  { value: 'all', label: '全部订单' },
  { value: 'owned', label: '归属自己' },
  { value: 'assigned', label: '自己是写手' },
  { value: 'ownedOrAssigned', label: '归属自己或自己是写手' },
]

export const FIELD_GROUPS: { key: keyof FieldGroups; label: string; hint: string; tri?: boolean }[] = [
  { key: 'sales', label: '销售额与收款', hint: '原价、追加/减免、销售额、收款、未收' },
  { key: 'writerPay', label: '写手工资', hint: '只看自己的，或全部人的', tri: true },
  { key: 'commission', label: '销售提成', hint: '只看自己的，或全部人的', tri: true },
  { key: 'profit', label: '预计利润', hint: '按自营 / 销售单规则计算' },
  { key: 'channelNo', label: '渠道单号', hint: '渠道方自己的单号' },
]

export const ADMIN_ROLE_ID = 'r-admin'

export function can(role: Role, perm: PermKey) {
  return role.locked || (!ADMIN_ONLY_PERMS.includes(perm) && role.perms.includes(perm))
}

export function canAdjustDeadline(order: { assignees: { userId: string }[] }, user: Pick<User, 'id'>, role: Role) {
  return can(role, 'order.edit') || (can(role, 'order.draft') && order.assignees.some(a => a.userId === user.id))
}

export function rowVisible(order: Pick<Order, 'ownerId'> & { proxyId?: string | null; assignees: { userId: string }[] }, user: Pick<User, 'id'>, role: Role) {
  if (role.locked) return true
  // 替暂停的销售代录的单，代录人也能看到
  const owned = order.ownerId === user.id || (!!order.proxyId && order.proxyId === user.id)
  const assigned = order.assignees.some((a) => a.userId === user.id)
  switch (role.rowScope) {
    case 'all':
      return true
    case 'owned':
      return owned
    case 'assigned':
      return assigned
    case 'ownedOrAssigned':
      return owned || assigned
  }
}

/**
 * 正式版里这一步在服务端接口返回前执行；原型里所有页面也只读这份裁剪结果。
 */
export function project(order: Order, user: User, role: Role, adminIds: Set<string>, c = calc(order, adminIds)): OrderView {
  const f: FieldGroups = role.locked
    ? { sales: true, writerPay: 'all', commission: 'all', profit: true, channelNo: true }
    : role.fields
  const customer = customerStage(order)
  const mine = order.assignees.find((a) => a.userId === user.id)
  const v: OrderView = {
    id: order.id,
    no: order.no,
    title: order.title,
    orderDate: order.orderDate,
    dueDate: order.dueDate,
    urgency: order.urgency,
    importance: order.importance,
    progressNote: order.progressNote,
    ownerId: order.ownerId,
    creatorId: order.creatorId,
    channelId: order.channelId,
    type: order.type,
    status: order.status,
    note: order.note,
    wechatGroup: order.wechatGroup,
    draftAt: order.draftAt,
    ...(role.locked ? { allocationPolicy: order.allocationPolicy, writerPayPlan: order.writerPayPlan, writerRatesEnabled: order.writerRatesEnabled } : {}),
    ...customer,
    customerPaidUpAt: customer.paidUpAt,
    writerProgress: order.writerProgress?.filter(p => order.assignees.some(a => a.userId === p.userId)),
    graduatedAt: order.graduatedAt,
    isSelf: c.isSelf,
    salesMode: order.salesMode ?? 'commission',
    payPending: c.payPending,
    attachments: order.attachments,
    req: order.req,
    nodes: order.nodes,
    // 追加工资属于写手工资：看不到写手工资的人也看不到这一项
    afterSales: order.afterSales.map((a) => ({ ...a, extra: f.writerPay === 'all' || (f.writerPay === 'own' && a.writerId === user.id) ? a.extra : undefined })),
    assignees: order.assignees.map((a) => ({
      userId: a.userId,
      pay: f.writerPay === 'all' || (f.writerPay === 'own' && a.userId === user.id) ? a.pay : undefined,
      ...(role.locked ? { rate: a.rate } : {}),
    })),
  }
  if (f.channelNo) v.channelNo = order.channelNo
  if (f.sales) {
    v.basePrice = order.basePrice
    v.adjustments = order.adjustments
    v.sales = c.sales
    v.received = c.received
    v.unpaid = c.unpaid
    v.payStatus = c.payStatus
    v.payments = order.payments
    v.paymentCheckToken = paymentSnapshot(order)
    const checked = order.paymentCheckedSnapshot === v.paymentCheckToken
    v.paymentCheckedAt = checked ? order.paymentCheckedAt ?? null : null
    v.paymentCheckedBy = checked ? order.paymentCheckedBy ?? null : null
    v.receivables = order.receivables
  }
  if (f.writerPay === 'all') v.writerTotal = c.writerTotal
  if (mine && f.writerPay !== 'none') v.myPay = mine.pay
  if (f.writerPay !== 'none') v.writerAvailable = sumMoney(order.assignees
    .filter(a => !adminIds.has(a.userId) && (f.writerPay === 'all' || a.userId === user.id))
    .map(a => remaining(order, '写手工资', a.userId, adminIds)))
  if (f.commission === 'all' || (f.commission === 'own' && order.ownerId === user.id)) {
    v.commission = ownerCommission(order, c.commission)
    if (role.locked) v.commissionRate = order.commissionRate
  }
  if (order.proxyId) {
    v.proxyId = order.proxyId
    // 代录费：老板、归属销售（从他提成里扣）、代录人本人看得到
    if (f.commission === 'all' || (f.commission === 'own' && (order.ownerId === user.id || order.proxyId === user.id))) v.proxyFee = c.payPending ? null : proxyFee(order, c.commission)
  }
  if (f.profit) { v.extraCosts = order.extraCosts ?? []; v.extraCostTotal = c.extraCostTotal; v.allocationBase = c.allocationBase; v.profit = c.profit; v.bossIncome = c.bossIncome; v.externalWriterTotal = c.externalWriterTotal }

  // 结算：只给看得到对应金额的人
  const live = order.settlements.filter((x) => x.status === '已确认')
  const sum = (kind: string, payee?: string) => sumMoney(live.filter((x) => x.kind === kind && (!payee || x.payeeId === payee)).map(x => x.amount))
  const status = (paid: number, due: number): SettleStatus => (paid <= 0 ? '未结算' : paid < due ? '部分结算' : '已结算')
  const seeWriter = (payee: string) => f.writerPay === 'all' || (f.writerPay === 'own' && payee === user.id)
  const seeComm = (payee: string) => f.commission === 'all' || (f.commission === 'own' && payee === user.id)
  v.settlements = order.settlements.filter((x) => (x.kind === '写手工资' ? seeWriter(x.payeeId) : seeComm(x.payeeId)))
  if (f.writerPay === 'all') v.writerSettle = status(sum('写手工资'), c.writerTotal)
  else if (mine && f.writerPay === 'own') v.writerSettle = status(sum('写手工资', user.id), (mine.pay ?? 0) + order.afterSales.filter((a) => a.writerId === user.id).reduce((t, a) => t + a.extra, 0))
  if (order.salesMode !== 'cost' && !c.isSelf && seeComm(order.ownerId) && v.commission !== undefined) v.salesSettle = status(sum('销售提成', order.ownerId), v.commission)
  if (role.locked) v.reviewFlag = order.reviewFlag
  return v
}

export function hiddenGroups(role: Role) {
  if (role.locked) return []
  const out: string[] = []
  if (!role.fields.sales) out.push('销售额与收款')
  if (role.fields.writerPay === 'none') out.push('写手工资')
  if (role.fields.writerPay === 'own') out.push('他人工资')
  if (role.fields.commission === 'none') out.push('销售提成')
  if (role.fields.commission === 'own') out.push('他人提成')
  if (!role.fields.profit) out.push('预计利润')
  if (!role.fields.channelNo) out.push('渠道单号')
  return out
}
