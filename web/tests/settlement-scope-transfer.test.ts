import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { as, closeDb, deliveryProof, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { GET as candidatesGet } from '@/app/api/settle/candidates/route'
import { GET as imageGet } from '@/app/api/settle/[id]/images/[hash]/route'
import { businessDate } from '@/shared/format'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, helper: Client, channel: string, shot: string
const day = businessDate(new Date())
const context = { params: Promise.resolve({}) }
async function create(ownerId = 'u-acheng', channelId = channel, pay = 20, writerId = 'u-xiao') {
  const response = await boss.act('order.create', { title: '结算隔离测试', orderDate: day, dueDate: null, ownerId, channelId, basePrice: 100, assignees: [{ userId: writerId, pay }] })
  expect(response.status).toBe(200)
  if (writerId === 'u-xiao') expect((await writer.act('order.markDraft', { id: response.body.id, proofIds: await deliveryProof(writer, response.body.id) })).status).toBe(200)
  return response.body.id as string
}
async function save(orderIds: string[], payeeId = 'u-acheng', kind = '销售提成', amount = 10, client = boss, extra = {}) {
  return client.act('settle.save', { kind, payeeId, lines: orderIds.map(orderId => ({ orderId, amount })), ...extra })
}
async function candidates(client: Client, payee = 'u-xiao', kind = '写手工资') {
  const params = new URLSearchParams({ payee, kind })
  const response = await candidatesGet(new Request(`http://test.local/api/settle/candidates?${params}`, { headers: { cookie: client.cookie } }), context)
  expect(response.status).toBe(200); return await response.json() as { orderId: string; remaining: number }[]
}
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); writer = await as('xiaosenkai')
  channel = (await boss.act('channel.create', { name: '结算权限', ownerId: 'u-acheng' })).body.id
  shot = `data:image/png;base64,${(await sharp({ create: { width: 24, height: 24, channels: 3, background: '#147d64' } }).png().toBuffer()).toString('base64')}`
})
afterAll(closeDb)

it('仅本人订单的结算管理员不能枚举、保存、确认、改备注、作废他人结算，混批同样阻止', async () => {
  const own = await create('u-yang'), foreign = await create()
  const draft = await save([foreign], 'u-xiao', '写手工资', 5, boss, { shots: [shot] })
  const mixed = await save([own, foreign], 'u-xiao', '写手工资', 5)
  expect(draft.status).toBe(200); expect(mixed.status).toBe(200)
  const role = await boss.act('role.save', { name: '局部结算员', perms: ['order.view', 'settle.manage'], rowScope: 'owned', fields: { sales: false, writerPay: 'all', commission: 'all', profit: false, channelNo: false } })
  expect((await boss.act('user.update', { id: 'u-yang', patch: { roleId: role.body.id } })).status).toBe(200)
  helper = await as('xiaoyang')
  const rows = await candidates(helper)
  expect(rows.map(row => row.orderId)).toContain(own); expect(rows.map(row => row.orderId)).not.toContain(foreign)
  expect((await save([foreign], 'u-xiao', '写手工资', 1, helper)).status).toBe(404)
  expect((await save([own], 'u-xiao', '写手工资', 1, helper, { id: mixed.body.id })).status).toBe(404)
  for (const id of [draft.body.id, mixed.body.id]) {
    expect((await helper.act('settle.confirm', { id })).status).toBe(404)
    expect((await helper.act('settle.note', { id, note: '不可改', shots: [] })).status).toBe(404)
    expect((await helper.act('settle.void', { id, reason: '不可作废' })).status).toBe(404)
  }
  const visible = (await helper.boot()).body.batches
  expect(visible.some((batch: { id: string }) => [draft.body.id, mixed.body.id].includes(batch.id))).toBe(false)
  const bossBatch = (await boss.boot()).body.batches.find((batch: { id: string }) => batch.id === draft.body.id)
  const url = bossBatch.shots[0], hash = url.split('/').at(-1)
  expect((await imageGet(new Request(`http://test.local${url}`, { headers: { cookie: helper.cookie } }), { params: Promise.resolve({ id: draft.body.id, hash }) })).status).toBe(404)
  expect((await imageGet(new Request(`http://test.local${url}`, { headers: { cookie: writer.cookie } }), { params: Promise.resolve({ id: draft.body.id, hash }) })).status).toBe(200)
  const ownDraft = await save([own], 'u-xiao', '写手工资', 5, helper)
  expect(ownDraft.status).toBe(200); expect((await helper.act('settle.confirm', { id: ownDraft.body.id })).status).toBe(200)
  expect((await boss.act('user.update', { id: 'u-yang', patch: { roleId: 'r-sales' } })).status).toBe(200)
})

