import type { AllocationPolicy } from './allocation'
import { sumMoney, type CustomerStage } from './calc'
import { businessDate, payday } from './format'
import type { SettleBatch } from './types'
import type { WriterPayStage } from './writer-stages'
export type { WriterPayStage } from './writer-stages'

export interface IncomeRow {
  /** 新收入接口统一提供；可选类型兼容尚未切换的客户端缓存。追加行共享整单数值，不重复累加。 */
  due?: number | null
  paid?: number
  left?: number
  over?: number
  custStage?: CustomerStage
  depositAt?: string | null
  paidUpAt?: string | null
  /** 仅 settle.manage 可见的建议值，不是发放上限。 */
  suggest?: number
  allocationPolicy?: AllocationPolicy
  salesMode?: 'commission' | 'cost'
  writerStages?: WriterPayStage[]
  key: string
  id: string
  no: string
  title: string
  date: string
  status: string
  kind: '工资' | '追加工资' | '已发工资' | '提成' | '已发提成' | '订单收入'
  amount: number | null
  pay: string
  settle?: '未结' | '部分已结' | '已结'
  settlement?: { key: string; paid: number; unpaid: number }
  /** 兼容字段：剩余应得，不是发放上限。 */
  available?: number
  /** 兼容字段：草稿不再占用，恒为 0。 */
  reserved?: number
  /** 兼容字段：交付不再影响发放，恒为 0。 */
  pending?: number
}

/** 原工资与追加工资合为一单，整单已结金额只取一次。 */
export function writerIncomeOrders(rows: IncomeRow[]) {
  const groups = new Map<string, IncomeRow[]>()
  for (const row of rows) if (row.kind === '工资' || row.kind === '追加工资' || row.kind === '已发工资') groups.set(row.id, [...(groups.get(row.id) ?? []), row])
  return [...groups.values()].map(list => {
    const base = list.find(r => r.kind === '工资') ?? list[0]
    return { ...base, key: base.id, amount: list.some(r => r.amount === null) ? null : sumMoney(list.map(r => r.amount!)), knownAmount: sumMoney(list.map(r => r.amount ?? 0)), extra: sumMoney(list.filter(r => r.kind === '追加工资').map(r => r.amount ?? 0)) }
  })
}

/** 历史同步没有确认日期，不冒充今天的结算。撤销记录也不累计。 */
export function paidOnDay(batches: SettleBatch[], payeeId: string, date: string) {
  return batches.filter(b => b.kind === '写手工资' && b.payeeId === payeeId && b.status === '已确认' && b.confirmedAt && businessDate(b.confirmedAt) === date)
}

export function incomeSummary(rows: IncomeRow[], month?: string) {
  const selected = month ? rows.filter(r => r.date.startsWith(`${month}-`)) : rows
  return { amount: sumMoney(selected.map(r => r.amount ?? 0)), pending: selected.filter(r => r.amount === null).length }
}

/** 本期应得只包含本期达成的阶段，未完成阶段不提前计入。 */
export function incomeRowsInPayPeriod(rows: IncomeRow[], period: string): IncomeRow[] {
  return rows.flatMap(row => {
    if (!row.writerStages?.length) return row.pay === period ? [row] : []
    const stages = row.writerStages.filter(stage => stage.eligible && stage.completedAt && payday(stage.completedAt) === period)
    if (!stages.length) return []
    return [{ ...row, pay: period, amount: stages.some(stage => stage.amount === null) ? null : sumMoney(stages.map(stage => stage.amount!)) }]
  })
}

export function incomeSettlementSummary(rows: IncomeRow[]) {
  const orders = [...new Map(rows.flatMap(r => r.settlement ? [[r.settlement.key, r.settlement] as const] : [])).values()]
  return { paid: sumMoney(orders.map(x => x.paid)), unpaid: sumMoney(orders.map(x => x.unpaid)) }
}

export type PayKind = '写手工资' | '销售提成'
export interface PayLine {
  key: string; id: string; no: string; title: string; date: string; status: string; kind: PayKind
  due: number | null; paid: number; left: number; over: number; suggest?: number; custStage?: CustomerStage
}

/** 一单一人一种收入一行；工资与追加工资共用整单数值，只取一次。 */
export function payLedger(rows: IncomeRow[]): PayLine[] {
  const out = new Map<string, PayLine>()
  for (const r of rows) {
    if (r.kind === '订单收入') continue
    const kind: PayKind = r.kind.includes('提成') ? '销售提成' : '写手工资'
    const key = `${r.id}:${kind}`
    if (out.has(key) && r.kind !== '工资') continue
    out.set(key, { key, id: r.id, no: r.no, title: r.title, date: r.date, status: r.status, kind, due: r.due === undefined ? r.amount : r.due, paid: r.paid ?? 0, left: r.left ?? 0, over: r.over ?? 0, suggest: r.suggest, custStage: r.custStage })
  }
  return [...out.values()].sort((a, b) => b.no.localeCompare(a.no))
}
