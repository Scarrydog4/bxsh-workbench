import ExcelJS from 'exceljs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CHANNEL_PAYMENT_CATEGORIES, channelExportData, channelExportScopeLabel, channelPaymentCategory, channelPaymentState, exportColumns, exportScopeOrders, type ChannelExportScope } from '@/shared/channel-export'
import { project } from '@/shared/perm'
import type { Order, Payment, Role, User } from '@/shared/types'

const h = vi.hoisted(() => ({ ctx: null as any, world: {} as any, audit: vi.fn() }))
vi.mock('@/server/session', () => ({ getCtx: async () => h.ctx }))
vi.mock('@/server/repo', () => ({ loadWorld: async () => h.world, adminIdsOf: () => new Set(['boss']) }))
vi.mock('@/server/db', () => ({ db: { insert: () => ({ values: h.audit }) } }))
import { POST } from '@/app/api/export/channel/route'

const order = (id: string, patch: Partial<Order> = {}): Order => ({ id, title: `订单-${id}`, no: `DD-${id}`, orderDate: '2026-10-20', dueDate: null, channelId: 'c1', ownerId: 'sales', creatorId: 'boss', channelNo: `渠道单号-${id}`, wechatGroup: '', draftAt: null, type: '', basePrice: 1000, adjustments: [], assignees: [{ userId: 'writer', pay: 100 }], commissionRate: .2, status: '未交付', note: `内部订单备注-${id}`, payments: [], attachments: [], afterSales: [], settlements: [], req: {}, nodes: [], receivables: [], reviewFlag: null, deletedAt: null, ...patch })
const payment = (id: string, amount: number, patch: Partial<Payment> = {}): Payment => ({ id, amount, date: '2026-10-21', tag: '定金', note: `内部收款备注-${id}`, by: 'sales', ...patch })
const role = (patch: Partial<Role> = {}): Role => ({ id: 'sales-role', name: '销售', locked: false, preset: false, perms: ['order.view', 'order.export', 'channel.view'], rowScope: 'owned', fields: { sales: true, channelNo: true, writerPay: 'none', commission: 'none', profit: false }, ...patch })
const views = (orders: Order[]) => orders.map(o => ({ ...project(o, { id: 'boss' } as User, { locked: true } as Role, new Set(['boss'])), marker: o.id }))
const request = (extra: Record<string, unknown> = {}) => POST(new Request('http://test/api/export/channel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channelId: 'c1', columns: ['title', 'paymentState', 'sales', 'received', 'unpaid'], language: 'zh', ...extra }) }), { params: Promise.resolve({}) })
const workbook = async (response: Response) => { const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer()); return book }
const row = (sheet: ExcelJS.Worksheet, index: number) => {
  const headers=(sheet.getRow(1).values as unknown[]).slice(1), gap=headers.findIndex(value=>value==null)
  return (sheet.getRow(index).values as unknown[]).slice(1,gap<0 ? undefined : gap+1)
}
const fillColor = (cell: ExcelJS.Cell) => cell.fill?.type==='pattern' ? cell.fill.fgColor?.argb : undefined

beforeEach(() => {
  h.ctx = { me: { id: 'boss', mustChangePassword: false }, role: { locked: true, perms: [], rowScope: 'all', fields: {} }, ip: 'test' }
  h.world = { orders: [
    order('none'),
    order('partial', { payments: [payment('deposit', 300)] }),
    order('full', { payments: [payment('full', 1000)] }),
    order('extra', { payments: [payment('extra', 1200)] }),
    order('return', { status: '退单', payments: [payment('return', 200)] }),
    order('cost', { salesMode: 'cost' }),
    order('deleted', { deletedAt: '2026-10-21T00:00:00Z' }),
    order('other-channel', { channelId: 'c2' }),
    order('hidden', { ownerId: 'other' }),
  ], channels: [{ id: 'c1', name: '测试渠道', ownerId: 'sales' }, { id: 'c2', name: '其他渠道', ownerId: 'other' }] }
})
afterEach(() => vi.clearAllMocks())

it('共用范围按有效净收款区分定金与尾款，退款和撤销重算，退单优先且不改变原数组', () => {
  const source = views([
    order('none'), order('partial', { payments: [payment('p', 100)] }),
    order('refunded', { payments: [payment('p', 100), payment('r', 100, { tag: '退款' })] }),
    order('revoked', { payments: [payment('p', 100, { revoked: { at: '2026-10-21', by: 'boss', reason: '记错' } })] }),
    order('full', { payments: [payment('p', 1000)] }), order('extra', { payments: [payment('p', 1200)] }),
    order('return', { status: '退单', payments: [payment('p', 100)] }), order('zero', { basePrice: 0 }),
  ])
  const original = source.map(o => o.id)
  const selected = (scope: ChannelExportScope) => exportScopeOrders(source, scope).map(o => o.marker).sort()
  expect(selected('unpaid')).toEqual(['none', 'partial', 'refunded', 'revoked'])
  expect(selected('no_deposit')).toEqual(['none', 'refunded', 'revoked'])
  expect(selected('balance')).toEqual(['partial'])
  expect(selected('paid')).toEqual(['extra', 'full', 'zero'])
  expect(selected('all')).toHaveLength(8)
  expect(source.map(o => channelPaymentState(o))).toEqual(['未收定金', '未付尾款', '未收定金', '未收定金', '已收齐', '已收齐', '退单', '已收齐'])
  expect(source.map(o => o.id)).toEqual(original)
})

it('全部订单自动附收款情况并按相同分类上色，右侧图例清晰且不改变真实金额或业务筛选范围', async () => {
  const sheet=(await workbook(await request({ scope:'all', orderIds:['none','partial','full','extra','return'], columns:['title','sales','received','unpaid'], includeReceipts:false }))).worksheets[0]
  expect(row(sheet,1)).toEqual(['订单名称','收款情况','应收','已收','未收'])
  const expected = [
    ['订单-return','退单',1000,200,800],
    ['订单-partial','未付尾款',1000,300,700],
    ['订单-none','未收定金',1000,0,1000],
    ['订单-full','已收齐',1000,1000,0],
    ['订单-extra','已收齐',1000,1200,-200],
  ]
  for (const [index,values] of expected.entries()) {
    const rowNumber=index+2, source=h.world.orders.find((o:Order)=>`订单-${o.id}`===values[0])
    const category=channelPaymentCategory(views([source])[0])
    expect(row(sheet,rowNumber)).toEqual(values)
    expect(category.label).toBe(values[1])
    for(let column=1;column<=5;column++) expect(fillColor(sheet.getCell(rowNumber,column))).toBe(`FF${category.background.slice(1)}`)
    expect(sheet.getCell(rowNumber,2).font).toMatchObject({bold:true,color:{argb:`FF${category.color.slice(1)}`}})
  }
  expect(row(sheet,7)).toEqual(['有效订单合计（4单）','',4000,2500,1700])
  expect(row(sheet,8)).toEqual(['退单合计（1单）','',1000,200,800])
  for(let column=1;column<=5;column++) {
    expect(fillColor(sheet.getCell(1,column))).toBe('FF19715E')
    for(const rowNumber of [7,8]) expect(fillColor(sheet.getCell(rowNumber,column))).toBeUndefined()
  }
  expect(sheet.getCell(1,7).value).toBe('收款分类')
  expect(sheet.getCell(1,8).value).toBe('说明')
  for(const [index,category] of CHANNEL_PAYMENT_CATEGORIES.entries()) {
    expect(sheet.getCell(index+2,7).value).toBe(category.label)
    expect(sheet.getCell(index+2,8).value).toBe(category.description)
    expect(fillColor(sheet.getCell(index+2,7))).toBe(`FF${category.background.slice(1)}`)
  }
  expect(sheet.autoFilter).toBe('A1:E1')
  expect(sheet.views[0]).toMatchObject({state:'frozen',ySplit:1,xSplit:1})
  expect(sheet.getCell(1,6).value).toBeNull()
})

it('双语表头与少量订单的合计不被旁边图例覆盖，其他导出范围不强制分类或上色', async () => {
  const all=(await workbook(await request({ scope:'all',orderIds:['partial'],columns:['title'],language:'both',includeReceipts:false }))).worksheets[0]
  expect(row(all,1)).toEqual(['订单名称','收款情况'])
  expect(row(all,2)).toEqual(['Order Title','Payment Status'])
  expect(row(all,3)).toEqual(['订单-partial','未付尾款'])
  expect(row(all,4)).toEqual(['有效订单合计（1单）',''])
  expect(row(all,5)).toEqual(['退单合计（0单）',''])
  expect(all.getCell(2,4).value).toBe('Payment Category')
  for(const rowNumber of [4,5]) expect(fillColor(all.getCell(rowNumber,1))).toBeUndefined()
  expect(all.autoFilter).toBe('A2:B2')
  expect(all.views[0]).toMatchObject({state:'frozen',ySplit:2,xSplit:1})
  for(const scope of ['unpaid','no_deposit','balance','paid'] as const) {
    const single=(await workbook(await request({scope,columns:['title'],includeReceipts:false}))).worksheets[0]
    expect(row(single,1)).toEqual(['订单名称'])
    expect(single.columnCount).toBe(1)
    expect(fillColor(single.getCell(2,1))).toBeUndefined()
  }
})

it('只导出勾选订单和字段，未付表头为待补金额，关闭收款明细时文件中没有内部备注', async () => {
  const response = await request({ scope: 'unpaid', orderIds: ['partial'], includeReceipts: false, columns: ['title', 'paymentState', 'sales', 'received', 'unpaid', 'note'] })
  expect(response.status).toBe(200)
  expect(decodeURIComponent(response.headers.get('content-disposition')!)).toContain(`测试渠道-${channelExportScopeLabel('unpaid')}-`)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const book = await workbook(response), sheet = book.worksheets[0]
  expect(book.worksheets.map(s => s.name)).toEqual(['订单汇总'])
  expect(row(sheet, 1)).toEqual(['订单名称', '收款情况', '应收', '已收', '待补金额'])
  expect(row(sheet, 2)).toEqual(['订单-partial', '未付尾款', 1000, 300, 700])
  expect(row(sheet, 3)).toEqual(['有效订单合计（1单）', '', 1000, 300, 700])
  expect(sheet.rowCount).toBe(4)
  expect(JSON.stringify(book.model)).not.toContain('内部')
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ objectLabel: '测试渠道 · 1 单' }))
})

