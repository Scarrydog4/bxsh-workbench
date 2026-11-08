import { channelAccessible } from '@/shared/channel-access'
import type { World } from './repo'
import { adminIdsOf } from './repo'
import { calc, cents, sumMoney } from '@/shared/calc'
import { can, rowVisible } from '@/shared/perm'
import type { Role, User } from '@/shared/types'
import { canViewChannelReceipt } from './channel-receipts'

export interface StatementRow {
  no: string
  title: string
  orderDate: string
  channelNo: string
  status: string
  sales: number
  received: number
  unpaid: number
}
export interface StatementPrepayment {
  no: string
  date: string
  amount: number
  allocated: number
  unallocated: number
}

/**
 * 渠道对账单：某渠道某月（按下单日期）的订单、渠道单号、金额、已收、未收。
 * 只列出 user 按自己角色看得到的单；要求能看销售额，否则返回 null。
 */
export function statement(w: World, user: User, role: Role, channelId: string, month: string) {
  if (!can(role, 'statement.view') || !(role.locked || role.fields.sales)) return null
  const ch = w.channels.find((x) => x.id === channelId)
  if (!ch || ch.deletedAt || !channelAccessible(ch, user, role)) return null
  const admins = adminIdsOf(w)
  const rows: StatementRow[] = w.orders
    .filter((o) => !o.deletedAt && o.salesMode !== 'cost' && o.channelId === channelId && o.orderDate.startsWith(month) && rowVisible(o, user, role))
    .sort((a, b) => (a.orderDate < b.orderDate ? -1 : a.orderDate > b.orderDate ? 1 : a.no < b.no ? -1 : 1))
    .map((o) => {
      const c = calc(o, admins)
      return { no: o.no, title: o.title, orderDate: o.orderDate, channelNo: o.channelNo, status: o.status, sales: c.sales, received: c.received, unpaid: c.unpaid }
    })
  const sum = (k: 'sales' | 'received' | 'unpaid') => Math.round(rows.filter((r) => r.status !== '退单' || k !== 'sales').reduce((s, r) => s + r[k], 0) * 100) / 100
  // 本月收到、当前仍未分配的预收款独立列示；不抵减订单未收，也不向分享页暴露内部备注/凭证。
  const prepayments: StatementPrepayment[] = (w.channelReceipts ?? [])
    .filter(receipt => !receipt.revoked && receipt.channelId === channelId && receipt.date.startsWith(month) && cents(receipt.unallocated) > 0 && canViewChannelReceipt(w, { me: user, role }, receipt))
    .map(({ no, date, amount, allocated, unallocated }) => ({ no, date, amount, allocated, unallocated }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no))
  return { channel: ch.name, month, rows, total: { sales: sum('sales'), received: sum('received'), unpaid: sum('unpaid') },
    prepayments, prepaymentTotal: sumMoney(prepayments.map(receipt => receipt.unallocated)) }
}
