import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { GET as bootstrap } from '@/app/api/bootstrap/route'
import { db, sql } from '@/server/db'
import { settleBatches, settlements } from '@/server/schema'
import type { SettleBatch } from '@/shared/types'
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client
const read = async (client: Client) => {
  const response = await bootstrap(new Request('http://test.local/api/bootstrap', { headers: { cookie: client.cookie } }), { params: Promise.resolve({}) })
  expect(response.status).toBe(200)
  return (await response.json()).batches as SettleBatch[]
}
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng')
  const channelId = (await boss.act('channel.create', { name: '发放记录验收', ownerId: 'u-acheng' })).body.id
  const ids: string[] = []
  for (const title of ['历史第一单', '历史第二单']) {
    const result = await boss.act('order.create', { title, orderDate: '2026-10-09', dueDate: null, channelId, ownerId: 'u-acheng', basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 300 }] })
    expect(result.status).toBe(200); ids.push(result.body.id)
  }
  for (const [id, kind, payeeId] of [['record-single', '写手工资', 'u-xiao'], ['record-batch', '写手工资', 'u-xiao'], ['record-sales', '销售提成', 'u-acheng']] as const) {
    await db.insert(settleBatches).values({ id, no: id, kind, payeeId, status: '已确认', note: `${id} 共享备注`, shots: [`/api/settle/${id}/images/${'a'.repeat(64)}`], createdBy: 'u-boss', createdAt: '2026-10-11T03:00:00Z', confirmedBy: 'u-boss', confirmedAt: '2026-10-09T04:00:00Z' })
    for (const [index, orderId] of (id === 'record-batch' ? ids : [ids[0]]).entries()) {
      await db.insert(settlements).values({ id: `${id}-${index}`, orderId, kind, payeeId, amount: 100 + index * 50, status: '已确认', note: `第${index + 1}单备注`, batchId: id })
    }
  }
})
afterAll(closeDb)
it('按实际批次返回同日单笔和批量记录，并保留完整金额、订单、备注、截图及经办人', async () => {
  const records = await read(boss)
  expect(records).toHaveLength(3)
  const batch = records.find(b => b.id === 'record-batch')!
  expect(batch).toMatchObject({ total: 250, payeeId: 'u-xiao', confirmedBy: 'u-boss', note: 'record-batch 共享备注' })
  expect(batch.lines.map(l => l.amount)).toEqual([100, 150])
  expect(batch.lines.map(l => l.title)).toEqual(['历史第一单', '历史第二单'])
  expect(batch.lines.map(l => l.note)).toEqual(['第1单备注', '第2单备注'])
  expect(batch.shots).toEqual([`/api/settle/record-batch/images/${'a'.repeat(64)}`])
  expect(records.find(b => b.id === 'record-single')?.total).toBe(100)
})
it('写手仅返回自己的两次发放，不能看到同单销售的提成与凭证', async () => {
  const records = await read(writer)
  expect(records.map(b => b.id).sort()).toEqual(['record-batch', 'record-single'])
  expect(records.every(b => b.payeeId === 'u-xiao' && b.kind === '写手工资')).toBe(true)
})
it('销售只返回本人提成，不能看到自己订单里的写手发放详情', async () => {
  const records = await read(sales)
  expect(records.map(b => b.id)).toEqual(['record-sales'])
  expect(records[0].payeeId).toBe('u-acheng')
})

it('无批次历史实发逐条可见，转交后仍归原收款人，日期不编造、读接口不改账', async () => {
  const orders = (await boss.boot()).body.orders
  const active = orders.find((o: any) => o.title === '历史第一单').id
  const transferred = orders.find((o: any) => o.title === '历史第二单').id
  await db.insert(settlements).values([
    { id: 'history-sales-known', orderId: active, kind: '销售提成', payeeId: 'u-acheng', amount: 12.5, status: '已确认', migrated: true, note: '10.9付12.5', confirmedAt: '2026-10-09T04:00:00Z' },
    { id: 'history-sales-unknown', orderId: transferred, kind: '销售提成', payeeId: 'u-acheng', amount: 33, status: '已确认', migrated: true, note: '飞书迁移' },
    { id: 'history-writer', orderId: active, kind: '写手工资', payeeId: 'u-xiao', amount: 80, status: '已确认' },
    { id: 'history-draft', orderId: active, kind: '销售提成', payeeId: 'u-acheng', amount: 7, status: '草稿' },
    { id: 'history-void', orderId: active, kind: '销售提成', payeeId: 'u-acheng', amount: 5, status: '已作废' },
  ])
  await sql`update orders set owner_id='u-boss' where id=${transferred}`
  const before = await sql`select * from settlements order by id`
  const salesRecords = await read(sales)
  expect(salesRecords.filter(b => b.historical).map(b => b.id).sort()).toEqual(['history:history-sales-known', 'history:history-sales-unknown', 'history:history-void'])
  const dated = salesRecords.find(b => b.id === 'history:history-sales-known')!
  expect(dated).toMatchObject({ historical: true, total: 12.5, note: '10.9付12.5', lines: [{ orderId: active, amount: 12.5 }] })
  expect(new Date(dated.confirmedAt!).toISOString()).toBe('2026-10-09T04:00:00.000Z')
  expect(salesRecords.find(b => b.id === 'history:history-sales-unknown')).toMatchObject({ total: 33, confirmedAt: null, createdBy: '', confirmedBy: null })
  expect((await sales.boot()).body.orders.some((o: any) => o.id === transferred)).toBe(false)
  expect((await read(writer)).filter(b => b.historical).map(b => b.id)).toEqual(['history:history-writer'])
  const bossRecords = await read(boss)
  expect(bossRecords.filter(b => b.historical)).toHaveLength(4)
  expect(bossRecords.filter(b => !b.historical)).toHaveLength(3)
  expect(await sql`select * from settlements order by id`).toEqual(before)
})

it('取消金额查看权限后，批次和无批次历史记录都不泄露', async () => {
  const role = await boss.act('role.save', { name: '不看提成', perms: ['order.view', 'income.view'], rowScope: 'owned', fields: { sales: true, writerPay: 'none', commission: 'none', profit: false, channelNo: false } })
  expect(role.status).toBe(200)
  expect((await boss.act('user.update', { id: 'u-acheng', patch: { roleId: role.body.id } })).status).toBe(200)
  expect(await read(await as('acheng'))).toEqual([])
})
