import { expect, it } from 'vitest'
import { allocationPolicyForDate, fixedAllocation, isFixedAllocation } from '@/shared/allocation'
import { calc } from '@/shared/calc'
import { writerStageAmounts } from '@/shared/writer-stages'
import type { Order } from '@/shared/types'

const fixture = (patch: Partial<Order> = {}): Order => ({
  id:'allocation', no:'DD1', title:'分成', orderDate:'2026-10-16', dueDate:null,
  ownerId:'sales', creatorId:'sales', channelId:'channel', channelNo:'', wechatGroup:'', draftAt:null,
  type:'', basePrice:1000, adjustments:[], assignees:[{userId:'writer',pay:200}],
  status:'未交付', note:'', commissionRate:.5, salesMode:'commission', allocationPolicy:'fixed_60_20_20_v1',
  payments:[], attachments:[], afterSales:[], settlements:[], req:{}, nodes:[], receivables:[], reviewFlag:null, deletedAt:null,
  ...patch,
})
const admins = new Set(['boss'])

it('新制度直接按总额分配，旧制仍按扣工资后的余额分成', () => {
  expect(calc(fixture(), admins)).toMatchObject({commission:200, writerTotal:200, bossIncome:600})
  expect(calc(fixture({allocationPolicy:'legacy'}), admins)).toMatchObject({commission:400, bossIncome:400})
  expect(calc(fixture({allocationPolicy:undefined}), admins)).toMatchObject({commission:400, bossIncome:400})
})
it('老板兼任销售或写手时，对应份额归老板，多写手不重复分配', () => {
  expect(calc(fixture({ownerId:'boss'}), admins)).toMatchObject({commission:0, bossIncome:800})
  expect(calc(fixture({assignees:[{userId:'boss',pay:200}]}), admins)).toMatchObject({commission:200, bossIncome:800})
  expect(calc(fixture({ownerId:'boss',assignees:[{userId:'boss',pay:200}]}), admins).bossIncome).toBe(1000)
  expect(calc(fixture({assignees:[{userId:'boss',pay:80},{userId:'writer',pay:120}]}), admins)).toMatchObject({writerTotal:200, externalWriterTotal:120, bossIncome:680})
})
it('底价模式保持原约定，账号提成和订单日期不改变已保存制度', () => {
  expect(calc(fixture({salesMode:'cost',assignees:[{userId:'writer',pay:80}]}), admins)).toMatchObject({commission:0, bossIncome:920})
  expect(isFixedAllocation(fixture({salesMode:'cost'}))).toBe(false)
  expect(calc(fixture({orderDate:'2026-10-01',commissionRate:.99}), admins).commission).toBe(200)
  expect(allocationPolicyForDate('2026-10-15')).toBe('legacy')
  expect(allocationPolicyForDate('2026-10-16')).toBe('fixed_60_20_20_v1')
})
it('人民币尾差不会让三方金额多于总额；工资发放仍独立分50/20/30', () => {
  for (const amount of [0, .01, .03, .05, 240, 999.99]) {
    const split = fixedAllocation(amount)
    expect(Math.round((split.boss + split.sales + split.writer) * 100)).toBe(Math.round(amount * 100))
  }
  expect(fixedAllocation(240)).toEqual({boss:144,sales:48,writer:48})
  expect(writerStageAmounts(fixedAllocation(1000).writer)).toEqual({completed:100,groupSent:40,graduated:60})
})
it('未派写手也保留20%的工资份额，不提前算入老板净收入', () => {
  expect(calc(fixture({assignees:[]}), admins)).toMatchObject({payPending:false,writerTotal:200,bossIncome:600})
})
