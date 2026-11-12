import { describe, expect, it } from 'vitest'
import { buildReward } from '@/shared/rewards'
import type { OrderView } from '@/shared/types'

const order = (patch: Partial<OrderView>): OrderView => ({
  id: 'o1', no: 'A1', title: '测试单', orderDate: '2026-11-11', dueDate: null, ownerId: 'sales', creatorId: 'sales', channelId: 'c', type: '', status: '未交付',
  note: '', wechatGroup: '', draftAt: null, isSelf: true, assignees: [], payPending: false, attachments: [], afterSales: [], ...patch,
} as OrderView)
const sales = { id: 'sales', canWrite: false }
const writer = { id: 'w', canWrite: true }

describe('录单 / 交付 / 跟进的即时反馈', () => {
  it('销售录单：提成已定才带金额；写手工资没定或提成为 0 时不显示 0', () => {
    expect(buildReward({ kind: 'order', me: sales, order: order({ commission: 36 }) }).amount).toBe(36)
    expect(buildReward({ kind: 'order', me: sales, order: order({ commission: 12, payPending: true }) }).amount).toBeNull()
    expect(buildReward({ kind: 'order', me: sales, order: order({ commission: 0 }) }).amount).toBeNull()
    // 老板替阿城录单：提成是阿城的，不弹给老板
    expect(buildReward({ kind: 'order', me: { id: 'boss', canWrite: false }, order: order({ commission: 36 }) }).amount).toBeNull()
  })

  it('写手交付：显示本人这单工资；替别人点交付的管理员看不到别人的钱，也不收致谢', () => {
    const o = order({ assignees: [{ userId: 'w', pay: 120 }], myPay: 120 })
    expect(buildReward({ kind: 'deliver', me: writer, order: o })).toMatchObject({ amount: 120, thanks: '感谢你对这单的付出' })
    expect(buildReward({ kind: 'deliver', me: { id: 'boss', canWrite: true }, order: order({ assignees: [{ userId: 'w', pay: 120 }] }) })).toMatchObject({ amount: null, thanks: '' })
  })

  it('跟进：交付时只有追加工资才带金额；写手自己发起时致谢写给写手', () => {
    const o = order({ assignees: [{ userId: 'w', pay: 120 }] })
    expect(buildReward({ kind: 'followup-done', me: writer, order: o, followup: { writerId: 'w', extra: 30 } }).amount).toBe(30)
    expect(buildReward({ kind: 'followup-done', me: writer, order: o, followup: { writerId: 'w' } }).amount).toBeNull()
    const mine = buildReward({ kind: 'followup-new', me: writer, order: o, followup: { writerId: 'w' } })
    expect(mine).toMatchObject({ amount: null, thanks: '主动跟进这单，感谢你对订单的付出' })
    expect(buildReward({ kind: 'followup-new', me: sales, order: o, followup: { writerId: 'w' } }).thanks).toBe('感谢你一直把这单放在心上')
  })
})
