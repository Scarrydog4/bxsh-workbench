import { expect, it } from 'vitest'
import { buildPersonalIncomeReport, type PersonalOrderLabel, type PersonalPayout } from '@/shared/personal-income-report'
import { incomeReportSelection } from '@/shared/income-report'
import type { IncomeRow } from '@/shared/income'

const row = (patch: Partial<IncomeRow> = {}): IncomeRow => ({ key: 'o:comm', id: 'o', no: 'DD1', title: '本人的单', date: '2026-10-10', status: '未交付', kind: '提成', amount: 100, due: 100, paid: 20, left: 80, pay: '—', ...patch })
const labels: PersonalOrderLabel[] = [{ id: 'o', orderDate: '2026-10-10', channelId: 'c', channelName: '本人渠道', accessible: true, createdAt: '2026-10-10T02:00:00Z' }]
const payout = (patch: Partial<PersonalPayout> = {}): PersonalPayout => ({ id: 'p1', orderId: 'o', kind: '销售提成', amount: 20, at: '2026-10-12T03:00:00Z', ...patch })
const range = incomeReportSelection({ from: '2026-10-10', to: '2026-10-12' })

it('应得按接单日期，实际领取按发放日期；客户货款不进入个人报表', () => {
  const report = buildPersonalIncomeReport([row()], [payout()], labels, range)
  expect(report.summary).toMatchObject({ earned: 100, commission: 100, wages: 0, paid: 20, remaining: 80, orderCount: 1 })
  expect(report.series.map(day => [day.earned, day.paid])).toEqual([[100, 0], [0, 0], [0, 20]])
  const cashDay = buildPersonalIncomeReport([row()], [payout()], labels, incomeReportSelection({ from: '2026-10-12', to: '2026-10-12' }))
  expect(cashDay.summary).toMatchObject({ earned: 0, paid: 20, remaining: 0, orderCount: 0 })
  expect(cashDay.orders[0]).toMatchObject({ included: false, paid: 20, remaining: 80 })
  expect(JSON.stringify(report)).not.toMatch(/bossIncome|commissionRate|writerRate|basePrice|externalWriterCost|profit/)
})

it('兼写手时只加本人工资，追加工资不重复累计整单待领或订单数', () => {
  const report = buildPersonalIncomeReport([row(), row({ key: 'o:pay', kind: '工资', amount: 30, due: 40, left: 25 }), row({ key: 'o:as', kind: '追加工资', amount: 10, due: 40, left: 25, date: '2026-10-11' })], [], labels, range)
  expect(report.summary).toMatchObject({ earned: 140, commission: 100, wages: 40, remaining: 105, orderCount: 1 })
  expect(report.orders).toHaveLength(2)
  expect(report.series.reduce((total, day) => total + day.remaining, 0)).toBe(report.summary.remaining)
  expect(report.series.find(day => day.key === '2026-10-10')?.remaining).toBe(105)
})

it('多次发放逐笔累加；没有日期的历史实发独立显示，不伪装今天', () => {
  const report = buildPersonalIncomeReport([row()], [payout(), payout({ id: 'p2', amount: 13 }), payout({ id: 'old', at: null, amount: 7 })], labels, range)
  expect(report.summary.paid).toBe(33)
  expect(report.orders[0].paid).toBe(33)
  expect(report.undatedPaid).toBe(7)
  expect(report.undatedCount).toBe(1)
})

it('金额未定保留提示，不能当成零元工资或泄漏推算比例', () => {
  const report = buildPersonalIncomeReport([row({ amount: null, due: null, left: 0 })], [], labels, range)
  expect(report.summary).toMatchObject({ earned: 0, pendingCount: 1 })
  expect(report.orders[0].earned).toBeNull()
})

it('周、月和离散日期汇总保留边界，不把未选择的日期计入', () => {
  const rows = [row(), row({ key: 'other', id: 'other', date: '2026-10-11', amount: 900 })]
  const report = buildPersonalIncomeReport(rows, [payout()], labels, incomeReportSelection({ dates: ['2026-10-10', '2026-10-12'], granularity: 'week' }))
  expect(report.summary.earned).toBe(100)
  expect(report.series).toHaveLength(2)
  const month = buildPersonalIncomeReport([row()], [payout()], labels, { ...range, granularity: 'month' })
  expect(month.series[0]).toMatchObject({ key: '2026-10', start: '2026-10-01', end: '2026-10-31', earned: 100, paid: 20 })
})