it('两种未付范围的Excel行与合计一致，未收定金列仍是全单真实未收金额', async () => {
  h.world.orders = [order('none'), order('refund', { payments: [payment('refund', 30, { tag: '退款' })] }), order('partial', { payments: [payment('deposit', 300)] }), order('return', { status: '退单' })]
  for (const [scope, expected, total] of [
    ['no_deposit', [['订单-refund', '未收定金', 1000, -30, 1030], ['订单-none', '未收定金', 1000, 0, 1000]], [2000, -30, 2030]],
    ['balance', [['订单-partial', '未付尾款', 1000, 300, 700]], [1000, 300, 700]],
  ] as const) {
    const sheet = (await workbook(await request({ scope, includeReceipts: false }))).worksheets[0]
    expect(expected.map((_, index) => row(sheet, index + 2))).toEqual(expected)
    expect(row(sheet, expected.length + 2)).toEqual([`有效订单合计（${expected.length}单）`, '', ...total])
    expect(sheet.rowCount).toBe(expected.length + 3)
  }
})

it('多收不冲抵其他订单的欠款，金额按分汇总，退单单列且不混入有效订单', async () => {
  h.world.orders = [order('due', { basePrice: 100.1 }), order('due2', { basePrice: .2 }), order('extra', { basePrice: 100, payments: [payment('extra', 190.2)] }), order('return', { status: '退单', basePrice: 999 })]
  const data = channelExportData(views(h.world.orders))
  expect(data.live).toEqual({ n: 3, sales: 200.3, received: 190.2, unpaid: 100.3 })
  const sheet = (await workbook(await request({ includeReceipts: false }))).worksheets[0]
  expect(row(sheet, 6)).toEqual(['有效订单合计（3单）', '', 200.3, 190.2, 100.3])
  expect(row(sheet, 7)).toEqual(['退单合计（1单）', '', 999, 0, 999])
})