it('整张草稿随渠道转交同步抬头与明细，已确认历史不改', async () => {
  const ch = (await boss.act('channel.create', { name: '整批转交', ownerId: 'u-acheng' })).body.id
  const order = await create('u-acheng', ch)
  const paid = await save([order], 'u-acheng', '销售提成', 10)
  expect((await boss.act('settle.confirm', { id: paid.body.id })).status).toBe(200)
  const draft = await save([order], 'u-acheng', '销售提成', 20)
  expect((await boss.act('channel.update', { id: ch, patch: { ownerId: 'u-yang' } })).status).toBe(200)
  expect((await sql`select payee_id,status from settle_batches where id=${draft.body.id}`)[0]).toMatchObject({ payee_id: 'u-yang', status: '草稿' })
  expect((await sql`select payee_id,status from settlements where batch_id=${draft.body.id}`)[0]).toMatchObject({ payee_id: 'u-yang', status: '草稿' })
  expect((await sql`select payee_id,status from settlements where batch_id=${paid.body.id}`)[0]).toMatchObject({ payee_id: 'u-acheng', status: '已确认' })
  expect((await boss.act('settle.confirm', { id: draft.body.id })).status).toBe(200)
  expect((await sql`select count(*)::int n from audit where object_id=${draft.body.id} and action='转交结算草稿'`)[0].n).toBe(1)
})

it('跨渠道混批转交整张草稿作废保留历史，两边待结金额均重新释放', async () => {
  const ch = (await boss.act('channel.create', { name: '混批转交', ownerId: 'u-acheng' })).body.id
  const moved = await create('u-acheng', ch), stays = await create()
  const draft = await save([moved, stays])
  expect((await boss.act('channel.update', { id: ch, patch: { ownerId: 'u-yang' } })).status).toBe(200)
  expect((await sql`select status,note from settle_batches where id=${draft.body.id}`)[0]).toMatchObject({ status: '已作废', note: expect.stringContaining('原草稿包含其他渠道') })
  const lines = await sql`select status,payee_id from settlements where batch_id=${draft.body.id}`
  expect(lines).toHaveLength(2); expect(lines.every(line => line.status === '已作废' && line.payee_id === 'u-acheng')).toBe(true)
  expect((await candidates(boss, 'u-yang', '销售提成')).find(row => row.orderId === moved)?.remaining).toBe(40)
  expect((await candidates(boss, 'u-acheng', '销售提成')).find(row => row.orderId === stays)?.remaining).toBe(40)
})

it('转老板自营时提成草稿作废，不生成老板提成', async () => {
  const ch = (await boss.act('channel.create', { name: '转自营', ownerId: 'u-acheng' })).body.id
  const order = await create('u-acheng', ch), draft = await save([order])
  expect((await boss.act('channel.update', { id: ch, patch: { ownerId: 'u-boss' } })).status).toBe(200)
  expect((await sql`select status from settle_batches where id=${draft.body.id}`)[0].status).toBe('已作废')
  expect(await candidates(boss, 'u-boss', '销售提成')).toEqual([])
})

it('提成不能超额保存；已有草稿在订单金额降低或删除后不能照旧确认', async () => {
  const order = await create()
  expect((await save([order], 'u-acheng', '销售提成', 41)).status).toBe(400)
  const draft = await save([order], 'u-acheng', '销售提成', 40)
  expect((await boss.act('order.update', { id: order, patch: { basePrice: 60 }, note: '测试降价' })).status).toBe(200)
  expect((await boss.act('settle.confirm', { id: draft.body.id })).status).toBe(400)
  const deleted = await create(), old = await save([deleted])
  expect((await boss.act('order.delete', { ids: [deleted] })).status).toBe(200)
  expect((await boss.act('settle.confirm', { id: old.body.id })).status).toBe(404)
})

it('老板内部计价不出现在写手待发候选，也不能借旧草稿入口发工资', async () => {
  expect((await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })).status).toBe(200)
  const order = await create('u-acheng', channel, 20, 'u-boss')
  expect(await candidates(boss, 'u-boss')).toEqual([])
  expect((await save([order], 'u-boss', '写手工资', 20)).status).toBe(400)
})
