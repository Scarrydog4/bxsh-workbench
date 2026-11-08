import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, resetDb, type Client } from './helpers'
import { businessDate } from '@/shared/format'
import { paidOnDay, writerIncomeOrders } from '@/shared/income'
import type { SettleBatch } from '@/shared/types'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client, order: string
const input = (amount: number) => ({ requestId: randomUUID(), orderId: order, payeeId: 'u-xiao', amount })
const shot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-15T06:00:00Z')
  await resetDb(); boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng')
  const channelId = (await boss.act('channel.create', { name: '逐单结算验证', ownerId: 'u-acheng' })).body.id
  order = (await boss.act('order.create', { title: '工资 300 部分结算', orderDate: '2026-10-09', dueDate: '2026-10-12', channelId, ownerId: 'u-acheng', basePrice: 600, assignees: [{ userId: 'u-xiao', pay: 300 }] })).body.id
})
afterAll(async () => { await closeDb(); vi.useRealTimers() })

it('未交付也可由老板发放，销售和写手不能给自己发钱', async () => {
  expect((await boss.act('settle.pay', input(.01))).status).toBe(200)
  expect((await writer.act('settle.pay', input(100))).status).toBe(403)
  expect((await sales.act('settle.pay', input(100))).status).toBe(403)
  const b = (await boss.boot()).body
  expect(b.batches).toHaveLength(1)
  expect(b.income['u-xiao'][0].available).toBe(299.99)
  expect((await boss.act('settle.void', { id: b.batches[0].id, reason: '测试重置' })).status).toBe(200)
})

it('部分结算原子保存日期、自动备注、文本和截图；并发重试只记一笔', async () => {
  const payload = { ...input(100), note: '先结100，余款后补', shots: [shot] }
  const responses = await Promise.all([boss.act('settle.pay', payload), boss.act('settle.pay', payload)])
  expect(responses.map(r => r.status)).toEqual([200, 200]); expect(responses[0].body.id).toBe(responses[1].body.id)
  const b = (await writer.boot()).body
  expect(b.batches.filter((b: any) => b.status === '已确认')).toHaveLength(1)
  const batch = b.batches.find((b: any) => b.status === '已确认')
  expect(batch).toMatchObject({ status: '已确认', confirmedBy: 'u-boss', note: payload.note, total: 100 })
  expect(batch.shots).toHaveLength(1)
  expect(batch.lines[0].note).toBe(`${businessDate(new Date())} 结算 ¥100 · 老板`)
  expect(businessDate(batch.confirmedAt)).toBe(businessDate(new Date()))
  expect(b.income['u-xiao'][0]).toMatchObject({ available: 200, settlement: { paid: 100, unpaid: 200 } })
  expect((await boss.act('settle.pay', { ...payload, amount: 200 })).status).toBe(400)
  expect((await boss.act('settle.pay', input(200.001))).status).toBe(400)
})

it('一单多笔自动累计，可超发且余额为零；撤销后当日金额回退', async () => {
  const r = await boss.act('settle.pay', input(200)); expect(r.status).toBe(200)
  const over = await boss.act('settle.pay', input(1)); expect(over.status).toBe(200)
  let b = (await writer.boot()).body
  expect(paidOnDay(b.batches, 'u-xiao', businessDate(new Date())).reduce((s, x) => s + x.total, 0)).toBe(301)
  expect(b.income['u-xiao'][0]).toMatchObject({ settle: '已结', available: 0, settlement: { paid: 301, unpaid: 0 } })
  expect((await boss.act('settle.void', { id: over.body.id, reason: '验证撤销超发' })).status).toBe(200)
  expect((await boss.act('settle.void', { id: r.body.id, reason: '验证撤销' })).status).toBe(200)
  b = (await writer.boot()).body
  expect(paidOnDay(b.batches, 'u-xiao', businessDate(new Date())).reduce((s, x) => s + x.total, 0)).toBe(100)
})

it('原工资和未交付追加工资合并一行，已结不翻倍，追加可直接发放', async () => {
  expect((await boss.act('aftersale.create', { orderId: order, reason: '新增需求', req: ['补图'], writerId: 'u-xiao', extra: 80 })).status).toBe(200)
  const b = (await writer.boot()).body
  expect(b.income['u-xiao']).toHaveLength(2)
  const rows = writerIncomeOrders(b.income['u-xiao'])
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ amount: 380, extra: 80, due: 380, available: 280, settlement: { paid: 100, unpaid: 280 } })
  expect((await boss.act('settle.pay', input(280))).status).toBe(200)
})

it('按北京时间统计，不把无日期历史迁移或草稿混入今天', () => {
  const base = { kind: '写手工资', payeeId: 'u-xiao', status: '已确认', total: 50 } as SettleBatch
  const rows = [
    { ...base, id: 'day-before', confirmedAt: '2026-10-08T15:59:59Z' },
    { ...base, id: 'day-start', confirmedAt: '2026-10-08T16:00:00Z' },
    { ...base, id: 'day-end', confirmedAt: '2026-10-09T15:59:59Z' },
    { ...base, id: 'day-after', confirmedAt: '2026-10-09T16:00:00Z' },
    { ...base, id: 'import', confirmedAt: null },
    { ...base, id: 'other', payeeId: 'u-other', confirmedAt: '2026-10-09T00:00:00Z' },
    { ...base, id: 'draft', status: '草稿', confirmedAt: '2026-10-09T00:00:00Z' },
  ] as SettleBatch[]
  expect(paidOnDay(rows, 'u-xiao', '2026-10-09').map(x => x.id)).toEqual(['day-start', 'day-end'])
})