it('已收齐范围包括多收订单，保留该单真实负未收，总待收仍为零', async () => {
  const sheet = (await workbook(await request({ scope: 'paid', orderIds: ['full', 'extra'], includeReceipts: false }))).worksheets[0]
  expect(row(sheet, 2)).toEqual(['订单-full', '已收齐', 1000, 1000, 0])
  expect(row(sheet, 3)).toEqual(['订单-extra', '已收齐', 1000, 1200, -200])
  expect(row(sheet, 4)).toEqual(['有效订单合计（2单）', '', 2000, 2200, 0])
  expect(sheet.rowCount).toBe(5)
})

it('旧客户端缺省仍导全部可见订单并附收款表；显式收款明细只含所选订单且排除撤销', async () => {
  h.ctx = { ...h.ctx, me: { id: 'sales' }, role: role() }
  const legacy = await workbook(await request())
  expect(legacy.worksheets.map(s => s.name)).toEqual(['订单汇总', '逐笔收款'])
  expect(legacy.worksheets[0].rowCount).toBe(8)
  expect(row(legacy.worksheets[0], 1)[4]).toBe('未收')
  const selected = h.world.orders.find((o: Order) => o.id === 'partial')
  selected.payments.push(payment('refund', 50, { tag: '退款' }), payment('revoked', 900, { revoked: { at: '2026-10-21', by: 'boss', reason: '记错' } }))
  const book = await workbook(await request({ scope: 'balance', orderIds: ['partial'], includeReceipts: true, language: 'both' }))
  const main = book.worksheets[0], receipts = book.worksheets[1]
  expect(row(main, 2)).toEqual(['Order Title', 'Payment Status', 'Amount Due', 'Received', 'Outstanding'])
  expect(row(main, 3)).toEqual(['订单-partial', '未付尾款', 1000, 250, 750])
  expect(receipts.rowCount).toBe(4)
  expect([row(receipts, 3), row(receipts, 4)]).toEqual([
    ['订单-partial', '2026-10-21', '定金', 300, '内部收款备注-deposit'],
    ['订单-partial', '2026-10-21', '退款', -50, '内部收款备注-refund'],
  ])
})