it('小时数据采用真实录入和实际发放时间，补录不冒充发生小时', () => {
  const selection = incomeReportSelection({ from: '2026-10-10', to: '2026-10-10' })
  const report = buildPersonalIncomeReport([row()], [payout({ at: '2026-10-10T03:00:00Z' })], labels, selection)
  expect(report.hourly!.hours[10].earned).toBe(100)
  expect(report.hourly!.hours[11].paid).toBe(20)
  const databaseTime = buildPersonalIncomeReport([row()], [payout({at:'2026-10-10 03:00:00+00'})], labels, selection)
  expect(databaseTime.hourly!.hours[11].paid).toBe(20)
  const unknown = buildPersonalIncomeReport([row()], [], [{ ...labels[0], createdAt: '2026-10-12T03:00:00Z' }], selection)
  expect(unknown.hourly!.unknown.earned).toBe(100)
  expect(unknown.hourly!.hours.every(hour => hour.earned === 0)).toBe(true)
})

it('只补付款日期时进入对应日汇总，具体小时仍为未记录', () => {
  const selection = incomeReportSelection({from:'2026-10-10',to:'2026-10-10'})
  const report = buildPersonalIncomeReport([row()], [payout({at:'2026-10-10'})], labels, selection)
  expect(report.summary.paid).toBe(20)
  expect(report.undatedCount).toBe(0)
  expect(report.hourly!.unknown.paid).toBe(20)
  expect(report.hourly!.hours.every(hour => hour.paid === 0)).toBe(true)
})

it('转交与删除后只保留本人历史领取，不恢复订单或渠道访问', () => {
  const report = buildPersonalIncomeReport([row({ kind: '已发提成', amount: 20 })], [payout()], [{ ...labels[0], accessible: false, channelId: '', channelName: '历史订单' }], range)
  expect(report.summary).toMatchObject({ earned: 0, paid: 20 })
  expect(report.orders[0]).toMatchObject({ accessible: false, channelName: '历史订单' })
  expect(report.options.channels).toEqual([{ id: '__none__', name: '历史订单', avatar: undefined }])
  expect(buildPersonalIncomeReport([row()], [payout()], labels, { ...range, channelId: 'other-channel' }).orders).toEqual([])
})

it('十一月首周只统计十一月一日，排除同一自然周内十月的应得和实发', () => {
  const selection=incomeReportSelection({from:'2026-11-01',to:'2026-11-05',granularity:'week'})
  const report=buildPersonalIncomeReport([
    row({id:'oct',date:'2026-10-31',amount:888}),
    row({id:'nov',date:'2026-11-01',amount:120}),
  ],[payout({orderId:'oct',at:'2026-10-31T09:00:00+08:00'})],[],selection)
  expect(report.series[0]).toMatchObject({key:'2026-10-26',earned:120,paid:0,orderCount:1})
  expect(report.orders.map(o=>o.id)).toEqual(['nov'])
})

it('订单、人员、渠道和周段只解释已抵减的未记日期款；超发不重复抵减', () => {
  const base=row({amount:100, due:140, paid:170, over:30,left:0})
  const second=row({key:'extra',date:'2026-10-11',amount:40, due:140,paid:170,over:30,left:0})
  const payments=[payout({amount:100,at:null}),payout({id:'dated',amount:70})]
  const r=buildPersonalIncomeReport([base,second],payments,labels,range)
  expect(r.undatedPaid).toBe(100)
  expect([r.orders[0],r.summary,r.channels[0],r.series[0]].map(x=>x.undatedDeducted)).toEqual([70,70,70,70])
  expect(r.series[1].undatedDeducted).toBeUndefined()
  expect(r.summary).toMatchObject({remaining:0,paid:70,earned:140})
  expect(buildPersonalIncomeReport([row({due:null})],payments,labels,range).summary.undatedDeducted).toBeUndefined()
  expect(buildPersonalIncomeReport([base],payments.slice(0,1),labels,range).summary.undatedDeducted).toBeUndefined()
})
