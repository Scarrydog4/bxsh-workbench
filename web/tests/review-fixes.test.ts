/**
 * 审查（2026-10-07）指出的问题的回归：收入权限、范围外恢复、并发开售后、同偏移量分片并发、
 * 0 元工资的追加、跨月追加归期、停用账号不改历史账目、事后补追加工资、改期限 / 负责人。
 */
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { payday } from '@/shared/format'
import { POST as uploadInit } from '@/app/api/upload/route'
import { PUT as uploadPut } from '@/app/api/upload/[id]/route'
import { POST as uploadDone } from '@/app/api/upload/[id]/complete/route'
import { GET as fileGet } from '@/app/api/files/[id]/route'
import { as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, acheng: Client, xiao: Client
const day = new Date().toISOString().slice(0, 10)
let ch = ''

type Row = { kind: string; amount: number | null; pay: string; id: string }
const incomeOf = async (c: Client, userId: string) => ((await c.boot()).body.income[userId] ?? []) as Row[]
const order = async (c: Client, id: string) => (await c.boot()).body.orders.find((o: { id: string }) => o.id === id)

async function mk(ownerId: string, basePrice: number, pay: number | null, writer = 'u-xiao') {
  const r = await boss.act('order.create', { title: `回归 ${basePrice}`, orderDate: day, dueDate: null, ownerId, channelId: ch, basePrice, assignees: [{ userId: writer, pay }], channelNo: '', type: '', note: '' })
  return r.body.id as string
}
const due = () => new Date(Date.now() + 24 * 3600_000).toISOString()

beforeAll(async () => {
  await resetDb()
  boss = await as('boss')
  acheng = await as('acheng')
  xiao = await as('xiaosenkai')
  ch = (await boss.act('channel.create', { name: '回归渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

describe('1. 收入接口按权限出', () => {
  it('关掉查看订单和工资字段后，收入里什么都没有；打开「自己的」又能看到', async () => {
    const id = await mk('u-acheng', 1000, 100)
    expect((await incomeOf(xiao, 'u-xiao')).some((r) => r.id === id)).toBe(true)

    const role = await boss.act('role.save', { name: '无权写手', perms: [], fields: { sales: false, writerPay: 'none', commission: 'none', profit: false, channelNo: false }, rowScope: 'assigned' })
    await boss.act('user.update', { id: 'u-xiao', patch: { roleId: role.body.id } })
    xiao = await as('xiaosenkai')
    const b = (await xiao.boot()).body
    expect(b.orders).toEqual([])
    expect(b.income['u-xiao']).toEqual([])

    // 能看订单，但工资字段关着：还是没有
    await boss.act('role.save', { id: role.body.id, name: '无权写手', perms: ['order.view'], fields: { sales: false, writerPay: 'none', commission: 'none', profit: false, channelNo: false }, rowScope: 'assigned' })
    expect(await incomeOf(xiao, 'u-xiao')).toEqual([])

    // 工资「只看自己的」：有了
    await boss.act('role.save', { id: role.body.id, name: '无权写手', perms: ['order.view'], fields: { sales: false, writerPay: 'own', commission: 'none', profit: false, channelNo: false }, rowScope: 'assigned' })
    expect((await incomeOf(xiao, 'u-xiao')).find((r) => r.id === id)?.amount).toBe(100)

    await boss.act('user.update', { id: 'u-xiao', patch: { roleId: 'r-writer' } })
    xiao = await as('xiaosenkai')
  })

  it('有「查看所有人收入」但工资字段只有「自己的」：看不到别人的工资', async () => {
    const role = await boss.act('role.save', { name: '看收入', perms: ['order.view', 'income.all'], fields: { sales: true, writerPay: 'own', commission: 'own', profit: false, channelNo: false }, rowScope: 'all' })
    await boss.act('user.update', { id: 'u-acheng', patch: { roleId: role.body.id } })
    acheng = await as('acheng')
    const b = (await acheng.boot()).body
    expect(b.income['u-xiao'] ?? []).toEqual([])
    await boss.act('user.update', { id: 'u-acheng', patch: { roleId: 'r-sales' } })
    acheng = await as('acheng')
  })
})

describe('2. 恢复订单也检查行范围', () => {
  it('销售（加了删除权限）不能恢复范围外的单，能恢复自己的', async () => {
    const role = await boss.act('role.save', { name: '销售可删', perms: ['order.view', 'order.create', 'order.edit', 'order.delete'], fields: { sales: true, writerPay: 'none', commission: 'own', profit: false, channelNo: true }, rowScope: 'owned' })
    await boss.act('user.update', { id: 'u-acheng', patch: { roleId: role.body.id } })
    acheng = await as('acheng')
    const other = await mk('u-boss', 500, 100)
    const mine = await mk('u-acheng', 600, 100)
    await boss.act('order.delete', { ids: [other] })
    expect((await acheng.act('order.restore', { ids: [other] })).status).toBe(404)
    expect((await boss.boot()).body.trash.some((x: { id: string }) => x.id === other)).toBe(true)

    expect((await acheng.act('order.delete', { ids: [mine] })).status).toBe(200)
    expect((await acheng.act('order.restore', { ids: [mine] })).status).toBe(200)
    expect(await order(acheng, mine)).toBeDefined()
    await boss.act('user.update', { id: 'u-acheng', patch: { roleId: 'r-sales' } })
    acheng = await as('acheng')
  })
})

describe('3. 并发开售后', () => {
  it('同一单同时开两次：只成功一次，不出现两张第 1 轮', async () => {
    const id = await mk('u-acheng', 800, 100)
    const body = { orderId: id, req: ['改摘要'], due: due() }
    const who = [boss, xiao, acheng, boss, xiao, acheng, boss, xiao]
    const rs = await Promise.all(who.map((c) => c.act('aftersale.create', body)))
    // 排队执行：其余的看到第一轮已开，得到正常的提示（不是数据库报错）
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400, 400, 400, 400])
    expect(rs.filter((r) => r.status === 400).every((r) => /上一轮还没改完/.test(r.body.error))).toBe(true)
    const rows = await db.select().from(t.afterSales).where(eq(t.afterSales.orderId, id))
    expect(rows).toHaveLength(1)
    expect(rows[0].round).toBe(1)
  })

  it('数据库兜底：同一单不能有两轮同时在改，也不能重号', async () => {
    const id = await mk('u-acheng', 810, 100)
    const row = { orderId: id, reason: '正常修改', req: ['x'], shots: [], start: new Date().toISOString(), due: due(), writerId: 'u-xiao', by: 'u-boss' }
    await db.insert(t.afterSales).values({ ...row, id: 'as-k1', round: 1 })
    await expect(db.insert(t.afterSales).values({ ...row, id: 'as-k2', round: 2 })).rejects.toThrow()
    await db.update(t.afterSales).set({ doneAt: new Date().toISOString() }).where(eq(t.afterSales.id, 'as-k1'))
    await expect(db.insert(t.afterSales).values({ ...row, id: 'as-k3', round: 1 })).rejects.toThrow()
    await db.insert(t.afterSales).values({ ...row, id: 'as-k4', round: 2 })
  })
})

describe('4. 同偏移量分片并发', () => {
  it('两片 offset=0 同时到：只写一次，续传完文件和原文件一致', async () => {
    const id = await mk('u-acheng', 900, 100)
    const MB = 1024 * 1024
    const data = Buffer.alloc(2 * MB)
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 251
    const h = { cookie: xiao.cookie }
    const p = (x: string) => ({ params: Promise.resolve({ id: x }) })
    const init = await (await uploadInit(new Request('http://t/api/upload', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ orderId: id, name: 'a.png', size: data.length, mime: 'image/png' }) }), { params: Promise.resolve({}) })).json()
    const put = (off: number, part: Buffer) => uploadPut(new Request(`http://t/api/upload/${init.id}?offset=${off}`, { method: 'PUT', headers: h, body: new Uint8Array(part) }), p(init.id))
    const [a, b] = await Promise.all([put(0, data.subarray(0, MB)), put(0, data.subarray(0, MB))])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect((await put(MB, data.subarray(MB))).status).toBe(200)
    const done = await uploadDone(new Request(`http://t/api/upload/${init.id}/complete`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' }), p(init.id))
    expect(done.status).toBe(200)
    const fid = (await done.json()).id
    const [f] = await db.select().from(t.attachments).where(eq(t.attachments.id, fid))
    expect(Buffer.compare(await readFile(f.path), data)).toBe(0)

    // 图片可以在浏览器里直接看（看大图），默认还是下载
    const get = (q: string) => fileGet(new Request(`http://t/api/files/${fid}${q}`, { headers: h }), p(fid))
    expect((await get('?inline=1')).headers.get('content-disposition')).toMatch(/^inline/)
    expect((await get('')).headers.get('content-disposition')).toMatch(/^attachment/)
  })
})

describe('5、6. 追加工资', () => {
  it('原工资 0、追加 50：收入里有 50', async () => {
    const id = await mk('u-acheng', 700, 0)
    await boss.act('aftersale.create', { orderId: id, reason: '新增需求', req: ['加一章'], due: due(), extra: 50 })
    const rows = (await incomeOf(xiao, 'u-xiao')).filter((r) => r.id === id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: '追加工资', amount: 50 })
  })

  it('9 月 10 日交初稿、10 月追加：原工资留在 9 月那期，追加单独一行进开这一轮那期', async () => {
    const id = await mk('u-acheng', 1500, 100)
    await db.update(t.orders).set({ draftAt: '2026-09-10T10:00:00.000Z' }).where(eq(t.orders.id, id))
    await boss.act('aftersale.create', { orderId: id, reason: '新增需求', req: ['加数据'], due: due(), extra: 50 })
    const rows = (await incomeOf(boss, 'u-xiao')).filter((r) => r.id === id)
    expect(rows.find((r) => r.kind === '工资')).toMatchObject({ amount: 100, pay: payday('2026-09-10T10:00:00.000Z') })
    expect(rows.find((r) => r.kind === '追加工资')).toMatchObject({ amount: 50, pay: payday(new Date().toISOString()) })
  })

  it('先按正常修改开，管理员事后定为新增需求：同时补追加工资、给订单加价', async () => {
    const id = await mk('u-acheng', 1000, 200)
    const r = await xiao.act('aftersale.create', { orderId: id, req: ['再加一节'], due: due() })
    // 写手不能定性
    expect((await xiao.act('aftersale.reason', { orderId: id, asId: r.body.id, reason: '新增需求', extra: 80 })).status).toBe(403)
    expect((await boss.act('aftersale.reason', { orderId: id, asId: r.body.id, reason: '新增需求', extra: 80, charge: 300 })).status).toBe(200)
    const o = await order(boss, id)
    expect(o.writerTotal).toBe(280)
    expect(o.sales).toBe(1300)
    expect(o.afterSales[0]).toMatchObject({ reason: '新增需求', extra: 80 })
    // 改回正常修改，追加工资清零
    await boss.act('aftersale.reason', { orderId: id, asId: r.body.id, reason: '正常修改' })
    expect((await order(boss, id)).writerTotal).toBe(200)
  })
})

describe('7. 停用账号不改历史账目', () => {
  it('停用第二个管理员：他的自营单仍是自营，提成 0，利润不变，名字还在', async () => {
    const u = await boss.act('user.create', { name: '二老板', account: 'boss2', roleId: 'r-admin', canWrite: false })
    const id = await mk(u.body.id, 1000, 100)
    const before = await order(boss, id)
    expect(before).toMatchObject({ isSelf: true, commission: 0, profit: 900 })
    expect((await boss.act('user.update', { id: u.body.id, patch: { active: false } })).status).toBe(200)
    const b = (await boss.boot()).body
    expect(b.orders.find((o: { id: string }) => o.id === id)).toMatchObject({ isSelf: true, commission: 0, profit: 900 })
    expect(b.users.find((x: { id: string }) => x.id === u.body.id)).toMatchObject({ name: '二老板', active: false })
    // 停用的人不能再被选为新单的归属
    expect((await boss.act('order.create', { title: 'x', orderDate: day, dueDate: null, ownerId: u.body.id, channelId: ch, basePrice: 1, assignees: [], channelNo: '', type: '', note: '' })).status).toBe(400)
  })

  it('不能把最后一个在用的管理员停用', async () => {
    // 二老板已停用，老板是唯一在用的管理员；老板不能停自己，换个管理员来停也不行
    const u = await boss.act('user.create', { name: '三老板', account: 'boss3', roleId: 'r-admin', canWrite: false })
    expect((await boss.act('user.update', { id: u.body.id, patch: { active: false } })).status).toBe(200)
    expect((await boss.act('user.update', { id: 'u-boss', patch: { roleId: 'r-sales' } })).status).toBe(400)
  })
})

describe('14. 改这一轮的期限和负责人', () => {
  it('能指定本单的另一个写手负责、改期限，都有留痕；不是本单写手的不行', async () => {
    await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })
    const id = await mk('u-acheng', 1200, 100)
    await boss.act('order.setWriters', { id, writers: [{ userId: 'u-xiao', pay: 100 }, { userId: 'u-boss', pay: 50 }] })
    const r = await acheng.act('aftersale.create', { orderId: id, req: ['图表重画'], due: due(), writerId: 'u-boss' })
    expect(r.status).toBe(200)
    expect((await order(boss, id)).afterSales[0].writerId).toBe('u-boss')

    // 历史任务保留原延期流程；新任务另测一小时确认规则。
    await db.update(t.afterSales).set({ confirmBy: null, confirmedAt: null }).where(eq(t.afterSales.id, r.body.id))
    const friday = new Date(Date.now() + 3 * 24 * 3600_000)
    friday.setHours(18, 0, 0, 0)
    expect((await acheng.act('aftersale.update', { orderId: id, asId: r.body.id, due: friday.toISOString(), writerId: 'u-xiao' })).status).toBe(200)
    const a = (await order(boss, id)).afterSales[0]
    expect(a.writerId).toBe('u-xiao')
    expect(new Date(a.due).getTime()).toBe(friday.getTime())
    expect((await acheng.act('aftersale.update', { orderId: id, asId: r.body.id, writerId: 'u-acheng' })).status).toBe(400)
    const log = (await boss.activity(id)).body.map((x: { action: string }) => x.action)
    expect(log).toEqual(expect.arrayContaining(['改期限', '换负责人']))
  })
})