it('无销售额权限无法按收款范围筛选，全部范围只导授权列并且没有收款表', async () => {
  h.ctx = { ...h.ctx, me: { id: 'sales' }, role: role({ fields: { sales: false, channelNo: false, writerPay: 'none', commission: 'none', profit: false } }) }
  for (const scope of ['unpaid', 'no_deposit', 'balance', 'paid']) expect((await request({ scope })).status).toBe(403)
  expect(h.audit).not.toHaveBeenCalled()
  const book = await workbook(await request({ orderIds: ['partial'], includeReceipts: true, columns: ['title', 'channelNo', 'paymentState', 'sales', 'received', 'unpaid'] }))
  expect(book.worksheets.map(s => s.name)).toEqual(['订单汇总'])
  expect(row(book.worksheets[0], 1)).toEqual(['订单名称'])
  expect(row(book.worksheets[0], 2)).toEqual(['订单-partial'])
  expect(book.worksheets[0].columnCount).toBe(1)
  expect(fillColor(book.worksheets[0].getCell(2,1))).toBeUndefined()
  for(const category of CHANNEL_PAYMENT_CATEGORIES) {
    expect(row(book.worksheets[0],2)).not.toContain(category.label)
    expect(JSON.stringify(book.model)).not.toContain(category.description)
  }
  expect(JSON.stringify(book.model)).not.toContain('内部收款备注')
  expect((await request({ columns: ['sales', 'paymentState', 'channelNo'] })).status).toBe(400)
})

it('伪造、跨渠道、删除、成本单、不可见及范围已改变的勾选统一拒绝，不部分导出或泄露订单', async () => {
  h.ctx = { ...h.ctx, me: { id: 'sales' }, role: role() }
  const responses: unknown[] = []
  for (const id of ['unknown', 'other-channel', 'deleted', 'cost', 'hidden', 'full', 'return']) {
    const response = await request({ scope: 'unpaid', orderIds: ['none', id] })
    expect(response.status).toBe(400)
    responses.push(await response.json())
  }
  h.world.orders.find((o: Order) => o.id === 'none').payments.push(payment('now-paid', 1000))
  const changed = await request({ scope: 'no_deposit', orderIds: ['none'] })
  expect(changed.status).toBe(400)
  responses.push(await changed.json())
  expect(new Set(responses.map(r => JSON.stringify(r))).size).toBe(1)
  expect(h.audit).not.toHaveBeenCalled()
})

it('登录、三个动作权限和渠道归属均在后端检查', async () => {
  h.ctx = null
  expect((await request()).status).toBe(401)
  for (const missing of ['order.view', 'order.export', 'channel.view']) {
    h.ctx = { me: { id: 'sales' }, role: role({ perms: role().perms.filter(p => p !== missing) }) }
    expect((await request()).status).toBe(403)
  }
  h.ctx = { me: { id: 'sales' }, role: role({ rowScope: 'all' }) }
  expect((await request({ channelId: 'c2' })).status).toBe(404)
  h.world.channels[0].deletedAt = '2026-10-21'
  expect((await request()).status).toBe(404)
  expect(h.audit).not.toHaveBeenCalled()
})

it('拒绝空选择、重复ID和错误参数；空范围不产生空文件', async () => {
  expect(exportColumns(['unknown'],true,true,'all')).toEqual([])
  expect(exportColumns(['channelNo'],true,false,'all')).toEqual([])
  for (const extra of [{ orderIds: [] }, { orderIds: ['none', 'none'] }, { orderIds: [''] }, { scope: 'invalid' }, { includeReceipts: 'yes' }, { columns: [] }, { columns: ['unknown'] }]) expect((await request(extra)).status).toBe(400)
  h.world.orders = [order('none')]
  expect((await request({ scope: 'paid' })).status).toBe(400)
  expect(h.audit).not.toHaveBeenCalled()
})
