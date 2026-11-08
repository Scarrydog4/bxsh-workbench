import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET } from '@/app/api/orders/number-suggestion/route'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))

let boss: Client, acheng: Client, yang: Client, writer: Client
const channels: Record<string, string> = {}
const params = { params: Promise.resolve({}) }
const query = async (client?: Client, values: { ownerId?: string; date?: string } = {}) => {
  const search = new URLSearchParams(values).toString()
  const response = await GET(new Request(`http://test.local/api/orders/number-suggestion${search ? `?${search}` : ''}`, {
    headers: client ? { cookie: client.cookie } : {},
  }), params)
  return { status: response.status, body: await response.json() }
}
const suggested = async (client: Client, ownerId: string, date: string) => {
  const result = await query(client, { ownerId, date })
  expect(result.status).toBe(200)
  return result.body as { number: string | null; prefix: string | null; sequence: number | null; ownerId: string; date: string }
}
const payload = (ownerId: string, date: string, title: string, extra: Record<string, unknown> = {}) => ({
  title, orderDate: date, dueDate: null, ownerId, channelId: channels[ownerId],
  basePrice: 100, assignees: [], channelNo: '渠道自己的编号', type: '', note: '', ...extra,
})
const created = async (client: Client, ownerId: string, date: string, title: string, extra: Record<string, unknown> = {}) => {
  const result = await client.act('order.create', payload(ownerId, date, title, extra))
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  const [row] = await db.select().from(t.orders).where(eq(t.orders.id, result.body.id))
  return { row, result: result.body }
}

beforeAll(async () => {
  // 本文件仅在调用方指定的隔离测试库执行；不要用真实业务库运行 resetDb。
  await resetDb()
  boss = await as('boss'); acheng = await as('acheng'); yang = await as('xiaoyang'); writer = await as('xiaosenkai')
  for (const ownerId of ['u-boss', 'u-acheng', 'u-yang']) {
    const result = await boss.act('channel.create', { name: `业务编号测试-${ownerId}`, ownerId })
    expect(result.status).toBe(200)
    channels[ownerId] = result.body.id
  }
})
afterAll(async () => { vi.useRealTimers(); await closeDb() })

it('预览按人员和日期给短年号，重复查看不占号，不同人或日期各自从01开始', async () => {
  expect(await suggested(boss, 'u-boss', '2026-12-01')).toEqual({ number: 'aj26120101', prefix: 'aj', sequence: 1, ownerId: 'u-boss', date: '2026-12-01' })
  expect(await suggested(boss, 'u-boss', '2026-12-01')).toMatchObject({ number: 'aj26120101', sequence: 1 })
  expect(await suggested(acheng, 'u-acheng', '2026-12-01')).toMatchObject({ number: 'ac26120101', prefix: 'ac', sequence: 1 })
  expect(await suggested(yang, 'u-yang', '2026-12-01')).toMatchObject({ number: 'xy26120101', prefix: 'xy', sequence: 1 })
  await created(boss, 'u-boss', '2026-12-01', 'aj26120101 机械', { suggestedNumber: 'aj26120101' })
  expect(await suggested(boss, 'u-boss', '2026-12-01')).toMatchObject({ number: 'aj26120102', sequence: 2 })
  expect(await suggested(boss, 'u-boss', '2026-12-02')).toMatchObject({ number: 'aj26120201', sequence: 1 })
  expect(await suggested(acheng, 'u-acheng', '2026-12-01')).toMatchObject({ number: 'ac26120101', sequence: 1 })
})

it('不传日期采用北京时间，账号默认本人，不受执行机器时区影响', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime('2026-12-02T16:30:00Z')
  try {
    const result = await query(await as('acheng'))
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ number: 'ac26120301', prefix: 'ac', sequence: 1, ownerId: 'u-acheng', date: '2026-12-03' })
  } finally { vi.useRealTimers() }
})

it('建议接口要求登录和录单权限，普通销售只能看自己，老板可以代选销售', async () => {
  expect((await query(undefined, { date: '2026-12-04' })).status).toBe(401)
  expect((await query(writer, { date: '2026-12-04' })).status).toBe(403)
  expect((await query(acheng, { ownerId: 'u-boss', date: '2026-12-04' })).status).toBe(403)
  expect((await query(acheng, { ownerId: 'u-yang', date: '2026-12-04' })).status).toBe(403)
  expect(await suggested(boss, 'u-yang', '2026-12-04')).toMatchObject({ number: 'xy26120401', ownerId: 'u-yang' })
  const { row, result } = await created(boss, 'u-yang', '2026-12-04', 'xy26120401 旅游管理', { suggestedNumber: 'xy26120401' })
  expect(row).toMatchObject({ title: 'xy26120401 旅游管理', ownerId: 'u-yang', creatorId: 'u-boss', no: 'DD2612040001', channelNo: '渠道自己的编号' })
  expect(result).toMatchObject({ id: row.id, no: row.no, title: row.title })
})

it('有录单权限但未设置前缀的人员返回空建议，不编造编号', async () => {
  await db.update(t.users).set({ roleId: 'r-sales' }).where(eq(t.users.id, 'u-xiao'))
  try {
    const result = await query(writer, { date: '2026-12-05' })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ number: null, prefix: null, sequence: null, ownerId: 'u-xiao', date: '2026-12-05' })
  } finally { await db.update(t.users).set({ roleId: 'r-writer' }).where(eq(t.users.id, 'u-xiao')) }
})

