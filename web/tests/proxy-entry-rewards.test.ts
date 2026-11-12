import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { as, closeDb, loginAs, resetDb, type Client } from './helpers'
import { calc, ownerCommission, proxyFee } from '@/shared/calc'
import { dueItems } from '@/shared/settle'
import { payable } from '@/shared/work-materials'
import type { Order } from '@/shared/types'
import { GET as rewardsGet, POST as rewardsPost } from '@/app/api/reviews/route'
import { POST as rewardChange } from '@/app/api/reviews/[id]/route'
import { POST as rewardsSettle } from '@/app/api/reviews/settle/route'

const admins = new Set(['boss'])
const fixture = (patch: Partial<Order> = {}): Order => ({
  id: 'p', no: 'DD1', title: '代录', orderDate: '2026-10-11', dueDate: null, ownerId: 'sales', creatorId: 'helper', channelId: '', channelNo: '', wechatGroup: '', draftAt: null, type: '',
  basePrice: 1000, adjustments: [], assignees: [{ userId: 'writer', pay: 300 }], status: '未交付', note: '', commissionRate: 0.5, salesMode: 'commission', proxyId: 'helper', proxyRate: 0.05,
  payments: [{ id: 'a', amount: 800, date: '2026-10-11', tag: '定金', by: 'helper', note: '' }], attachments: [], afterSales: [], settlements: [], req: {}, nodes: [], receivables: [], reviewFlag: null, deletedAt: null, ...patch,
})

it('代录费按实收 5% 从归属销售提成里扣，退款跟着变，老板利润不变', () => {
  const o = fixture()
  const c = calc(o, admins)
  expect(c.commission).toBe(350)
  expect(proxyFee(o, c.commission)).toBe(40)
  expect(ownerCommission(o, c.commission)).toBe(310)
  expect(dueItems(o, '销售提成', 'helper', admins)).toEqual([{ amount: 40, period: null }])
  expect(dueItems(o, '销售提成', 'sales', admins)).toEqual([{ amount: 310, period: null }])
  expect(calc({ ...o, proxyId: null }, admins).profit).toBe(c.profit)
  const refunded = fixture({ payments: [...o.payments, { id: 'r', amount: 200, date: '2026-10-12', tag: '退款', by: 'boss', note: '' }] })
  expect(proxyFee(refunded, 350)).toBe(30)
  // 写手工资没定时提成算不出来，代录费也先不给
  expect(dueItems(fixture({ assignees: [{ userId: 'writer', pay: null }] }), '销售提成', 'helper', admins)).toEqual([])
  // 最多扣到提成为 0
  expect(proxyFee(fixture({ payments: [{ id: 'a', amount: 1000, date: '2026-10-11', tag: '全款', by: 'x', note: '' }] }), 20)).toBe(20)
  // 已付给代录人的钱不算前任销售的
  const paid = fixture({ settlements: [{ id: 's', kind: '销售提成', payeeId: 'helper', amount: 40, status: '已确认', note: '', migrated: false, batchId: null, received: false }] })
  expect(ownerCommission(paid, 350)).toBe(310)
})

let boss: Client, acheng: Client, yang: Client, writer: Client, achengChannel: string
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); acheng = await as('acheng'); yang = await as('xiaoyang'); writer = await as('xiaosenkai')
  achengChannel = (await boss.act('channel.create', { name: '阿城的渠道', ownerId: 'u-acheng' })).body.id
})
afterAll(closeDb)

const order = (patch: Record<string, unknown> = {}) => ({ title: '代录测试单', ownerId: 'u-acheng', orderDate: '2026-11-12', dueDate: null, basePrice: 1000, channelId: achengChannel, proxy: true, ...patch })

it('只能替暂停的销售代录；代录人看得到单和自己的代录费，原销售提成少 5%', async () => {
  expect((await yang.act('order.create', order())).status).toBe(400)
  expect((await acheng.act('user.pause', { id: 'u-yang', paused: true })).status).toBe(403)
  expect((await acheng.act('user.pause', { id: 'u-acheng', paused: true })).status).toBe(200)
  const yangBoot = (await yang.boot()).body
  expect(yangBoot.users.find((u: any) => u.id === 'u-acheng').pausedAt).toBeTruthy()
  expect(yangBoot.proxyChannels.map((c: any) => c.id)).toContain(achengChannel)

  const created = await yang.act('order.create', order())
  expect(created.status).toBe(200)
  const id = created.body.id
  expect((await yang.act('order.addPayment', { id, amount: 600, date: '2026-11-12', tag: '定金', note: '代收定金' })).status).toBe(200)

  const bossView = (await boss.boot()).body.orders.find((o: any) => o.id === id)
  expect(bossView).toMatchObject({ ownerId: 'u-acheng', proxyId: 'u-yang' })
  const yb = (await yang.boot()).body
  const yangView = yb.orders.find((o: any) => o.id === id)
  expect(yangView.proxyFee).toBe(30)
  expect(yangView.commission).toBeUndefined()
  expect(yb.income['u-yang'].find((r: any) => r.id === id)).toMatchObject({ kind: '代录费', amount: 30 })

  const ab = (await acheng.boot()).body
  const achengView = ab.orders.find((o: any) => o.id === id)
  expect(achengView.proxyFee).toBe(30)
  expect(achengView.commission).toBe(bossView.commission)
  // 新制度下销售分成是分成基数的 20%：1000 × 20% = 200，扣掉代录费 30
  expect(bossView.commission).toBe(170)

  // 恢复接单后不能再替他代录
  expect((await acheng.act('user.pause', { id: 'u-acheng', paused: false })).status).toBe(200)
  expect((await yang.act('order.create', order())).status).toBe(400)
  // 不能用别人的渠道冒充代录
  expect((await yang.act('order.create', order({ proxy: false }))).status).toBe(404)
})

