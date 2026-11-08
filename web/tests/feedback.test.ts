import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { GET as listGet } from '@/app/api/feedback/route'
import { GET as imageGet } from '@/app/api/feedback/[id]/images/[hash]/route'
import { GET as auditGet } from '@/app/api/audit/route'
import { buildBoot } from '@/server/bootstrap'
import { getCtx } from '@/server/session'
import type { Feedback, FeedbackList } from '@/shared/feedback'
import { as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, writer: Client, sales: Client, otherSales: Client, shot: string, replyShot: string, writerFeedback: string, salesFeedback: string
const key = () => randomUUID()
async function list(client: Client, query: Record<string, string> = {}) {
  const response = await listGet(new Request(`http://test.local/api/feedback?${new URLSearchParams(query)}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({}) })
  return { status: response.status, body: await response.json() as FeedbackList }
}
async function record(client: Client, id: string): Promise<Feedback> {
  const result = await list(client, { id }); expect(result.status).toBe(200); return result.body.rows[0]
}
async function image(client: Client, url: string) {
  const parts = new URL(url, 'http://test.local').pathname.split('/')
  return imageGet(new Request(`http://test.local${url}`, { headers: { cookie: client.cookie } }), { params: Promise.resolve({ id: parts[3], hash: parts[5] }) })
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); writer = await as('xiaosenkai'); sales = await as('acheng'); otherSales = await as('xiaoyang')
  const png = async (background: string) => `data:image/png;base64,${(await sharp({ create: { width: 3, height: 3, channels: 3, background } }).png().toBuffer()).toString('base64')}`
  shot = await png('red'); replyShot = await png('blue')
})
afterAll(closeDb)

it('登录员工可反馈；重复提交只建一条，反馈不写入订单、收款和工资', async () => {
  const input = { requestId: key(), kind: '问题', title: '订单滚动偶尔空白', body: 'Safari 快速滚动时出现', shots: [shot] }
  const created = await Promise.all([writer.act('feedback.create', input), writer.act('feedback.create', input)])
  expect(created.map(result => result.status)).toEqual([200, 200])
  expect(created[0].body.id).toBe(created[1].body.id)
  writerFeedback = created[0].body.id
  expect((await writer.act('feedback.create', { ...input, title: '不同的内容' })).status).toBe(400)
  const row = await record(writer, writerFeedback)
  expect(row).toMatchObject({ authorId: 'u-xiao', author: { id: 'u-xiao', name: '肖森凯' }, status: '待处理', kind: '问题', title: input.title, body: input.body, replies: [] })
  expect(row.no).toMatch(/^FB\d+$/)
  expect(row.shots[0]).toMatch(/^\/api\/feedback\//)
  expect(row).not.toHaveProperty('requests')
  expect(row.author).not.toHaveProperty('account')
  const suggestion = await sales.act('feedback.create', { requestId: key(), kind: '建议', title: '希望支持订单快捷键', body: '', shots: [] })
  expect(suggestion.status).toBe(200); salesFeedback = suggestion.body.id
  const boot = (await boss.boot()).body
  expect(boot.orders).toHaveLength(0); expect(boot.batches).toHaveLength(0)
  expect(boot.notifications.some((item: { kind: string; tab: string }) => item.kind === '反馈' && item.tab === 'page:feedback')).toBe(true)
})

it('列表、搜索、分页、指定反馈和截图均隔离到本人；老板可查看全部', async () => {
  expect((await list(writer)).body.rows.map(row => row.id)).toEqual([writerFeedback])
  expect((await list(sales)).body.rows.map(row => row.id)).toEqual([salesFeedback])
  expect((await list(otherSales)).body.total).toBe(0)
  expect((await list(otherSales, { q: 'Safari' })).body.total).toBe(0)
  expect((await list(sales, { id: writerFeedback })).status).toBe(404)
  const page = await list(boss, { limit: '1' })
  expect(page.body).toMatchObject({ total: 2, next: 1 })
  const second = await list(boss, { limit: '1', offset: '1' })
  expect(second.body.rows).toHaveLength(1); expect(second.body.next).toBeNull()
  expect(page.body.rows[0].id).not.toBe(second.body.rows[0].id)
  expect((await list(boss, { q: 'Safari', kind: '问题', status: '待处理' })).body.rows.map(row => row.id)).toEqual([writerFeedback])
  const url = (await record(writer, writerFeedback)).shots[0]
  const original = await image(writer, url)
  expect(original.status).toBe(200); expect(original.headers.get('cache-control')).toBe('private, no-store')
  expect((await image(boss, url + '?thumb=1')).headers.get('content-type')).toBe('image/webp')
  expect((await image(sales, url)).status).toBe(404)
  expect((await image(otherSales, url)).status).toBe(404)
  const anonymous = await listGet(new Request('http://test.local/api/feedback'), { params: Promise.resolve({}) })
  expect(anonymous.status).toBe(401)
})

it('只有本人和老板可回复，重试不重复；回复截图同样隔离', async () => {
  const input = { id: writerFeedback, requestId: key(), body: '已复现，正在修复', shots: [replyShot] }
  expect((await sales.act('feedback.reply', input)).status).toBe(404)
  const responses = await Promise.all([boss.act('feedback.reply', input), boss.act('feedback.reply', input)])
  expect(responses.map(result => result.status)).toEqual([200, 200])
  let row = await record(writer, writerFeedback)
  expect(row.replies).toHaveLength(1)
  expect(row.replies[0]).toMatchObject({ by: 'u-boss', author: { id: 'u-boss', name: '老板' }, body: input.body })
  expect((await image(writer, row.replies[0].shots[0])).status).toBe(200)
  expect((await image(otherSales, row.replies[0].shots[0])).status).toBe(404)
  expect((await writer.act('feedback.reply', { id: writerFeedback, requestId: key(), body: '我再试一下', shots: [] })).status).toBe(200)
  row = await record(writer, writerFeedback)
  expect(row.replies).toHaveLength(2)
  expect((await writer.act('feedback.reply', { id: writerFeedback, requestId: key(), body: '', shots: [] })).status).toBe(400)
  expect((await sales.act('feedback.reply', { id: salesFeedback, requestId: key(), body: '', shots: [row.shots[0]] })).status).toBe(400)
})

it('只有老板能处理反馈状态，重复请求不重复提醒或审计', async () => {
  const input = { id: writerFeedback, requestId: key(), status: '处理中' }
  expect((await writer.act('feedback.update', input)).status).toBe(403)
  expect((await sales.act('feedback.update', input)).status).toBe(403)
  expect((await boss.act('feedback.update', input)).status).toBe(200)
  expect((await boss.act('feedback.update', input)).status).toBe(200)
  expect((await record(writer, writerFeedback)).status).toBe('处理中')
  expect((await boss.act('feedback.update', { ...input, status: '已解决' })).status).toBe(400)
  expect((await boss.act('feedback.update', { ...input, requestId: key(), status: '已解决' })).status).toBe(200)
  const boot = (await boss.boot()).body
  expect(boot.audit.filter((item: { objectId: string; action: string }) => item.objectId === writerFeedback && item.action === '处理反馈')).toHaveLength(2)
  const writerBoot = (await writer.boot()).body
  expect(writerBoot.notifications.filter((item: { kind: string; title: string }) => item.kind === '反馈' && item.title.startsWith('反馈处理中'))).toHaveLength(1)
})

it('拒绝空标题、非法类型状态和过量或其他反馈的截图', async () => {
  const input = { requestId: key(), kind: '问题', title: '反馈', body: '', shots: [] }
  for (const patch of [{ title: '  ' }, { kind: '随便' }, { title: 'x'.repeat(161) }, { shots: Array(10).fill(shot) }, { shots: [(await record(writer, writerFeedback)).shots[0]] }]) {
    expect((await sales.act('feedback.create', { ...input, ...patch })).status).toBe(400)
  }
  expect((await list(boss, { status: '未知' })).status).toBe(400)
  expect((await list(boss, { kind: '未知' })).status).toBe(400)
  expect((await boss.act('feedback.update', { id: writerFeedback, requestId: key(), status: '未知' })).status).toBe(400)
})

it('授予审计权限仍不泄露其他人的反馈内容和截图', async () => {
  const role = await boss.act('role.save', { name: '反馈审计检查员', perms: ['audit.view'], rowScope: 'all', fields: { sales: false, writerPay: 'none', commission: 'none', profit: false, channelNo: false } })
  expect(role.status).toBe(200)
  for (const id of ['u-xiao', 'u-acheng', 'u-yang']) expect((await boss.act('user.update', { id, patch: { roleId: role.body.id } })).status).toBe(200)
  for (const [account, allowed] of [['xiaosenkai', [writerFeedback]], ['acheng', [salesFeedback]], ['xiaoyang', []]] as const) {
    const client = await as(account), req = new Request('http://test.local/api/audit?views=1', { headers: { cookie: client.cookie } })
    const response = await auditGet(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const ctx = await getCtx(req)
    const boot = await buildBoot(ctx!)
    for (const rows of [(await response.json()).rows, boot.audit]) {
      const ids = [...new Set(rows.filter((item: { objectType: string }) => item.objectType === 'feedback').map((item: { objectId: string }) => item.objectId))]
      expect(ids.sort()).toEqual([...allowed].sort())
    }
  }
})
