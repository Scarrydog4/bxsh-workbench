import { describe, expect, it } from 'vitest'
import { dueItems, remaining } from '@/shared/settle'
import { writerStageAmounts, writerStageSummary, writerInitialDone, writerGroupDone } from '@/shared/writer-stages'
import type { Order, Settlement } from '@/shared/types'
import { incomeRowsInPayPeriod, incomeSummary, type IncomeRow } from '@/shared/income'
import { payday } from '@/shared/format'

const admins = new Set(['boss'])
const make = (patch: Partial<Order> = {}): Order => ({
  id: 'order', no: 'DD1', title: '阶段测试', orderDate: '2026-10-12', dueDate: '2026-10-27', ownerId: 'boss', creatorId: 'boss', channelId: 'channel', channelNo: '',
  wechatGroup: '', draftAt: null, type: '', basePrice: 1000, adjustments: [], assignees: [{ userId: 'writer', pay: 200 }, { userId: 'other', pay: 100 }], status: '未交付',
  note: '', commissionRate: .5, payments: [], attachments: [], afterSales: [], settlements: [], req: {}, nodes: [], receivables: [], reviewFlag: null, deletedAt: null,
  writerPayPlan: 'staged', writerProgress: [{ userId: 'writer', completedAt: '2026-10-12T01:00:00Z', completedProofIds: ['first'], groupSentAt: null, groupProofIds: [] }], ...patch,
})
const payment = (amount: number, status: Settlement['status'] = '已确认') => ({ id: 'paid', kind: '写手工资', payeeId: 'writer', amount, status, batchId: null, migrated: false, received: false, note: '' }) as Settlement

describe('写手三阶段工资', () => {
  it('分到分，尾款取余额，任意小额不多发少发', () => {
    for (const total of [0, .01, .03, .05, 1.01, 99.99, 200, 1000000]) {
      const s = writerStageAmounts(total)
      expect(Math.round((s.completed + s.groupSent + s.graduated) * 100)).toBe(Math.round(total * 100))
      expect(s.graduated).toBeGreaterThanOrEqual(0)
    }
    expect(writerStageAmounts(200)).toEqual({ completed: 100, groupSent: 40, graduated: 60 })
  })
  it('个人交付继续隔离，金额不再按交付限制', () => {
    const o = make({ draftAt: '2026-10-01T00:00:00Z' })
    expect(remaining(o, '写手工资', 'writer', admins)).toBe(200)
    expect(remaining(o, '写手工资', 'other', admins)).toBe(100)
    expect(writerInitialDone(o, 'writer')).toBe(true)
    expect(writerInitialDone(o)).toBe(false)
    expect(writerGroupDone(o, 'writer')).toBe(false)
    expect(dueItems(o, '写手工资', 'writer', admins).reduce((s, x) => s + x.amount, 0)).toBe(200)
  })
  it('交付阶段和草稿均不占用，剩余只扣已付', () => {
    const o = make({ settlements: [payment(60), payment(20, '草稿')] })
    expect(remaining(o, '写手工资', 'writer', admins)).toBe(140)
    o.writerProgress![0].groupSentAt = '2027-03-01T00:00:00Z'
    expect(remaining(o, '写手工资', 'writer', admins)).toBe(140)
    o.graduatedAt = '2027-06-01T00:00:00Z'
    expect(remaining(o, '写手工资', 'writer', admins)).toBe(140)
    expect(writerStageSummary(o, 'writer').map(s => s.amount)).toEqual([100, 40, 60])
  })
  it('整单应得不再拆为阶段，旧归期参数不限制发放', () => {
    const o = make({ graduatedAt: '2027-06-16T00:00:00Z' })
    o.writerProgress![0].groupSentAt = '2027-03-01T00:00:00Z'
    expect(dueItems(o, '写手工资', 'writer', admins, true)).toEqual([
      { amount: 200, period: null },
    ])
    expect(remaining(o, '写手工资', 'writer', admins, { period: '2026-10-15' })).toBe(200)
  })
  it('本期收入只累计本期已达成阶段，跨月阶段与旧单追加各算一次', () => {
    const o = make({ graduatedAt: '2027-06-16T00:00:00Z' })
    o.writerProgress![0].groupSentAt = '2027-03-01T00:00:00Z'
    const row: IncomeRow = { key: 'wage', id: o.id, no: o.no, title: o.title, date: o.orderDate, status: o.status, kind: '工资', amount: 200, pay: '分阶段发放', writerStages: writerStageSummary(o, 'writer') }
    const october = payday(o.writerProgress![0].completedAt)!
    const rows = [row, { ...row, key: 'legacy', writerStages: undefined, amount: 180, pay: october }, { ...row, key: 'extra', kind: '追加工资' as const, writerStages: undefined, amount: 20, pay: october }]
    expect(incomeSummary(incomeRowsInPayPeriod(rows, october)).amount).toBe(300)
    expect(incomeSummary(incomeRowsInPayPeriod(rows, payday(o.writerProgress![0].groupSentAt)!)).amount).toBe(40)
    expect(incomeSummary(incomeRowsInPayPeriod(rows, payday(o.graduatedAt!)!)).amount).toBe(60)
    row.writerStages![2].eligible = false
    expect(incomeRowsInPayPeriod([row], payday(o.graduatedAt!)!)).toEqual([])
  })
  it('毕业记录继续保留，空工资仍是未定', () => {
    const o = make({ graduatedAt: '2027-06-01T00:00:00Z' })
    expect(remaining(o, '写手工资', 'writer', admins)).toBe(200)
    o.assignees[0].pay = null
    expect(remaining(o, '写手工资', 'writer', admins)).toBe(0)
    expect(writerStageSummary(o, 'writer').every(s => s.amount === null)).toBe(true)
  })
  it('售后追加独立发放，不把追加的已付款误归到毕业尾款', () => {
    const o = make({ settlements: [payment(180)] })
    o.afterSales = [{ id: 'extra', writerId: 'writer', extra: 80, start: '2026-10-20T00:00:00Z', doneAt: '2026-10-21T00:00:00Z' }] as Order['afterSales']
    o.writerProgress![0].groupSentAt = '2027-03-01T00:00:00Z'
    expect(remaining(o, '写手工资', 'writer', admins)).toBe(100)
    expect(writerStageSummary(o, 'writer').every(s => !('paid' in s))).toBe(true)
    expect(writerStageSummary(o, 'writer')[2].eligible).toBe(false)
  })
  it('旧单沿用原结算，逐单切换不抹掉已付记录或捏造完成凭据', () => {
    const legacy = make({ writerPayPlan: 'full', draftAt: '2026-10-01T00:00:00Z', settlements: [payment(120)] })
    expect(remaining(legacy, '写手工资', 'writer', admins)).toBe(80)
    expect(writerStageSummary(legacy, 'writer')).toEqual([])
    const changed = { ...legacy, writerPayPlan: 'staged' as const, writerProgress: [] }
    expect(remaining(changed, '写手工资', 'writer', admins)).toBe(80)
    expect(writerStageSummary(changed, 'writer').every(s => !s.eligible)).toBe(true)
    expect(changed.settlements[0].amount).toBe(120)
    expect(writerStageSummary(changed, 'writer').every(s => !('paid' in s))).toBe(true)
  })
})
