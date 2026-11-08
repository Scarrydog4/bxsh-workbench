import { describe, expect, it } from 'vitest'
import { buildWriterWorkbench } from '@/shared/writer-workbench'
import { project } from '@/shared/perm'
import type { AfterSaleTask } from '@/shared/aftersale-task'
import type { Order, OrderView, Role, User, WriterProgress } from '@/shared/types'

const now = new Date('2026-10-25T12:00:00+08:00').getTime()
const role: Role = { id: 'writer', name: '写手', locked: false, preset: true, perms: ['order.view', 'order.draft'], rowScope: 'assigned', fields: { sales: false, writerPay: 'own', commission: 'none', profit: false, channelNo: false } }
const user: User = { id: 'me', name: '本人', account: 'me', roleId: role.id, hue: 0, commissionRate: .2, canWrite: true, active: true }
const order = (patch: Partial<Order> = {}): Order => ({
  id: 'o', no: 'DD1', title: '测试订单', orderDate: '2026-10-19', dueDate: '2026-10-24', ownerId: 'boss', creatorId: 'boss', channelId: 'c', channelNo: '',
  wechatGroup: '', draftAt: null, type: '', basePrice: 1000, adjustments: [], assignees: [{ userId: 'me', pay: 200 }], status: '未交付', note: '', commissionRate: .2,
  payments: [], attachments: [], afterSales: [], settlements: [], req: {}, nodes: [], receivables: [], reviewFlag: null, deletedAt: null, writerPayPlan: 'completed_balance_50_50', writerProgress: [], ...patch,
})
const view = (patch: Partial<Order> = {}): OrderView => project(order(patch), user, role, new Set(['boss']))
const progress = (id = 'me', patch: Partial<WriterProgress> = {}): WriterProgress => ({ userId: id, completedAt: '2026-10-20T04:00:00Z', completedProofIds: ['initial-proof'], groupSentAt: null, groupProofIds: [], ...patch })
const task = (patch: Partial<AfterSaleTask> = {}): AfterSaleTask => ({ id: 't', orderId: 'o', no: 'DD1', title: '测试订单', channelId: 'c', ownerId: 'boss', round: 1, reason: '正常修改', req: [], shots: [], start: '2026-10-20T00:00:00Z', due: '2026-10-22T00:00:00Z', writerId: 'me', by: 'boss', doneAt: null, files: [], nudges: 0, ...patch })

