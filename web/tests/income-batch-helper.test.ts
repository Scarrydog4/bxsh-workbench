import { expect, it } from 'vitest'
import type { IncomeRow } from '@/shared/income'
import { incomeBatchLines } from '@/shared/income-batch'
import { sumMoney } from '@/shared/calc'

const row = (id: string, patch: Partial<IncomeRow> = {}): IncomeRow => ({ key: `${id}:pay`, id, no: `DD${id}`, title: id, date: '2026-10-10', status: '已交付', kind: '工资', amount: 100, available: 75, pay: '10月15日', ...patch })

it('工资与追加工资按订单只选一次，发放金额使用可发余额而非约定工资', () => {
  const lines = incomeBatchLines([row('a'), row('a', { key: 'a:extra', kind: '追加工资', amount: 25 }), row('b', { amount: 900, available: 200 })], '写手工资')
  expect(lines).toEqual([{ orderId: 'a', no: 'DDa', title: 'a', amount: 75 }, { orderId: 'b', no: 'DDb', title: 'b', amount: 200 }])
  expect(sumMoney(lines.map(line => line.amount))).toBe(275)
})

it('全选排除工资未定、退单、未交付可发为零、无金额、非有限及负余额', () => {
  const rows = [row('pending', { amount: null }), row('return', { status: '退单' }), row('draft', { pay: '未交初稿', available: 0 }), row('missing', { available: undefined }), row('nan', { available: NaN }), row('infinite', { available: Infinity }), row('negative', { available: -1 }), row('valid', { available: 0.01 })]
  expect(incomeBatchLines(rows, '写手工资').map(line => line.orderId)).toEqual(['valid'])
})

it('销售只选当前提成，不把历史已发提成或同单工资计进本批金额', () => {
  const rows = [row('a'), row('a', { key: 'a:comm', kind: '提成', available: 80 }), row('old', { kind: '已发提成', available: 200 }), row('boss', { kind: '订单收入', available: 1000 })]
  expect(incomeBatchLines(rows, '销售提成')).toEqual([{ orderId: 'a', no: 'DDa', title: 'a', amount: 80 }])
})
