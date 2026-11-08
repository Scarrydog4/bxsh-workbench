import { describe, expect, it } from 'vitest'
import { calc, customerStage } from '@/shared/calc'
import { project } from '@/shared/perm'
import { dueItems, incomeAmounts, remaining, settleState } from '@/shared/settle'
import type { Order, Payment, Role, Settlement, User } from '@/shared/types'

const admins = new Set(['boss'])
const make = (patch: Partial<Order> = {}): Order => ({
  id: 'o', no: 'DD1', title: '客户收款两期', orderDate: '2026-10-16', dueDate: null, ownerId: 'sales', creatorId: 'boss', channelId: 'c', channelNo: '', wechatGroup: '', draftAt: null,
  type: '', basePrice: 1000, adjustments: [], assignees: [{ userId: 'writer', pay: 200 }, { userId: 'other', pay: 100 }], status: '未交付', note: '', commissionRate: .5,
  payments: [], attachments: [], afterSales: [], settlements: [], req: {}, nodes: [], receivables: [], reviewFlag: null, deletedAt: null,
  writerPayPlan: 'completed_balance_50_50', writerProgress: [], ...patch,
})
const receipt = (amount: number, date = '2026-10-19', tag = '尾款'): Payment => ({ id: `${date}:${amount}`, amount, date, tag, note: '', by: 'boss' })
const payment = (amount: number, status: Settlement['status'] = '已确认'): Settlement => ({ id: `paid:${amount}`, kind: '写手工资', payeeId: 'writer', amount, status, batchId: null, migrated: false, received: false, note: '' })

describe('客户收款灯与自主发放建议', () => {
  it('未收、定金、收齐、退款、撤销按有效净收款转换，首笔有效日期正确', () => {
    const o = make()
    expect(customerStage(o)).toEqual({ custStage: 'none', depositAt: null, paidUpAt: null })
    o.payments = [receipt(400, '2026-10-17', '定金')]
    expect(customerStage(o)).toEqual({ custStage: 'deposit', depositAt: '2026-10-17', paidUpAt: null })
    expect(incomeAmounts(o, '写手工资', 'writer', admins).suggest).toBe(80)
    o.payments.push(receipt(600))
    expect(customerStage(o)).toMatchObject({ custStage: 'paidUp', paidUpAt: '2026-10-19T12:00:00+08:00' })
    o.payments.push(receipt(100, '2026-10-20', '退款'))
    expect(customerStage(o)).toMatchObject({ custStage: 'deposit', paidUpAt: null })
    o.payments[0].revoked = { at: '2026-10-21', by: 'boss', reason: '错账' }
    expect(customerStage(o).depositAt).toBe('2026-10-19')
    o.payments.push(receipt(600, '2026-10-21', '退款'))
    expect(customerStage(o).custStage).toBe('none')
  })
  it('多写手和追加工资各算本人，提成使用同一比例；草稿不占额度', () => {
    const o = make({ payments: [receipt(400)], settlements: [payment(10), payment(90, '草稿')] })
    o.afterSales = [{ writerId: 'writer', extra: 80, start: '2026-10-20', doneAt: null }] as Order['afterSales']
    expect(incomeAmounts(o, '写手工资', 'writer', admins)).toMatchObject({ due: 280, paid: 10, left: 270, over: 0, suggest: 102 })
    expect(incomeAmounts(o, '写手工资', 'other', admins)).toMatchObject({ due: 100, suggest: 40 })
    expect(incomeAmounts(o, '销售提成', 'sales', admins)).toMatchObject({ due: 310, suggest: 124 })
    expect(dueItems(o, '写手工资', 'writer', admins, true)).toEqual(dueItems(o, '写手工资', 'writer', admins))
    o.payments.push(receipt(600))
    expect(incomeAmounts(o, '写手工资', 'writer', admins).suggest).toBe(270)
  })
  it.each(['full', 'staged', 'completed_balance_50_50'] as const)('%s 交付计划不决定金额，legacy 应得保留原约定', writerPayPlan => {
    const o = make({ writerPayPlan, allocationPolicy: 'legacy', payments: [receipt(400)] })
    expect(remaining(o, '写手工资', 'writer', admins)).toBe(200)
    expect(remaining(o, '写手工资', 'other', admins)).toBe(100)
    expect(calc(o, admins).commission).toBe(350)
    expect(incomeAmounts(o, '销售提成', 'sales', admins).suggest).toBe(140)
  })
  it('按分向下取整，零销售额无建议；工资未定保留 null，超发不产生负余额', () => {
    const o = make({ basePrice: 3, payments: [receipt(1)], assignees: [{ userId: 'writer', pay: 1 }] })
    expect(incomeAmounts(o, '写手工资', 'writer', admins).suggest).toBe(.33)
    o.basePrice = 0
    expect(incomeAmounts(o, '写手工资', 'writer', admins).suggest).toBe(0)
    o.assignees[0].pay = null
    expect(incomeAmounts(o, '写手工资', 'writer', admins).due).toBeNull()
    o.assignees[0].pay = 1
    o.settlements = [payment(1.01)]
    expect(incomeAmounts(o, '写手工资', 'writer', admins)).toMatchObject({ due: 1, paid: 1.01, left: 0, over: .01, suggest: 0 })
    expect(settleState(o, '写手工资', 'writer', admins)).toBe('已结')
  })
  it('写手订单只返回收款灯和日期，隐藏制度及客户金额', () => {
    const o = make({ allocationPolicy: 'fixed_60_20_20_v1', payments: [receipt(1000)] })
    const role = { locked: false, fields: { sales: false, writerPay: 'own', commission: 'none', profit: false, channelNo: false }, perms: ['order.view'], rowScope: 'assigned' } as Role
    const view = project(o, { id: 'writer' } as User, role, admins)
    expect(view.custStage).toBe('paidUp')
    for (const key of ['sales', 'received', 'payments', 'basePrice', 'unpaid', 'payStatus', 'allocationPolicy', 'writerPayPlan', 'commissionRate', 'writerStages']) expect(view).not.toHaveProperty(key)
  })
  it('加价、减免和重复收款使用当前仍收齐的日期', () => {
    const o = make({ payments: [receipt(1000)] })
    const at = customerStage(o).paidUpAt
    o.payments.push(receipt(10, '2026-10-20'))
    expect(customerStage(o).paidUpAt).toBe(at)
    o.adjustments.push({ id: 'a', amount: 100, at: '2026-10-21T01:00:00Z', by: 'boss', reason: '追加' })
    expect(customerStage(o).custStage).toBe('deposit')
    o.adjustments.push({ id: 'b', amount: -90, at: '2026-10-22T01:00:00Z', by: 'boss', reason: '减免' })
    expect(customerStage(o).paidUpAt).toBe('2026-10-22T01:00:00Z')
  })
})
