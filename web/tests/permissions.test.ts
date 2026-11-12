/**
 * 权限矩阵：用管理员、销售、写手、自定义角色的账号直接调接口，
 * 确认拿不到不该看的字段和订单、做不了不该做的事，并且改动都有留痕。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { sql } from '@/server/db'
import { deliveryProof, as, closeDb, loginAs, resetDb, PW, type Client } from './helpers'

let boss: Client, acheng: Client, yang: Client, xiao: Client
const ids: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' }
const ch: Record<string, string> = {}

// 字段组 → 订单视图里的键
const SALES_KEYS = ['basePrice', 'adjustments', 'sales', 'received', 'unpaid', 'payStatus', 'payments']
const day = new Date().toISOString().slice(0, 10)

beforeAll(async () => {
  await resetDb()
  boss = await as('boss')
  acheng = await as('acheng')
  yang = await as('xiaoyang')
  xiao = await as('xiaosenkai')

  for (const [k, owner] of [['c1', 'u-acheng'], ['c2', 'u-yang'], ['c3', 'u-boss']] as const) {
    const r = await boss.act('channel.create', { name: `渠道${k}`, ownerId: owner })
    ch[k] = r.body.id
  }
  const mk = async (ownerId: string, channelId: string, basePrice: number, assignees: { userId: string; pay: number | null }[], extra: object = {}) =>
    (await boss.act('order.create', { title: `测试单 ${basePrice}`, orderDate: day, dueDate: null, ownerId, channelId, basePrice, assignees: assignees.map(a => ({ ...a, rate: null })), channelNo: 'CH-001', type: '本科论文', note: '', ...extra })).body.id as string
  ids.A = await mk('u-acheng', ch.c1, 1000, [{ userId: 'u-xiao', pay: 300 }])
  ids.B = await mk('u-yang', ch.c2, 800, [{ userId: 'u-xiao', pay: null }])
  ids.C = await mk('u-boss', ch.c3, 500, [{ userId: 'u-xiao', pay: 100 }])
  // D：老板自己写（先给老板打开「可当写手」），写手看不到这单
  await boss.act('user.update', { id: 'u-boss', patch: { canWrite: true } })
  ids.D = await mk('u-acheng', ch.c1, 600, [{ userId: 'u-boss', pay: 0 }])
  // 历史飞书单用于字段权限回归；新单的比例在 writer-rates-api 中覆盖。
  await sql`update orders set allocation_policy='legacy', commission_rate=0.5, writer_rates_enabled=false`
  await boss.act('order.addAdjustment', { id: ids.A, amount: 200, reason: '加急' })
  await boss.act('order.addPayment', { id: ids.A, amount: 1200, date: day, tag: '全款', note: '' })
  await boss.act('order.addPayment', { id: ids.B, amount: 400, date: day, tag: '定金', note: '' })
})

afterAll(closeDb)

const orderOf = (boot: { orders: { id: string }[] }, id: string) => boot.orders.find((o) => o.id === id) as Record<string, unknown> | undefined

describe('看得到哪些订单（行范围）', () => {
  it('管理员看全部', async () => {
    const { body } = await boss.boot()
    expect(body.orders.map((o: { id: string }) => o.id).sort()).toEqual(Object.values(ids).sort())
  })
  it('销售只看归属自己的', async () => {
    expect((await acheng.boot()).body.orders.map((o: { id: string }) => o.id).sort()).toEqual([ids.A, ids.D].sort())
    expect((await yang.boot()).body.orders.map((o: { id: string }) => o.id)).toEqual([ids.B])
  })
  it('写手只看自己写的', async () => {
    expect((await xiao.boot()).body.orders.map((o: { id: string }) => o.id).sort()).toEqual([ids.A, ids.B, ids.C].sort())
  })
})

describe('看得到哪些字段（接口返回前就裁掉）', () => {
  it('管理员：所有金额都有，计算和飞书规则一致', async () => {
    const a = orderOf((await boss.boot()).body, ids.A)!
    expect(a.sales).toBe(1200)
    expect(a.writerTotal).toBe(300)
    expect(a.commission).toBe(450) // (1200 - 300) × 50%
    expect(a.profit).toBe(450)
    expect(a.unpaid).toBe(0)
    expect(a.payStatus).toBe('已收齐')
    const c = orderOf((await boss.boot()).body, ids.C)!
    expect(c.commission).toBe(0) // 自营不计提成
    expect(c.profit).toBe(400) // 自营：销售额 - 写手工资
  })
  it('写手工资没定时，合计、提成、利润都标「待定」', async () => {
    const b = orderOf((await boss.boot()).body, ids.B)!
    expect(b.payPending).toBe(true)
  })
  it('销售：有销售额和收款，没有写手工资和利润；提成只看自己的', async () => {
    const a = orderOf((await acheng.boot()).body, ids.A)!
    for (const k of SALES_KEYS) expect(a[k], k).toBeDefined()
    expect(a.channelNo).toBe('CH-001')
    expect(a.writerTotal).toBeUndefined()
    expect(a.profit).toBeUndefined()
    expect(a.myPay).toBeUndefined()
    expect((a.assignees as { pay?: number }[]).every((x) => x.pay === undefined)).toBe(true)
    expect(a.commission).toBe(450)
  })
  it('写手：没有任何总价、收款、提成、利润、渠道单号，只有自己的工资', async () => {
    const { body } = await xiao.boot()
    for (const id of [ids.A, ids.B, ids.C]) {
      const o = orderOf(body, id)!
      for (const k of [...SALES_KEYS, 'writerTotal', 'commission', 'commissionRate', 'profit', 'channelNo']) expect(o[k], `${id} ${k}`).toBeUndefined()
    }
    expect(orderOf(body, ids.A)!.myPay).toBe(300)
    expect(orderOf(body, ids.B)!.myPay).toBeNull()
    // 整个返回体里都不能出现订单总价
    expect(JSON.stringify(body.orders)).not.toMatch(/"(sales|basePrice|received|unpaid|profit)"/)
  })
  it('写手拿不到审计日志、回收站和别人的收入', async () => {
    const { body } = await xiao.boot()
    expect(body.audit).toEqual([])
    expect(body.trash).toEqual([])
    expect(Object.keys(body.income)).toEqual(['u-xiao'])
  })
})

describe('订单「动态」也按权限过滤', () => {
  it('写手看不到改价、收款记录', async () => {
    const r = await xiao.activity(ids.A)
    expect(r.status).toBe(200)
    const actions = r.body.map((a: { action: string; field?: string }) => `${a.action}:${a.field ?? ''}`)
    expect(actions.some((x: string) => x.startsWith('追加') || x.startsWith('记收款'))).toBe(false)
  })
  it('销售看得到自己单的改价和收款', async () => {
    const actions = (await acheng.activity(ids.A)).body.map((a: { action: string }) => a.action)
    expect(actions).toContain('追加')
    expect(actions).toContain('记收款')
  })
  it('看不到的单，动态也拿不到', async () => {
    expect((await acheng.activity(ids.B)).status).toBe(404)
    expect((await xiao.activity(ids.D)).status).toBe(404)
  })
})

describe('能做什么（动作权限）', () => {
  it('写手不能改状态、记收款、导出、录单、建渠道、改角色', async () => {
    expect((await xiao.act('order.update', { id: ids.A, patch: { status: '已交付' } })).status).toBe(403)
    expect((await xiao.act('order.addPayment', { id: ids.A, amount: 1, date: day, tag: '定金' })).status).toBe(403)
    expect((await xiao.exportXlsx()).status).toBe(403)
    expect((await xiao.act('order.create', { title: 'x', orderDate: day, dueDate: null, ownerId: 'u-xiao', channelId: ch.c1, basePrice: 1 })).status).toBe(403)
    expect((await xiao.act('channel.create', { name: '新渠道', ownerId: 'u-boss' })).status).toBe(403)
    expect((await xiao.act('role.save', { name: 'x', perms: [], fields: { sales: true, writerPay: 'all', commission: 'all', profit: true, channelNo: true }, rowScope: 'all' })).status).toBe(403)
  })
  it('看不到的单，改也改不了（返回找不到，不泄露它存在）', async () => {
    expect((await xiao.act('order.markDraft', { id: ids.D })).status).toBe(404)
    expect((await acheng.act('order.update', { id: ids.B, patch: { title: '改别人的单' } })).status).toBe(404)
  })
  it('写手附截图确认交付，状态直接变成已交付', async () => {
    expect((await xiao.act('order.markDraft', { id: ids.A, proofIds: await deliveryProof(xiao, ids.A) })).status).toBe(200)
    const a = orderOf((await boss.boot()).body, ids.A)!
    expect(a.status).toBe('已交付')
    expect(a.draftAt).toBeTruthy()
  })
  it('写手可以开一轮修改，但只能算正常修改；返工 / 新增需求要管理员定', async () => {
    const due = new Date(Date.now() + 86400_000).toISOString()
    expect((await xiao.act('aftersale.create', { orderId: ids.A, reason: '写手返工', req: ['x'], due })).status).toBe(403)
    const ok = await xiao.act('aftersale.create', { orderId: ids.A, req: ['第三章补图'], due })
    expect(ok.status).toBe(200)
    expect((await xiao.act('aftersale.create', { orderId: ids.A, req: ['再开一轮'], due })).status).toBe(400) // 上一轮没改完
    expect((await acheng.act('aftersale.reason', { orderId: ids.A, asId: ok.body.id, reason: '写手返工' })).status).toBe(403)
    expect((await boss.act('aftersale.reason', { orderId: ids.A, asId: ok.body.id, reason: '写手返工' })).status).toBe(200)
    expect((await acheng.act('aftersale.finish', { orderId: ids.A, asId: ok.body.id })).status).toBe(403) // 只有负责的写手能点
    expect((await xiao.act('aftersale.finish', { orderId: ids.A, asId: ok.body.id, proofIds: await deliveryProof(xiao, ids.A, ok.body.id) })).status).toBe(200)
  })
  it('销售录单：归属强制是自己，工资由服务端套用默认比例', async () => {
    const r = await acheng.act('order.create', { title: '销售录的单', orderDate: day, dueDate: null, ownerId: 'u-yang', channelId: ch.c1, basePrice: 900, assignees: [{ userId: 'u-xiao', pay: null }] })
    expect(r.status).toBe(200)
    const o = orderOf((await boss.boot()).body, r.body.id)!
    expect(o.ownerId).toBe('u-acheng')
    expect(o.assignees).toEqual([{ userId: 'u-xiao', pay: 180, rate: .2 }])
  })
  it('销售不能定写手、改归属', async () => {
    expect((await acheng.act('order.setWriters', { id: ids.A, writers: [{ userId: 'u-xiao', pay: 9999 }] })).status).toBe(403)
    expect((await acheng.act('order.update', { id: ids.A, patch: { ownerId: 'u-yang' } })).status).toBe(403)
  })
  it('写手名单只能选「可当写手」的人', async () => {
    expect((await boss.act('order.setWriters', { id: ids.A, writers: [{ userId: 'u-yang', pay: 1 }] })).status).toBe(400)
  })
  it('归属销售不能是写手', async () => {
    expect((await boss.act('order.update', { id: ids.A, patch: { ownerId: 'u-xiao' } })).status).toBe(400)
  })
})

describe('导出 Excel 按权限裁列', () => {
  it('销售导出的表里没有写手工资和利润', async () => {
    const r = await acheng.exportXlsx()
    expect(r.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(r.buf as unknown as ArrayBuffer)
    const head = (wb.worksheets[0].getRow(1).values as unknown[]).slice(1).map(String)
    expect(head).toContain('应收金额')
    expect(head).not.toContain('写手工资')
    expect(head).not.toContain('预计利润')
    const sheet = wb.worksheets[0], exported: string[] = []
    const noColumn = head.indexOf('订单编号') + 1, titleColumn = head.indexOf('订单名称') + 1
    sheet.eachRow((row,n) => { if(n > 1 && /^DD\d/.test(String(row.getCell(noColumn).value))) exported.push(String(row.getCell(titleColumn).value)) })
    expect(exported.sort()).toEqual((await acheng.boot()).body.orders.map((o:any)=>o.title).sort())
  })
})

describe('附件：分片续传、按订单权限下载', () => {
  it('写手能给自己的单传文件；偏移量错了会被拒绝，按进度续传', async () => {
    const data = Buffer.from('论文第二稿'.repeat(1000))
    const r = await xiao.upload(ids.A, '第二稿.docx', data)
    expect(r.wrongOffsetStatus).toBe(409)
    expect(r.status).toBe(200)
    const got = await acheng.file(r.body.id)
    expect(got.status).toBe(200)
    expect(got.buf!.equals(data)).toBe(true)
    expect((await yang.file(r.body.id)).status).toBe(404) // 不是她的单
  })
  it('看不到的单不能传', async () => {
    expect((await xiao.upload(ids.D, 'x.txt', Buffer.from('x'))).status).toBe(404)
  })
})

describe('自定义角色立即生效', () => {
  it('新建「助理」角色 → 建账号 → 首次登录先改密码 → 看得到销售额、看不到写手工资；改角色后马上变', async () => {
    const fields = { sales: true, writerPay: 'none', commission: 'none', profit: false, channelNo: false }
    const role = await boss.act('role.save', { name: '助理', perms: ['order.view'], fields, rowScope: 'all' })
    expect(role.status).toBe(200)
    const u = await boss.act('user.create', { name: '小助理', account: 'zhuli', roleId: role.body.id, canWrite: false })
    expect(u.status).toBe(200)
    const first = await as('zhuli', u.body.tempPassword)
    expect((await first.boot()).status).toBe(403) // 首次登录必须先改密码
    expect((await first.changePassword(u.body.tempPassword, PW)).status).toBe(200)
    const z = await as('zhuli')
    let a = orderOf((await z.boot()).body, ids.A)!
    expect(a.sales).toBe(1200)
    expect(a.writerTotal).toBeUndefined()
    expect((await z.boot()).body.orders.length).toBeGreaterThanOrEqual(4)
    // 管理员把「销售额与收款」关掉，不用重新登录，下一次请求就生效
    await boss.act('role.save', { id: role.body.id, name: '助理', perms: ['order.view'], fields: { ...fields, sales: false }, rowScope: 'all' })
    a = orderOf((await z.boot()).body, ids.A)!
    expect(a.sales).toBeUndefined()
    expect(a.payments).toBeUndefined()
  })
})

describe('留痕', () => {
  it('每次改动都记了谁、哪个字段、旧值、新值', async () => {
    await boss.act('order.update', { id: ids.C, patch: { title: '改过名字的测试单' } })
    const { body } = await boss.boot()
    const e = body.audit.find((a: { objectId?: string; field?: string }) => a.objectId === ids.C && a.field === '订单名称')
    expect(e).toMatchObject({ actorId: 'u-boss', action: '修改', from: '测试单 500', to: '改过名字的测试单' })
  })
})

describe('账号安全', () => {
  it('连续输错 5 次锁定，锁定期间密码对了也进不去', async () => {
    for (let i = 0; i < 5; i++) expect((await loginAs('xiaoyang', 'wrong-password-1')).status).toBe(401)
    expect((await loginAs('xiaoyang', PW)).status).toBe(429)
  })
})
