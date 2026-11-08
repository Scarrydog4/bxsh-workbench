import ExcelJS from 'exceljs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IncomeRow } from '@/shared/income'
import type { Order } from '@/shared/types'
const h = vi.hoisted(() => ({ ctx: null as any, world: {} as any, income: {} as Record<string, any[]>, loadIncome: vi.fn(), audit: vi.fn() }))
vi.mock('@/server/session', () => ({ getCtx: async () => h.ctx }))
vi.mock('@/server/repo', () => ({ loadWorld: async () => h.world, adminIdsOf: () => new Set(['boss']) }))
vi.mock('@/server/bootstrap', () => ({ incomeRows: async (...args: any[]) => { h.loadIncome(...args); return h.income[args[1]] ?? [] } }))
vi.mock('@/server/db', () => ({ db: { insert: () => ({ values: h.audit }) } }))
import { POST } from '@/app/api/export/payroll/route'

const order = (id: string, patch: Partial<Order> = {}): Order => ({ id, title: `完整订单-${id}`, no: `DD-${id}`, orderDate: '2026-10-20', dueDate: null, channelId: 'c1', ownerId: 'sales', creatorId: 'boss', channelNo: '', wechatGroup: '', draftAt: null, type: '', basePrice: 1000, adjustments: [], assignees: [{ userId: 'writer', pay: 100 }], commissionRate: .2, status: '未交付', note: '', payments: [], attachments: [], afterSales: [], settlements: [], req: {}, nodes: [], receivables: [], reviewFlag: null, deletedAt: null, ...patch })
const income = (id: string, patch: Partial<IncomeRow> = {}): IncomeRow => ({ key: id, id, no: `DD-${id}`, title: `完整订单-${id}`, date: '2026-10-20', status: '未交付', kind: '工资', amount: 100, due: 100, paid: 30, left: 70, over: 0, suggest: 50, pay: '', ...patch })
const ref = (orderId: string, payeeId = 'writer', kind = '写手工资') => ({ orderId, payeeId, kind })
const request = (rows = [ref('o1')], columns = ['title', 'payee', 'due', 'paid', 'left', 'orderDate', 'status'], extra = {}) => POST(new Request('http://test/api/export/payroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows, columns, ...extra }) }), { params: Promise.resolve({}) })
const workbook = async (response: Response) => { const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer()); return book.worksheets[0] }
beforeEach(() => {
  h.ctx = { me: { id: 'boss', mustChangePassword: false }, role: { locked: true, perms: [], rowScope: 'all', fields: {} }, ip: 'test' }
  h.world = { orders: [order('o1'), order('o2')], users: [{ id: 'boss', name: '老板' }, { id: 'writer', name: '测试写手' }, { id: 'sales', name: '测试销售' }], channels: [{ id: 'c1', name: '测试渠道' }], batches: [] }
  h.income = { writer: [income('o1'), income('o2', { due: 125.5, paid: 25.5, left: 100 })], sales: [income('o1', { kind: '提成', due: 180, paid: 0, left: 180 })] }
})
afterEach(() => vi.clearAllMocks())

it('要求登录及工资管理、导出权限，不能绕过页面直接导出', async () => {
  h.ctx = null; expect((await request()).status).toBe(401)
  for (const perms of [['order.view', 'order.export'], ['settle.manage', 'income.all', 'order.view']]) {
    h.ctx = { me: { id: 'writer' }, role: { locked: false, perms, rowScope: 'assigned', fields: { writerPay: 'own' } } }
    expect((await request()).status).toBe(403)
  }
  expect(h.loadIncome).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled()
})

it('按客户端筛选后行序和可见列序导出，金额重算，核心字段保留且操作不导出', async () => {
  const response = await request([ref('o2'), ref('o1', 'sales', '销售提成')], ['paid', 'title', 'actions', 'due', 'payee', 'note'])
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('spreadsheetml')
  expect(decodeURIComponent(response.headers.get('content-disposition')!)).toContain('工资明细-')
  expect(response.headers.get('cache-control')).toContain('no-store')
  const sheet = await workbook(response), headers = (sheet.getRow(1).values as string[]).slice(1)
  expect(headers).toEqual(['已发', '订单名称', '应发', '收款人', '订单备注', '剩余', '下单日期', '订单状态', '收入类型'])
  expect(sheet.rowCount).toBe(3)
  expect(sheet.getRow(2).getCell(2).value).toBe('完整订单-o2')
  expect(sheet.getRow(2).getCell(1).value).toBe(25.5)
  expect(sheet.getRow(2).getCell(3).value).toBe(125.5)
  expect(sheet.getRow(3).getCell(4).value).toBe('测试销售')
  expect(sheet.getRow(3).getCell(3).value).toBe(180)
  expect(sheet.getColumn(1).numFmt).toBe('¥#,##0.00')
  expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  expect(sheet.autoFilter).toBeTruthy()
  expect(h.loadIncome.mock.calls.map(call => call[1])).toEqual(['writer', 'sales'])
  expect(h.audit).toHaveBeenCalledOnce()
})

it('未知应发剩余显示待定，缺失日期不冒充今天；本人批次不混入其他人/类型/作废', async () => {
  h.income.writer = [income('o1', { amount: null, due: null, paid: 0, left: 0, suggest: undefined })]
  h.world.orders[0].orderDate = ''; h.world.orders[0].assignees[0].pay = null
  const record = { id: 'legacy', kind: '写手工资', payeeId: 'writer', orderId: 'o1', status: '已确认', amount: 30, confirmedAt: null }
  h.world.orders[0].settlements = [record, { ...record, id: 'void', status: '已作废' }]
  const batch = { id: 'ok', payeeId: 'writer', kind: '写手工资', status: '已确认', confirmedAt: '2026-10-15T16:30:00Z', lines: [{ orderId: 'o1', amount: 20 }] }
  h.world.batches = [batch, { ...batch, id: 'foreign', payeeId: 'sales' }, { ...batch, id: 'commission', kind: '销售提成' }, { ...batch, id: 'void', status: '已作废' }]
  const sheet = await workbook(await request([ref('o1')], ['due', 'left', 'paid', 'orderDate', 'paidRecords', 'paidDate']))
  expect(sheet.getRow(2).getCell(1).value).toBe('待定')
  expect(sheet.getRow(2).getCell(2).value).toBe('待定')
  expect(sheet.getRow(2).getCell(3).value).toBe(0)
  expect(sheet.getRow(2).getCell(4).value || '').toBe('')
  expect(sheet.getRow(2).getCell(5).value).toBe(2)
  expect(sheet.getRow(2).getCell(6).value).toBe('2026-10-16')
  expect(sheet.getRow(2).getCell(6).note).toBeTruthy()
})

it('伪造工资行、收款人、类型或超出行权限整体拒绝，不部分导出', async () => {
  for (const rows of [[ref('foreign')], [ref('o1', 'unknown')], [ref('o1', 'writer', '销售提成')]]) expect((await request(rows)).status).toBe(403)
  h.ctx.role = { locked: false, rowScope: 'owned', perms: ['settle.manage', 'income.all', 'order.view', 'order.export'], fields: { writerPay: 'all', commission: 'all' } }
  expect((await request()).status).toBe(403)
  expect(h.audit).not.toHaveBeenCalled()
})

it('受限管理账号的公司金额按投影遮蔽，不能借自定义列读原始利润', async () => {
  h.ctx.role = { locked: false, rowScope: 'all', perms: ['settle.manage', 'income.all', 'order.view', 'order.export'], fields: { writerPay: 'all', commission: 'all', profit: false, sales: false, channelNo: false } }
  const sheet = await workbook(await request([ref('o1')], ['sales', 'bossIncome', 'extraCostTotal', 'channelNo', 'due']))
  for (const index of [1, 2, 3, 4]) expect(sheet.getRow(2).getCell(index).value || '').toBe('')
  expect(sheet.getRow(2).getCell(5).value).toBe(100)
})

it('拒绝空导出、重复行以及客户端金额字段，未更改或写入工资记录', async () => {
  expect((await request([])).status).toBe(400)
  expect((await request([ref('o1'), ref('o1')])).status).toBe(400)
  expect((await request([{ ...ref('o1'), paid: 999 } as any])).status).toBe(400)
  const before = structuredClone(h.world)
  await request()
  expect(h.world).toEqual(before)
  expect(h.audit).toHaveBeenCalledOnce()
})