it('没有业务编号的历史订单也计入当日第几单，退单与软删除不让序号倒退', async () => {
  const day = '2026-12-06'
  const a = await created(boss, 'u-boss', day, '历史订单甲')
  const b = await created(boss, 'u-boss', day, '历史订单乙')
  await created(boss, 'u-boss', day, '历史订单丙')
  await db.update(t.orders).set({ deletedAt: new Date().toISOString() }).where(eq(t.orders.id, a.row.id))
  await db.update(t.orders).set({ status: '退单' }).where(eq(t.orders.id, b.row.id))
  expect(await suggested(boss, 'u-boss', day)).toMatchObject({ number: 'aj26120604', sequence: 4 })
  expect(await suggested(acheng, 'u-acheng', day)).toMatchObject({ number: 'ac26120601', sequence: 1 })
})

it('历史四位年与两位年混合时按最大序号续号，删除、退单和其他归属的已用号都避开', async () => {
  const day = '2026-12-07'
  const old = await created(boss, 'u-boss', day, 'aj2026120707 旧长编号')
  const short = await created(boss, 'u-boss', day, 'aj26120709 短编号')
  await db.update(t.orders).set({ deletedAt: new Date().toISOString() }).where(eq(t.orders.id, old.row.id))
  await db.update(t.orders).set({ status: '退单' }).where(eq(t.orders.id, short.row.id))
  expect(await suggested(boss, 'u-boss', day)).toMatchObject({ number: 'aj26120710', sequence: 10 })
  await created(boss, 'u-acheng', day, 'aj26120712 曾转交归属的编号')
  expect(await suggested(boss, 'u-boss', day)).toMatchObject({ number: 'aj26120713', sequence: 13 })
  const saved = await created(boss, 'u-boss', day, 'aj26120710 新订单', { suggestedNumber: 'aj26120710' })
  expect(saved.row.title).toBe('aj26120713 新订单')
  expect(saved.result.title).toBe(saved.row.title)
})

it('多人同时使用同一个旧建议时在事务内依次分配，不重复业务编号或DD编号', async () => {
  const day = '2026-12-08', hint = 'ac26120801'
  const results = await Promise.all([1, 2, 3, 4].map(index => created(acheng, 'u-acheng', day, `${hint} 并发-${index}`, { suggestedNumber: hint })))
  expect(results.map(({ row }) => row.title.split(' ')[0]).sort()).toEqual(['ac26120801', 'ac26120802', 'ac26120803', 'ac26120804'])
  expect(new Set(results.map(({ row }) => row.no)).size).toBe(4)
  for (const { row, result } of results) expect(result).toMatchObject({ title: row.title, no: row.no })
  expect(await suggested(acheng, 'u-acheng', day)).toMatchObject({ number: 'ac26120805', sequence: 5 })
})

it('已分配计数持久保留，后来改名或改日期也不重复用回旧号，超过99不截断', async () => {
  const day = '2026-12-09'
  await created(boss, 'u-boss', day, 'aj2026120999 历史第99单')
  const { row } = await created(boss, 'u-boss', day, 'aj261209100 第100单', { suggestedNumber: 'aj261209100' })
  expect(row.title).toBe('aj261209100 第100单')
  await db.update(t.orders).set({ title: '改为手写名称', orderDate: '2026-12-10' }).where(eq(t.orders.id, row.id))
  expect(await suggested(boss, 'u-boss', day)).toMatchObject({ number: 'aj261209101', sequence: 101 })
})

it('不带suggestedNumber时保留手写名称与渠道单号，已有DD规则不变', async () => {
  const { row, result } = await created(boss, 'u-boss', '2026-12-11', '客户自定义编号-备注 论文', { channelNo: 'CUSTOM-001' })
  expect(row).toMatchObject({ title: '客户自定义编号-备注 论文', channelNo: 'CUSTOM-001', no: 'DD2612110001' })
  expect(result).toMatchObject({ id: row.id, no: row.no, title: row.title })
})

it('错误人员、日期、长格式或不在名称开头的建议被拒绝，失败不占业务号或DD号', async () => {
  const day = '2026-12-12'
  for (const [hint, title] of [
    ['ac26121201', 'ac26121201 错人员'],
    ['aj26121301', 'aj26121301 错日期'],
    ['aj2026121201', 'aj2026121201 旧格式不能作为新建议'],
    ['aj26121201', '未采用建议的名称'],
    ['aj26121201', 'aj2612120101 前缀碰巧相同'],
    ['aj26121201', 'aj26121201没有分隔空格'],
  ]) {
    const result = await boss.act('order.create', payload('u-boss', day, title, { suggestedNumber: hint }))
    expect(result.status, title).toBe(400)
  }
  const invalid = await boss.act('order.create', payload('u-boss', day, 'aj26121201 无效渠道', { suggestedNumber: 'aj26121201', channelId: 'missing-channel' }))
  expect(invalid.status).toBe(404)
  expect(await suggested(boss, 'u-boss', day)).toMatchObject({ number: 'aj26121201', sequence: 1 })
  const { row } = await created(boss, 'u-boss', day, 'aj26121201 正确提交', { suggestedNumber: 'aj26121201' })
  expect(row).toMatchObject({ title: 'aj26121201 正确提交', no: 'DD2612120001' })
})

it('建议接口拒绝无效日期', async () => {
  for (const date of ['2026-02-30', '2026/12/13', 'not-a-date']) expect((await query(boss, { date })).status).toBe(400)
})
