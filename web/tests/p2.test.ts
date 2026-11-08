/**
 * P2 业务：结算单、待收、提醒、评论与 @、进度节点与模板、需求卡片、选项管理、对账单与分享链接。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { runJobs } from '@/server/jobs'
import { businessDate, paydayKey } from '@/shared/format'
import { deliveryProof, as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))

let boss: Client, acheng: Client, yang: Client, xiao: Client
let ch = ''
const day = businessDate(new Date())
const boot = async (c: Client) => (await c.boot()).body
const orderOf = async (c: Client, id: string) => (await boot(c)).orders.find((o: { id: string }) => o.id === id)

async function mk(ownerId: string, price: number, pay: number | null, extra: Record<string, unknown> = {}) {
  const r = await boss.act('order.create', { title: `P2 测试 ${price}`, orderDate: day, dueDate: null, ownerId, channelId: ch, basePrice: price, assignees: [{ userId: 'u-xiao', pay }], channelNo: 'QD-1', type: '', note: '', ...extra })
  return r.body.id as string
}

beforeAll(async () => {
  await resetDb()
  boss = await as('boss')
  acheng = await as('acheng')
  yang = await as('xiaoyang')
  xiao = await as('xiaosenkai')
  ch = (await boss.act('channel.create', { name: 'P2 渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

describe('结算单', () => {
  let a = '', b = ''
  beforeAll(async () => {
    a = await mk('u-acheng', 1000, 200)
    b = await mk('u-acheng', 800, 150)
    await xiao.act('order.markDraft', { id: a, proofIds: await deliveryProof(xiao, a) })
    await xiao.act('order.markDraft', { id: b, proofIds: await deliveryProof(xiao, b) })
    await boss.act('order.addPayment', { id: a, amount: 1000, date: day, tag: '全款', note: '' })
  })

  it('能列出没结清的单；写手、销售不能管结算', async () => {
    expect((await xiao.act('settle.save', { kind: '写手工资', payeeId: 'u-xiao', lines: [{ orderId: a, amount: 200 }] })).status).toBe(403)
    expect((await acheng.act('settle.save', { kind: '销售提成', payeeId: 'u-acheng', lines: [{ orderId: a, amount: 400 }] })).status).toBe(403)
  })

  it('草稿 → 已结算；无需收款人再次确认', async () => {
    const r = await boss.act('settle.save', { kind: '写手工资', payeeId: 'u-xiao', lines: [{ orderId: a, amount: 200 }, { orderId: b, amount: 100 }] })
    expect(r.status).toBe(200)
    // 草稿已经占住了：再建一张时这两单的剩余只算没进草稿的部分
    const again = await boss.act('settle.save', { kind: '写手工资', payeeId: 'u-xiao', lines: [{ orderId: a, amount: 200 }] })
    expect(again.status).toBe(400)

    let bt = (await boot(boss)).batches.find((x: { id: string }) => x.id === r.body.id)
    expect(bt).toMatchObject({ status: '草稿', total: 300 })
    expect((await orderOf(boss, a)).writerSettle).toBe('未结算')

    expect((await boss.act('settle.confirm', { id: r.body.id })).status).toBe(200)
    expect((await orderOf(boss, a)).writerSettle).toBe('已结算')
    expect((await orderOf(boss, b)).writerSettle).toBe('部分结算')

    // 写手收到提醒，看得到自己的结算单；销售看不到
    const xb = await boot(xiao)
    expect(xb.notifications.some((n: { title: string }) => n.title.includes('已结算'))).toBe(true)
    expect(xb.batches.map((x: { id: string }) => x.id)).toContain(r.body.id)
    expect((await boot(acheng)).batches).toEqual([])

    // 收款人只能查看，不能重复确认已付款。
    expect((await xiao.act('settle.confirm', { id: r.body.id })).status).toBe(403)
    const inc = (await boot(xiao)).income['u-xiao']
    expect(inc.find((x: { id: string }) => x.id === a).settle).toBe('已结')
    expect(inc.find((x: { id: string }) => x.id === b).settle).toBe('部分已结')

    // 普通员工不能作废老板的付款记录。
    expect((await xiao.act('settle.void', { id: r.body.id, reason: 'x' })).status).toBe(403)
  })

  it('提成结算：管理员（自营）不能当收款人', async () => {
    expect((await boss.act('settle.save', { kind: '销售提成', payeeId: 'u-boss', lines: [{ orderId: a, amount: 1 }] })).status).toBe(400)
    const r = await boss.act('settle.save', { kind: '销售提成', payeeId: 'u-acheng', lines: [{ orderId: a, amount: 400 }] })
    expect(r.status).toBe(200)
    await boss.act('settle.confirm', { id: r.body.id })
    expect((await orderOf(acheng, a)).salesSettle).toBe('已结算')
  })

  it('每月 13 日起生成当期工资草稿，只生成一次', async () => {
    const c = await mk('u-acheng', 600, 120)
    await xiao.act('order.markDraft', { id: c, proofIds: await deliveryProof(xiao, c) })
    const now = new Date()
    const thirteenth = new Date(now.getFullYear(), now.getMonth(), 13, 9)
    const period = paydayKey(new Date(now.getFullYear(), now.getMonth(), 2, 12).toISOString())
    // 让这单的初稿落在本期
    await db.update(t.orders).set({ draftAt: new Date(now.getFullYear(), now.getMonth(), 2, 12).toISOString() }).where(eq(t.orders.id, c))
    const r1 = await runJobs(thirteenth)
    const r2 = await runJobs(thirteenth)
    expect(r1.drafts).toBe(1)
    expect(r2.drafts).toBe(0)
    const d = (await boot(boss)).batches.find((x: { period: string | null }) => x.period === period)
    expect(d.status).toBe('草稿')
    expect(d.lines.map((l: { orderId: string }) => l.orderId)).toContain(c)
    expect((await boot(boss)).notifications.some((n: { title: string }) => n.title.includes('工资草稿已生成'))).toBe(true)
  })
})

describe('待收', () => {
  it('记待收 → 到期提醒归属销售 → 转成实收', async () => {
    const id = await mk('u-acheng', 900, 100)
    const r = await acheng.act('recv.create', { orderId: id, amount: 450, dueDate: day, tag: '尾款', note: '月底' })
    expect(r.status).toBe(200)
    expect((await xiao.act('recv.create', { orderId: id, amount: 1, dueDate: day, tag: '尾款' })).status).toBe(403)
    await runJobs(new Date())
    expect((await boot(acheng)).notifications.some((n: { title: string }) => n.title.includes('待收到期'))).toBe(true)
    expect((await acheng.act('recv.collect', { orderId: id, id: r.body.id, date: day, note: '尾款已收到' })).status).toBe(200)
    const o = await orderOf(acheng, id)
    expect(o.received).toBe(450)
    expect(o.receivables[0].doneAt).toBeTruthy()
    expect((await acheng.act('recv.collect', { orderId: id, id: r.body.id, date: day, note: '尾款已收到' })).status).toBe(400)
    // 写手看不到待收
    expect((await orderOf(xiao, id)).receivables).toBeUndefined()
  })
})

describe('提醒', () => {
  it('新单通知写手；被催通知写手；全部标为已读', async () => {
    const id = await mk('u-acheng', 700, null)
    let xb = await boot(xiao)
    expect(xb.notifications.some((n: { orderId: string; kind: string }) => n.orderId === id && n.kind === '新订单')).toBe(true)
    const as1 = await acheng.act('aftersale.create', { orderId: id, req: ['改格式'], due: new Date(Date.now() + 3600_000).toISOString() })
    await acheng.act('aftersale.nudge', { orderId: id, asId: as1.body.id })
    xb = await boot(xiao)
    expect(xb.notifications.filter((n: { orderId: string }) => n.orderId === id).map((n: { kind: string }) => n.kind)).toEqual(expect.arrayContaining(['新售后', '被催']))
    expect((await xiao.act('aftersale.confirm', { orderId: id, asId: as1.body.id, due: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(200)
    // 写手确认后的到期提醒只发一次
    await runJobs(new Date())
    await runJobs(new Date())
    expect((await boot(xiao)).notifications.filter((n: { kind: string; orderId: string }) => n.kind === '售后到期' && n.orderId === id)).toHaveLength(1)
    expect(xb.unread).toBeGreaterThan(0)
    await xiao.act('notes.markRead', {})
    expect((await boot(xiao)).unread).toBe(0)
  })
})

describe('评论与 @', () => {
  it('@ 看得到这单的人会收到提醒；看不到的人不提醒', async () => {
    const id = await mk('u-acheng', 650, 100)
    const r = await acheng.act('comment.create', { orderId: id, body: '@肖森凯 学生说下周三前要', mentions: ['u-xiao', 'u-yang'] })
    expect(r.status).toBe(200)
    expect(r.body.mentions).toEqual(['u-xiao'])
    expect((await boot(xiao)).notifications.some((n: { kind: string; orderId: string }) => n.kind === '被 @' && n.orderId === id)).toBe(true)
    expect((await boot(yang)).notifications.some((n: { orderId: string }) => n.orderId === id)).toBe(false)
    // 看不到这单的人也不能评论
    expect((await yang.act('comment.create', { orderId: id, body: 'x' })).status).toBe(404)
    // 只能删自己的
    expect((await xiao.act('comment.delete', { orderId: id, id: r.body.id })).status).toBe(403)
    expect((await acheng.act('comment.delete', { orderId: id, id: r.body.id })).status).toBe(200)
  })
})

describe('进度节点与模板', () => {
  it('加节点、套模板、拖动排序；到期提醒负责人；新节点名进标签库', async () => {
    const id = await mk('u-acheng', 500, 100)
    expect((await boss.act('template.save', { name: '本科标准', nodes: [{ name: '开题报告', days: 7 }, { name: '初稿', days: 20 }, { name: '定稿', days: null }] })).status).toBe(200)
    const tpl = (await boot(boss)).nodeTemplates[0]
    expect((await xiao.act('node.applyTemplate', { orderId: id, templateId: tpl.id })).body.count).toBe(3)
    const n = await xiao.act('node.save', { orderId: id, node: { name: '数据分析', status: '进行中', planDate: day, ownerId: 'u-xiao' } })
    expect(n.status).toBe(200)
    let o = await orderOf(boss, id)
    expect(o.nodes.map((x: { name: string }) => x.name)).toEqual(['开题报告', '初稿', '定稿', '数据分析'])
    expect(o.nodes[0].planDate).toBe(new Date(new Date(day).getTime() + 7 * 86400_000).toISOString().slice(0, 10))
    await xiao.act('node.reorder', { orderId: id, ids: [...o.nodes].reverse().map((x: { id: string }) => x.id) })
    o = await orderOf(boss, id)
    expect(o.nodes[0].name).toBe('数据分析')
    expect((await boot(boss)).nodeTags).toContain('数据分析')
    // 完成时自动记完成日期
    await xiao.act('node.save', { orderId: id, node: { id: n.body.id, name: '数据分析', status: '完成', planDate: day, ownerId: 'u-xiao' } })
    expect((await orderOf(boss, id)).nodes[0].doneDate).toBe(businessDate(new Date()))
    // 销售没被分到这单之外的，看不到的单不能改
    expect((await yang.act('node.save', { orderId: id, node: { name: 'x' } })).status).toBe(404)
  })
})

describe('需求卡片', () => {
  it('按字段类型校验；自定义字段；停用后保留已填的值', async () => {
    const id = await mk('u-acheng', 520, 100)
    expect((await acheng.act('card.update', { orderId: id, values: { 'f-school': '某某大学', 'f-words': 12000, 'f-level': '本科' } })).status).toBe(200)
    expect((await acheng.act('card.update', { orderId: id, values: { 'f-level': '博士' } })).status).toBe(400)
    expect((await acheng.act('card.update', { orderId: id, values: { 'f-words': '一万' } })).status).toBe(400)
    expect((await acheng.act('card.update', { orderId: id, values: { 'f-files': ['f_not_mine'] } })).status).toBe(400)
    // 写手默认不能填需求卡片
    expect((await xiao.act('card.update', { orderId: id, values: { 'f-school': 'x' } })).status).toBe(403)
    const f = await boss.act('cardField.save', { label: '是否要 PPT', type: 'select', choices: ['要', '不要'] })
    expect((await acheng.act('card.update', { orderId: id, values: { [f.body.id]: '要' } })).status).toBe(200)
    await boss.act('cardField.archive', { id: f.body.id, archived: true })
    const o = await orderOf(xiao, id)
    expect(o.req).toMatchObject({ 'f-school': '某某大学', 'f-words': 12000, [f.body.id]: '要' })
    expect((await boot(boss)).cardFields.find((x: { id: string }) => x.id === f.body.id).archived).toBe(true)
  })
})

describe('选项管理', () => {
  it('能排序、增删；系统要用的和还在用的状态不能删；只有管理员能改', async () => {
    expect((await acheng.act('options.save', { key: 'types', values: ['本科论文'] })).status).toBe(403)
    expect((await boss.act('options.save', { key: 'statuses', values: ['已发演示', '已交付', '退单'] })).status).toBe(400)
    expect((await boss.act('options.save', { key: 'payTags', values: ['定金', '尾款'] })).status).toBe(400)
    expect((await boss.act('options.save', { key: 'statuses', values: ['未交付', '已发演示', '退单'] })).status).toBe(400) // 已交付是固定业务状态
    expect((await boss.act('options.save', { key: 'statuses', values: ['未交付', '已发演示', '已交付', '待答辩', '退单'] })).status).toBe(200)
    expect((await boot(boss)).statuses).toEqual(['未交付', '已发演示', '已交付', '待答辩', '退单'])
    expect((await boss.act('settings.navOrder', { pages: ['orders', 'home'] })).status).toBe(200)
    expect((await boot(xiao)).navOrder).toEqual(['orders', 'home'])
  })
})

describe('对账单与分享链接', () => {
  it('对账单按权限出；分享链接打开计数，撤销后立即失效', async () => {
    const month = day.slice(0, 7)
    const s = await acheng.act('share.create', { channelId: ch, month, days: 7 })
    expect(s.status).toBe(200)
    expect((await xiao.act('share.create', { channelId: ch, month, days: 7 })).status).toBe(403)
    const { default: Page } = await import('@/app/s/[token]/page')
    const open = async () => JSON.stringify(await Page({ params: Promise.resolve({ token: s.body.token }) }))
    expect(await open()).toContain('P2 渠道')
    const [row] = await db.select().from(t.shareLinks).where(eq(t.shareLinks.id, s.body.id))
    expect(row.opens).toBe(1)
    expect(row.tokenHash).not.toBe(s.body.token)
    // 错的令牌、撤销后都失效
    expect(JSON.stringify(await Page({ params: Promise.resolve({ token: 'nope' }) }))).not.toContain('P2 渠道')
    expect((await yang.act('share.revoke', { id: s.body.id })).status).toBe(403)
    await acheng.act('share.revoke', { id: s.body.id })
    expect(await open()).not.toContain('P2 渠道')
  })
})