const call = async (handler: (req: Request, ctx: any) => Promise<Response>, cookie: string, url: string, body?: unknown, params: Record<string, string> = {}) => {
  const r = await handler(new Request('http://test.local' + url, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve(params) })
  return { status: r.status, body: await r.json() }
}

it('奖惩合在复盘里：罚款走写手回复、老板确认后才扣，奖励直接可结；结清后锁住', async () => {
  const bossCookie = boss.cookie, writerCookie = writer.cookie
  const penalty = randomUUID(), reward = randomUUID(), plain = randomUUID()
  const fine = { id: penalty, kind: 'penalty', writerId: 'u-xiao', orderId: null, category: '回复不及时', amount: 50, issue: '超过 2 小时没回' }
  expect((await call(rewardsPost, writerCookie, '/api/reviews', fine)).status).toBe(403)
  expect((await call(rewardsPost, bossCookie, '/api/reviews', fine)).status).toBe(200)
  expect((await call(rewardsPost, bossCookie, '/api/reviews', { id: reward, kind: 'reward', writerId: 'u-xiao', category: '提出新制度', amount: 200, issue: '提了接单群规则' })).status).toBe(200)
  // 不填金额就是原来的复盘
  expect((await call(rewardsPost, bossCookie, '/api/reviews', { id: plain, writerId: 'u-xiao', issue: '格式再注意' })).status).toBe(200)
  expect((await call(rewardsPost, bossCookie, '/api/reviews', { id: randomUUID(), kind: 'penalty', writerId: 'u-acheng', amount: 1, issue: 'x' })).status).toBe(400)

  const mine = (await call(rewardsGet, writerCookie, '/api/reviews')).body
  const byId = (id: string) => mine.find((r: any) => r.id === id)
  expect(byId(reward)).toMatchObject({ status: 'done', amount: 200 })
  expect(byId(penalty)).toMatchObject({ status: 'pending', amount: 50, orderId: null })
  expect(byId(plain)).toMatchObject({ kind: 'penalty', amount: null })
  expect(payable(byId(reward))).toBe(true)
  expect(payable(byId(penalty))).toBe(false)
  // 罚款没确认前不能结
  expect((await call(rewardsSettle, bossCookie, '/api/reviews/settle', { writerId: 'u-xiao', ids: [penalty, reward] })).status).toBe(409)
  expect((await call(rewardChange, writerCookie, `/api/reviews/${penalty}`, { action: 'reply', reply: '那天在医院', version: 0 }, { id: penalty })).status).toBe(200)
  expect((await call(rewardChange, writerCookie, `/api/reviews/${penalty}`, { action: 'revoke', note: '自己撤' }, { id: penalty })).status).toBe(403)
  expect((await call(rewardChange, bossCookie, `/api/reviews/${penalty}`, { action: 'confirm', version: 1 }, { id: penalty })).status).toBe(200)
  expect((await call(rewardsSettle, bossCookie, '/api/reviews/settle', { writerId: 'u-xiao', ids: [penalty, reward] })).body).toEqual({ net: 150 })
  expect((await call(rewardChange, bossCookie, `/api/reviews/${penalty}`, { action: 'revoke', note: '撤销' }, { id: penalty })).status).toBe(409)
  expect((await call(rewardsSettle, bossCookie, '/api/reviews/settle', { writerId: 'u-xiao', ids: [reward] })).status).toBe(409)

  // 看了回复决定撤销罚款
  const second = randomUUID()
  await call(rewardsPost, bossCookie, '/api/reviews', { id: second, kind: 'penalty', writerId: 'u-xiao', category: '质量差', amount: 30, issue: '格式错' })
  await call(rewardChange, writerCookie, `/api/reviews/${second}`, { action: 'reply', reply: '模板是渠道给的', version: 0 }, { id: second })
  expect((await call(rewardChange, bossCookie, `/api/reviews/${second}`, { action: 'confirm', revoke: true, version: 1 }, { id: second })).status).toBe(200)
  const after = (await call(rewardsGet, bossCookie, '/api/reviews')).body.find((r: any) => r.id === second)
  expect(after.revokedAt).toBeTruthy()
  expect(payable(after)).toBe(false)
  const { status } = await loginAs('xiaosenkai')
  expect(status).toBe(200)
})
