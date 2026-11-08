import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ ctx: null as any, world: {} as any, rows: [] as any[], payouts: [] as any[], income: vi.fn() }))
vi.mock('@/server/session', () => ({ getCtx: async () => h.ctx }))
vi.mock('@/server/repo', () => ({ loadWorld: async () => h.world }))
vi.mock('@/server/bootstrap', () => ({ incomeRows: (...args: any[]) => { h.income(...args); return h.rows } }))
vi.mock('@/server/db', () => ({ db: { select: () => ({ from: () => ({ where: async () => h.payouts }) }) } }))
import { GET } from '@/app/api/reports/personal-income/route'

const get = (query = '') => GET(new Request(`http://test/api/reports/personal-income?from=2026-10-01&to=2026-10-31${query}`), { params: Promise.resolve({}) })
beforeEach(() => {
  h.ctx = { me: { id: 's1', mustChangePassword: false }, role: { locked: false, rowScope: 'owned', perms: ['order.view', 'order.create'], fields: { writerPay: 'none', commission: 'own' } } }
  h.world = { channels: [{ id: 'c1', name: '本人渠道' }, { id: 'private', name: '其他销售渠道' }], orders: [
    { id: 'o1', ownerId: 's1', assignees: [], orderDate: '2026-10-10', channelId: 'c1' },
    { id: 'private-order', ownerId: 's2', assignees: [], orderDate: '2026-10-10', channelId: 'private', bossIncome: 9999 },
  ] }
  h.rows = [{ key: 'o1:comm', id: 'o1', no: 'DD1', title: '本人订单', status: '未交付', date: '2026-10-10', kind: '提成', amount: 100, left: 80 }]
  h.payouts = [{ id: 'p1', orderId: 'o1', kind: '销售提成', amount: 20, at: '2026-10-12T00:00:00Z' }]
})
afterEach(() => vi.clearAllMocks())

it('要求登录与本人收入字段权限', async () => {
  h.ctx = null; expect((await get()).status).toBe(401)
  h.ctx = { me: { id: 's1' }, role: { locked: false, perms: ['order.view'], fields: { writerPay: 'none', commission: 'none' } } }
  expect((await get()).status).toBe(403)
})
it('income.all 和全局行权限也不能用参数切换他人', async () => {
  h.ctx.role.perms.push('income.all'); h.ctx.role.rowScope = 'all'
  for (const name of ['user', 'userId', 'ownerId', 'payeeId']) expect((await get(`&${name}=boss`)).status).toBe(403)
  expect(h.income).not.toHaveBeenCalled()
})
it('响应只含个人金额和本人关联渠道，没有公司利润或其他销售的选项', async () => {
  const response = await get(), report = await response.json()
  expect(response.status).toBe(200)
  expect(h.income.mock.calls[0][1]).toBe('s1')
  expect(report.summary).toMatchObject({ earned: 100, paid: 20, remaining: 80 })
  expect(report.options.channels).toEqual([{ id: 'c1', name: '本人渠道' }])
  expect(JSON.stringify(report)).not.toMatch(/private-order|其他销售渠道|bossIncome|profit|writerRate|commissionRate/)
})
it('写手复用个人总览，只统计本人工资和领取金额，不能改查销售', async () => {
  h.ctx.role.rowScope = 'assigned'; h.ctx.role.fields = { writerPay: 'own', commission: 'none' }
  h.world.orders[0].ownerId = 's2'; h.world.orders[0].assignees = [{ userId: 's1' }]
  Object.assign(h.world.orders[0], {status:'已交付',draftAt:'2026-10-10T10:00:00+08:00'})
  h.rows = [{ key: 'o1:writer', id: 'o1', no: 'DD1', title: '本人写作订单', status: '已交付', date: '2026-10-10', kind: '工资', amount: 200, left: 150 }]
  h.payouts = [{ id: 'w1', orderId: 'o1', kind: '写手工资', amount: 50, at: '2026-10-12T00:00:00Z' },
    { id: 'hidden', orderId: 'o1', kind: '销售提成', amount: 999, at: '2026-10-12T00:00:00Z' }]
  const response = await get(), report = await response.json()
  expect(response.status).toBe(200)
  expect(h.income.mock.calls[0][1]).toBe('s1')
  expect(report.summary).toMatchObject({ earned: 200, wages: 200, commission: 0, paid: 50, remaining: 150 })
  expect(JSON.stringify(report)).not.toMatch(/private-order|其他销售渠道|bossIncome|999/)
  expect((await get('&payeeId=s2')).status).toBe(403)
})
it('越权渠道返回空结果，不返回渠道名称；无效日期拒绝', async () => {
  const report = await (await get('&channelId=private')).json()
  expect(report.orders).toEqual([])
  expect(report.channels).toEqual([])
  expect(JSON.stringify(report)).not.toContain('其他销售渠道')
  expect((await GET(new Request('http://test/api/reports/personal-income?from=nope&to=2026-10-31'), { params: Promise.resolve({}) })).status).toBe(400)
})
