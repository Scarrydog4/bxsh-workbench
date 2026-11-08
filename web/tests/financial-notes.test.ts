import { beforeAll, afterAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { as, resetDb, closeDb, type Client } from './helpers'
import { sql } from '@/server/db'
let boss: Client, sales: Client, other: Client, writer: Client, channelId: string, proof: string
const day = '2026-10-09'
async function order() {
  const r = await sales.act('order.create', { title: '金额备注验收', channelId, ownerId: 'u-acheng', basePrice: 500, orderDate: day, dueDate: null })
  expect(r.status).toBe(200)
  return r.body.id as string
}
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); other = await as('xiaoyang'); writer = await as('xiaosenkai')
  channelId = (await boss.act('channel.create', { name: '金额备注测试渠道', ownerId: 'u-acheng' })).body.id
  proof = 'data:image/png;base64,' + (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer()).toString('base64')
})
afterAll(closeDb)
it('销售空备注不能改原价；文字备注和改前改后金额一起保留', async () => {
  const id = await order()
  expect((await sales.act('order.update', { id, patch: { basePrice: 600 } })).status).toBe(400)
  expect((await sales.act('order.update', { id, patch: { basePrice: 600 }, reason: '   ' })).status).toBe(400)
  expect((await sql`select base_price::float as base_price from orders where id=${id}`)[0].base_price).toBe(500)
  expect((await sales.act('order.update', { id, patch: { basePrice: 600 }, reason: '渠道同意加急费' })).status).toBe(200)
  const entry = (await sales.activity(id)).body.find((a: any) => a.field === '原价')
  expect(entry).toMatchObject({ actorId: 'u-acheng', note: '渠道同意加急费', from: '¥500', to: '¥600' })
  expect((await writer.activity(id)).body.some((a: any) => a.note === '渠道同意加急费')).toBe(false)
})
it('截图可以作为备注；原图只允许本人销售和管理员访问', async () => {
  const id = await order()
  expect((await sales.act('order.update', { id, patch: { basePrice: 650 }, proof })).status).toBe(200)
  const entry = (await sales.activity(id)).body.find((a: any) => a.proof)
  expect(entry.proof).toMatch(/^\/api\/files\//)
  const fileId = entry.proof.split('/')[3].split('?')[0]
  expect((await sales.file(fileId)).status).toBe(200); expect((await boss.file(fileId)).status).toBe(200)
  expect((await writer.file(fileId)).status).toBe(404); expect((await other.file(fileId)).status).toBe(404)
  expect((await sql`select count(*)::int as n from attachments where order_id=${id} and purpose='file'`)[0].n).toBe(0)
})
it('追加减免缺备注拒绝，图片备注及金额均可查询', async () => {
  const id = await order()
  expect((await sales.act('order.addAdjustment', { id, amount: -50, reason: '' })).status).toBe(400)
  expect((await sales.act('order.addAdjustment', { id, amount: -50, proof })).status).toBe(200)
  expect((await sql`select amount::float as amount,reason from adjustments where order_id=${id}`)[0]).toMatchObject({ amount: -50, reason: '见截图' })
  expect((await sales.activity(id)).body.find((a: any) => a.action === '减免').proof).toMatch(/^\/api\/files\//)
})
it('收款必须备注或截图；带图重试不重复记款或备注', async () => {
  const id = await order(), payload = { id, amount: 100, date: day, tag: '定金', requestId: randomUUID() }
  expect((await sales.act('order.addPayment', payload)).status).toBe(400)
  expect((await sales.act('order.addPayment', { ...payload, proof })).status).toBe(200)
  expect((await sales.act('order.addPayment', { ...payload, proof })).status).toBe(200)
  expect((await sql`select count(*)::int as n from payments where order_id=${id}`)[0].n).toBe(1)
  expect((await sales.activity(id)).body.filter((a: any) => a.action === '记收款')).toHaveLength(1)
  expect((await sales.act('order.addPayment', { ...payload, requestId: randomUUID(), tag: '尾款', note: '微信收到尾款' })).status).toBe(200)
})
it('不扩大归属及工资权限，管理员保留现有快捷操作', async () => {
  const id = await order()
  expect((await other.act('order.update', { id, patch: { basePrice: 1 }, reason: '越权' })).status).toBe(404)
  expect((await writer.act('order.update', { id, patch: { basePrice: 1 }, reason: '越权' })).status).toBe(403)
  expect((await sales.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 1 }] })).status).toBe(403)
  expect((await boss.act('order.update', { id, patch: { basePrice: 650 } })).status).toBe(200)
  expect((await boss.act('order.addPayment', { id, amount: 50, date: day, tag: '定金' })).status).toBe(200)
})
it('无变化不用写原因；无效截图不能留下金额修改', async () => {
  const id = await order()
  expect((await sales.act('order.update', { id, patch: { basePrice: 500 } })).status).toBe(200)
  expect((await sales.act('order.update', { id, patch: { basePrice: 900 }, proof: 'data:image/png;base64,aW52YWxpZA==' })).status).toBe(400)
  expect((await sql`select base_price::float as base_price from orders where id=${id}`)[0].base_price).toBe(500)
  expect((await sales.activity(id)).body.filter((a: any) => a.field === '原价')).toHaveLength(0)
})

it('待收转实收同样要求备注或截图，不能旁路记款', async () => {
  const id = await order()
  const pending = await sales.act('recv.create', { orderId: id, amount: 100, dueDate: day, tag: '定金' })
  const payload = { orderId: id, id: pending.body.id, date: day }
  expect((await sales.act('recv.collect', payload)).status).toBe(400)
  expect((await sql`select count(*)::int as n from payments where order_id=${id}`)[0].n).toBe(0)
  expect((await sales.act('recv.collect', { ...payload, proof, note: '微信收到定金' })).status).toBe(200)
  const entry = (await sales.activity(id)).body.find((a: any) => a.action === '待收转实收')
  expect(entry.note).toBe('微信收到定金')
  expect(entry.proof).toMatch(/^\/api\/files\//)
  expect((await sql`select note,proof from payments where order_id=${id}`)[0]).toMatchObject({ note: '微信收到定金 · 由待收转入', proof: entry.proof })
  expect((await sales.act('recv.collect', { ...payload, proof, note: '微信收到定金' })).status).toBe(400)
  expect((await sql`select count(*)::int as n from payments where order_id=${id}`)[0].n).toBe(1)
})
