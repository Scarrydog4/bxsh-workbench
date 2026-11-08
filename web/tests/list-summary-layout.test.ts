import { describe, expect, it } from 'vitest'
import { orderListSummary } from '@/shared/order-list-summary'
import { migrateOrderDefaultColumns, migratePayrollDefaultColumns, migrateChannelDefaultColumns, ORDER_DEFAULT_COLUMNS } from '@/shared/table-default-layouts'
import { taskTodaySummary } from '@/shared/task-today-summary'
import type { OrderView } from '@/shared/types'

describe('订单销售额统一口径', () => {
  it('页头、页脚与选中小计都排除退单 50 元，保留按分金额和未收/多收', () => {
    const rows = [
      { status: '未交付', sales: 251926.88, unpaid: 20 },
      { status: '退单', sales: 50, unpaid: 30 },
      { status: '已交付', sales: 0, unpaid: -10 },
    ]
    expect(orderListSummary(rows)).toEqual({ sales: 251926.88, unpaid: 20, overpaid: 10, hasSales: true })
    expect(orderListSummary(rows.filter(row => row.status === '退单'))).toEqual({ sales: 0, unpaid: 0, overpaid: 0, hasSales: true })
    expect(orderListSummary([{ status: '已交付', sales: 0.1 }, { status: '已交付', sales: 0.2 }]).sales).toBe(0.3)
    expect(orderListSummary([{ status: '未交付' }]).hasSales).toBe(false)
  })
})

describe('金额优先默认列不覆盖个人布局', () => {
  it('仅升级已知旧默认顺序，拖动过的列表保持引用和内容', () => {
    expect(migrateOrderDefaultColumns(['select', 'orderDate', 'title', 'status', 'progressNote', 'dueDate', 'channel', 'assignees', 'sales', 'unpaid'])).toEqual(ORDER_DEFAULT_COLUMNS)
    const custom = ['select', 'channel', 'title', 'sales', 'orderDate']
    expect(migrateOrderDefaultColumns(custom)).toBe(custom)
    expect(migratePayrollDefaultColumns(['orderDate', 'title'])).toEqual([])
    expect(migratePayrollDefaultColumns(custom)).toBe(custom)
    expect(migrateChannelDefaultColumns(['name', 'owner', 'n', 'sales', 'unpaid', 'actions'])).toEqual(['name', 'sales', 'unpaid', 'n', 'owner', 'actions'])
    expect(migrateChannelDefaultColumns(custom)).toBe(custom)
  })
})

const day = '2026-11-04'
const row = (id: string, patch: Partial<OrderView> = {}): OrderView => ({
  id, no: id, title: id, orderDate: '2026-11-01', dueDate: day, ownerId: 'boss', creatorId: 'boss', channelId: 'c', type: '', status: '未交付', note: '', wechatGroup: '', draftAt: null,
  isSelf: false, assignees: [{ userId: 'mine' }], payPending: false, attachments: [], afterSales: [], req: {}, nodes: [], ...patch,
})

describe('今天截止统一为当前人员和搜索范围内的订单', () => {
  it('39 个初稿不混入跟进，提前交付仍计入今天截止的已交，退单及其他日期不计', () => {
    const pending = Array.from({ length: 39 }, (_, i) => row(String(i)))
    const done = row('done', { status: '已交付', draftAt: '2026-11-03T02:00:00Z' })
    const otherDate = row('other-date', { status: '已交付', draftAt: '2026-11-04T01:00:00Z', dueDate: '2026-11-05' })
    const returned = row('returned', { status: '退单', draftAt: '2026-11-04T01:00:00Z' })
    expect(taskTodaySummary(pending, [...pending, done, otherDate, returned], day, new Set())).toEqual({ left: 39, done: 1, total: 40 })
    expect(taskTodaySummary([pending[0]], [pending[0]], day, new Set())).toEqual({ left: 1, done: 0, total: 1 })
    expect(taskTodaySummary([pending[0]], [pending[0]], day, new Set([pending[0].id]))).toEqual({ left: 0, done: 0, total: 0 })
  })

  it('写手没有工资方案字段时，合作者已交不能冒充本人的完成记录', () => {
    const shared = row('shared', { status: '已交付', draftAt: '2026-11-04T01:00:00Z', assignees: [{ userId: 'mine' }, { userId: 'other' }], writerProgress: [
      { userId: 'other', completedAt: '2026-11-04T01:00:00Z', completedProofIds: ['a'], groupSentAt: '2026-11-04T01:00:00Z', groupProofIds: ['b'] },
    ] })
    expect(taskTodaySummary([shared], [shared], day, new Set(), 'mine')).toEqual({ left: 1, done: 0, total: 1 })
    expect(taskTodaySummary([], [shared], day, new Set(), 'other')).toEqual({ left: 0, done: 1, total: 1 })
  })

  it('已发演示从今天待交中移出，不冒充正式已交，也不影响其他待交单', () => {
    const demo = row('demo', { status: '已发演示', writerProgress: [{ userId: 'mine', completedAt: null, completedProofIds: [], groupSentAt: null, groupProofIds: [] }] })
    const pending = row('pending')
    for (const userId of [undefined, 'mine']) {
      expect(taskTodaySummary([demo, pending], [demo, pending], day, new Set(), userId)).toEqual({ left: 1, done: 0, total: 1 })
    }
  })
})
