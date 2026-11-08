import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { as, closeDb, deliveryProof, resetDb, type Client } from './helpers'
import { GET as imageGet } from '@/app/api/settle/[id]/images/[hash]/route'
import { GET as candidatesGet } from '@/app/api/settle/candidates/route'
import { incomeSettlementSummary } from '@/shared/income'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client, other: Client, order: string, shot: string
const boot = async (c: Client) => (await c.boot()).body
const line = (amount: number, note = '') => ({ orderId: order, amount, note })
const save = (amount: number, extra: object = {}) => boss.act('settle.save', { kind: '写手工资', payeeId: 'u-xiao', lines: [line(amount, '先付一部分')], ...extra })
const income = async (c: Client, id: string) => (await boot(c)).income[id].filter((r: { id: string }) => r.id === order)
async function image(url: string, c?: Client) {
  const [, , , id, , hash] = url.split('/')
  return imageGet(new Request(`http://test.local${url}`, { headers: c ? { cookie: c.cookie } : {} }), { params: Promise.resolve({ id, hash: hash.split('?')[0] }) })
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng'); other = await as('xiaoyang')
  const channelId = (await boss.act('channel.create', { name: '结算测试', ownerId: 'u-acheng' })).body.id
  order = (await boss.act('order.create', { title: '部分结算验收', orderDate: '2026-10-08', dueDate: null, channelId, ownerId: 'u-acheng', basePrice: 1000, assignees: [{ userId: 'u-xiao', pay: 300 }] })).body.id
  expect(order).toBeTruthy()
  expect((await writer.act('order.markDraft', { id: order, proofIds: await deliveryProof(writer, order) })).status).toBe(200)
  shot = `data:image/png;base64,${(await sharp({ create: { width: 30, height: 30, channels: 3, background: '#147d64' } }).png().toBuffer()).toString('base64')}`
})
afterAll(closeDb)

describe('部分结算与备注凭证', () => {
  let first: string, url: string
  it('首付 100 保留整批及单笔备注、截图；草稿不算已发', async () => {
    const r = await save(100, { note: '微信先付100\n余款200下次付', shots: [shot] })
    expect(r.status).toBe(200); first = r.body.id
    const b = (await boot(boss)).batches.find((b: { id: string }) => b.id === first)
    expect(b.note).toBe('微信先付100\n余款200下次付')
    expect(b.lines[0].note).toBe('先付一部分')
    expect(b.shots).toHaveLength(1); url = b.shots[0]
    expect((await income(writer, 'u-xiao'))[0].settlement).toMatchObject({ paid: 0, unpaid: 300 })
    const cr = await candidatesGet(new Request('http://test.local/api/settle/candidates?kind=写手工资&payee=u-xiao', { headers: { cookie: boss.cookie } }), { params: Promise.resolve({}) })
    expect((await cr.json()).find((c: { orderId: string }) => c.orderId === order).remaining).toBe(200)
  })
  it('凭证只允许管理者和收款人访问，不能被同单销售读取或挪用', async () => {
    expect((await image(url)).status).toBe(401)
    expect((await image(url, sales)).status).toBe(404)
    expect((await image(url, other)).status).toBe(404)
    for (const c of [boss, writer]) {
      const r = await image(url, c); expect(r.status).toBe(200)
      expect((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).format).toBe('webp')
    }
    expect((await image(url + '?thumb=1', writer)).status).toBe(200)
    expect((await save(20, { shots: [url] })).status).toBe(400)
    expect((await writer.act('settle.note', { id: first, note: '篡改', shots: [] })).status).toBe(403)
  })
  it('老板确认即已结 100，剩余 200，无需收款人操作，可再补充备注截图', async () => {
    expect((await boss.act('settle.confirm', { id: first })).status).toBe(200)
    expect((await boss.act('settle.confirm', { id: first })).status).toBe(400)
    expect((await income(writer, 'u-xiao'))[0]).toMatchObject({ settle: '部分已结', settlement: { paid: 100, unpaid: 200 } })
    expect((await writer.act('settle.received', { id: first })).status).toBe(404)
    expect((await income(writer, 'u-xiao'))[0].settlement).toMatchObject({ paid: 100, unpaid: 200 })
    expect((await boss.act('settle.note', { id: first, note: '已收到，余款200', shots: [url, shot] })).status).toBe(200)
    const b = (await boot(writer)).batches.find((b: { id: string }) => b.id === first)
    expect(b.note).toBe('已收到，余款200'); expect(b.shots).toEqual([url]); expect(b.total).toBe(100)
    expect((await boss.act('settle.save', { id: first, kind: '写手工资', payeeId: 'u-xiao', lines: [line(999)] })).status).toBe(400)
  })
  it('第二笔 200 直接结清，两次备注各自保留', async () => {
    const r = await save(200, { note: '补齐剩余200' }); expect(r.status).toBe(200)
    await boss.act('settle.confirm', { id: r.body.id })
    expect((await income(writer, 'u-xiao'))[0]).toMatchObject({ settle: '已结', settlement: { paid: 300, unpaid: 0 } })
    const batches = (await boot(writer)).batches
    expect(batches.find((b: { id: string }) => b.id === first).note).toBe('已收到，余款200')
    expect(batches.find((b: { id: string }) => b.id === r.body.id).note).toBe('补齐剩余200')
  })
  it('销售提成也支持一步部分结算及备注，写手看不到销售凭证', async () => {
    const r = await boss.act('settle.save', { kind: '销售提成', payeeId: 'u-acheng', note: '提成先发50', shots: [shot], lines: [line(50, '急用先结')] })
    expect(r.status).toBe(200)
    await boss.act('settle.confirm', { id: r.body.id })
    const before = (await income(sales, 'u-acheng'))[0]
    expect(before.settle).toBe('部分已结'); expect(before.settlement.paid).toBe(50)
    expect(before.settlement.unpaid).toBe(Math.round((before.amount - 50) * 100) / 100)
    const b = (await boot(sales)).batches.find((b: { id: string }) => b.id === r.body.id)
    expect((await image(b.shots[0], writer)).status).toBe(404)
  })
  it('追加工资共享整单结算进度，汇总不重复；作废草稿不改变已结金额', async () => {
    const result = await boss.act('aftersale.create', { orderId: order, reason: '新增需求', req: ['补图'], writerId: 'u-xiao', extra: 80 })
    expect(result.status).toBe(200)
    const rows = await income(writer, 'u-xiao')
    expect(rows).toHaveLength(2)
    expect(incomeSettlementSummary(rows)).toEqual({ paid: 300, unpaid: 80 })
    expect((await save(40, { note: '未交付不能提前结追加工资' })).status).toBe(400)
    expect((await writer.act('aftersale.finish', { orderId: order, asId: result.body.id, proofIds: await deliveryProof(writer, order, result.body.id) })).status).toBe(200)
    const draft = await save(40, { note: '暂存' })
    expect(draft.status).toBe(200)
    await boss.act('settle.void', { id: draft.body.id, reason: '暂不发放' })
    expect(incomeSettlementSummary(await income(writer, 'u-xiao'))).toEqual({ paid: 300, unpaid: 80 })
  })
})
