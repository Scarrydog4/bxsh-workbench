import { afterAll, beforeAll, expect, it } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'

let boss: Client, sales: Client, writer: Client, other: Client, channelId: string
async function create(assigned = true) {
  const result = await boss.act('order.create', { title: '反馈验收订单', ownerId: 'u-acheng', channelId, basePrice: 1000, orderDate: '2026-10-22', dueDate: '2026-10-30', assignees: assigned ? [{ userId: 'u-xiao', pay: 200 }] : [] })
  expect(result.status).toBe(200)
  return result.body.id as string
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai'); other = await as('xiaoyang')
  channelId = (await boss.act('channel.create', { name: '反馈验收渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

it('重要标记可与加急共存，写手可见并收到一次提醒，取消重要保留加急', async () => {
  const id = await create()
  await sales.act('order.setUrgency', { id, urgent: true, note: '今晚交稿' })
  const input = { id, important: true, note: '同班同学订单，重点关注质量' }
  expect((await sales.act('order.setImportance', input)).status).toBe(200)
  expect((await sales.act('order.setImportance', input)).status).toBe(200)
  expect((await writer.boot()).body.orders.find((o: any) => o.id === id)).toMatchObject({ importance: { note: input.note, by: 'u-acheng' }, urgency: { note: '今晚交稿' }, dueDate: '2026-10-30' })
  expect((await sql`select count(*)::int as n from notifications where order_id=${id} and kind='重要订单'`)[0].n).toBe(1)
  expect((await writer.act('order.setImportance', { id, important: false })).status).toBe(403)
  expect((await other.act('order.setImportance', { id, important: false })).status).toBe(404)
  expect((await sales.act('order.setImportance', { id, important: false })).status).toBe(200)
  expect((await writer.boot()).body.orders.find((o: any) => o.id === id)).toMatchObject({ importance: null, urgency: { note: '今晚交稿' } })
  expect((await boss.activity(id)).body.filter((a: any) => a.field === '重要')).toHaveLength(2)
})

it('写手一次保存进度和交期，销售可见且收到改期提醒，工资与交付状态不变', async () => {
  const id = await create()
  const [before] = await sql`select * from orders where id=${id}`
  const wages = await sql`select * from order_writers where order_id=${id}`
  const progressNote = '开题已交，等待客户补充资料，协商延至周五'
  const result = await writer.act('order.update', { id, patch: { progressNote, dueDate: '2026-11-06' }, reason: progressNote })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  expect((await sql`select * from orders where id=${id}`)[0]).toEqual({ ...before, progress_note: progressNote, due_date: '2026-11-06', updated_at: expect.any(String) })
  expect(await sql`select * from order_writers where order_id=${id}`).toEqual(wages)
  expect((await sales.boot()).body.orders.find((o: any) => o.id === id)).toMatchObject({ progressNote, dueDate: '2026-11-06' })
  expect((await boss.activity(id)).body.filter((a: any) => ['当前进度', '截止日期'].includes(a.field))).toHaveLength(2)
  expect((await sql`select count(*)::int as n from notifications where order_id=${id} and kind='交期调整'`)[0].n).toBe(2)
})

it('只更新进度不改变交期，重复保存不重复留痕', async () => {
  const id = await create(), patch = { progressNote: '等待导师回复' }
  for (let i = 0; i < 2; i++) expect((await writer.act('order.update', { id, patch })).status).toBe(200)
  expect((await sql`select due_date, progress_note from orders where id=${id}`)[0]).toEqual({ due_date: '2026-10-30', progress_note: patch.progressNote })
  expect((await boss.activity(id)).body.filter((a: any) => a.field === '当前进度')).toHaveLength(1)
})

it('写手不能更新别人的进度或夹带改价，失败请求不写入', async () => {
  const id = await create(), unassigned = await create(false)
  expect((await writer.act('order.update', { id: unassigned, patch: { progressNote: '无权修改' } })).status).toBe(404)
  expect((await other.act('order.update', { id, patch: { progressNote: '无权修改' } })).status).toBe(404)
  expect((await writer.act('order.update', { id, patch: { progressNote: '开始处理', basePrice: 1 } })).status).toBe(403)
  expect((await sql`select progress_note from orders where id=${id}`)[0].progress_note).toBe('')
})