describe('写手交付工作台', () => {
  it('员工裁剪视图没有工资方案时，仍按本人凭据隔离合作交付状态', () => {
    const shared = view({ assignees: [{ userId: 'me', pay: 200 }, { userId: 'other', pay: 100 }], writerProgress: [progress('other', { groupSentAt: '2026-10-21T00:00:00Z', groupProofIds: ['other-proof'] })], draftAt: '2026-10-21T00:00:00Z' })
    expect(shared.writerPayPlan).toBeUndefined()
    expect(buildWriterWorkbench([shared], [], 'me', now).rows[0].stage).toBe('initial')
    shared.writerProgress!.push(progress('me'))
    const initial = buildWriterWorkbench([shared], [], 'me', now)
    expect(initial.rows[0].stage).toBe('group')
    expect(initial.rows[0].deadlineAt).toBeNull()
    expect(initial.summary.weekInitialCompleted).toBe(1)
    expect(initial.summary.weekGroupDelivered).toBe(0)
    shared.writerProgress![1].groupSentAt = '2026-10-22T00:00:00Z'
    shared.writerProgress![1].groupProofIds = ['mine']
    expect(buildWriterWorkbench([shared], [], 'me', now).rows[0].stage).toBe('done')
    shared.writerProgress![1].completedProofIds = []
    expect(buildWriterWorkbench([shared], [], 'me', now).rows[0].stage).toBe('done')
    shared.writerProgress![1].groupProofIds = []
    expect(buildWriterWorkbench([shared], [], 'me', now).rows[0].stage).toBe('initial')
  })

  it('只收本人订单和本人跟进，退单、删除、撤回和重复项不计入', () => {
    const removed = { ...view({ id: 'removed' }), deletedAt: '2026-10-24T00:00:00Z' }
    const orders = [view(), view({ id: 'other', assignees: [{ userId: 'other', pay: 100 }] }), view({ id: 'returned', status: '退单' }), removed]
    const mine = task()
    const result = buildWriterWorkbench(orders, [mine, mine, task({ id: 'peer', writerId: 'other' }), task({ id: 'gone', cancelledAt: '2026-10-23T00:00:00Z' }), task({ id: 'other-order', orderId: 'other' }), task({ id: 'return-task', orderId: 'returned' })], 'me', now)
    expect(result.rows.map(row => row.order.id)).toEqual(['o'])
    expect(result.rows[0].tasks.map(item => item.id)).toEqual(['t'])
    expect(result.rows[0].stage).toBe('followup')
    expect(result.rows[0].deadlineKind).toBe('followup')
    expect(result.summary.followup).toBe(1)
  })

  it('先排未完成的加急订单，再按最早有效期限，已交付不因旧加急置顶', () => {
    const urgency = { note: '今天需要', at: '2026-10-24T00:00:00Z', by: 'boss' }
    const orders = [view({ id: 'plain', dueDate: '2026-10-20' }), view({ id: 'urgent', dueDate: '2026-10-30', urgency }), view({ id: 'no-date', dueDate: null }), view({ id: 'done', status: '已交付', writerPayPlan: 'full', urgency })]
    const result = buildWriterWorkbench(orders, [], 'me', now)
    expect(result.rows.map(row => row.order.id)).toEqual(['urgent', 'plain', 'no-date', 'done'])
    expect(result.summary.urgent).toBe(1)
    expect(result.rows.at(-1)?.deadlineAt).toBeNull()
  })

  it('本周采用北京时间周一至现在；排除未来记录，旧合作日期不冒充个人完成', () => {
    const completed = (at: string) => progress('me', { completedAt: at, groupSentAt: at, groupProofIds: ['group'] })
    const orders = [
      view({ id: 'sunday', writerProgress: [completed('2026-10-18T15:59:59Z')] }),
      view({ id: 'monday', writerProgress: [completed('2026-10-18T16:00:00Z')] }),
      view({ id: 'future', writerProgress: [completed('2026-10-25T05:00:00Z')] }),
      view({ id: 'legacy-shared', writerPayPlan: 'full', status: '已交付', draftAt: '2026-10-22T00:00:00Z', assignees: [{ userId: 'me', pay: 200 }, { userId: 'other', pay: 200 }] }),
    ]
    const result = buildWriterWorkbench(orders, [], 'me', now)
    expect(result.summary.weekInitialCompleted).toBe(1)
    expect(result.summary.weekGroupDelivered).toBe(1)
    expect(result.growthHints).toEqual(['本周已交付 1 单'])
  })

  it('成长提示只统计本人有完成日期的跟进，普通修改和新增需求不算返工', () => {
    const items = [
      task({ id: 'normal', doneAt: '2026-10-21T00:00:00Z', deliveredLateMin: 0 }),
      task({ id: 'new', reason: '新增需求', doneAt: '2026-10-23T00:00:00Z', deliveredLateMin: 12 }),
      task({ id: 'rework', reason: '写手返工', doneAt: '2026-10-21T01:00:00Z' }),
      task({ id: 'unknown-time', doneAt: 'not-a-date' }),
      task({ id: 'peer', writerId: 'other', reason: '写手返工', doneAt: '2026-10-21T00:00:00Z', deliveredLateMin: 0 }),
    ]
    const result = buildWriterWorkbench([view()], items, 'me', now)
    expect(result.summary.weekFollowupsCompleted).toBe(3)
    expect(result.summary.weekFollowupsOnTime).toBe(2)
    expect(result.summary.weekReworks).toBe(1)
    expect(result.growthHints).toEqual(['本周按时完成 2 次跟进'])
  })

  it('旧单演示不算最终交付；待跟进排序期限与展示中的跟进回复或交付期限一致', () => {
    const demo = view({ writerPayPlan: 'full', status: '已发演示', draftAt: '2026-10-21T00:00:00Z' })
    expect(buildWriterWorkbench([demo], [], 'me', now).rows[0].stage).toBe('group')
    const result = buildWriterWorkbench([view({ dueDate: '2026-10-20' })], [task({ due: '2026-10-26T00:00:00Z' })], 'me', now)
    expect(result.rows[0].stage).toBe('followup')
    expect(result.rows[0].deadlineKind).toBe('followup')
    expect(result.rows[0].deadlineAt).toBe('2026-10-26T00:00:00Z')
    expect(result.growthHints).toEqual([])
    const waiting = buildWriterWorkbench([view()], [task({ confirmBy: '2026-10-25T05:00:00Z', due: '2026-10-26T00:00:00Z' })], 'me', now)
    expect(waiting.rows[0].deadlineAt).toBe('2026-10-25T05:00:00Z')
  })

  it('有个人凭据的演示单停止原初稿期限，保留本人未完成和正式交付凭据', () => {
    const demo = view({ status: '已发演示', writerProgress: [progress('me', { completedAt: null, completedProofIds: [] })] })
    const before = structuredClone(demo)
    const work = buildWriterWorkbench([demo], [], 'me', now)
    expect(work.rows[0]).toMatchObject({ stage: 'initial', stageLabel: '待正式交付', initialDone: false, groupDone: false, deadlineAt: null, deadlineKind: null })
    expect(work.summary.weekInitialCompleted).toBe(0)
    expect(work.summary.weekGroupDelivered).toBe(0)
    expect(demo).toEqual(before)
    const followup = task({ due: '2026-10-24T03:00:00Z', confirmedAt: '2026-10-23T03:00:00Z' })
    expect(buildWriterWorkbench([demo], [followup], 'me', now).rows[0]).toMatchObject({ stage: 'followup', deadlineAt: followup.due, deadlineKind: 'followup' })
    expect(buildWriterWorkbench([{ ...demo, status: '未交付' }], [], 'me', now).rows[0].deadlineAt).toBe('2026-10-24T23:59:59.999+08:00')
  })
})
