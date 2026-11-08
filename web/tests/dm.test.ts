import { randomUUID } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { GET as listGet } from '@/app/api/dm/route'
import { GET as peopleGet } from '@/app/api/dm/people/route'
import { GET as messagesGet } from '@/app/api/dm/[id]/messages/route'
import { GET as fileGet } from '@/app/api/forum/files/[id]/route'
import { db } from '@/server/db'
import { DM_ACTIONS } from '@/server/actions-dm'
import { canDmViewAll, dmAuditVisibility } from '@/server/dm'
import { canReceiveForumEvent } from '@/server/forum-visibility'
import { getCtx } from '@/server/session'
import { loadWorld } from '@/server/repo'
import { FORUM_COPY } from '@/shared/copy/forum'
import type { DmMessagePage, DmThreadList } from '@/shared/dm'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
let boss: Client, sales: Client, writer: Client, otherSales: Client, threadId: string
const key = () => randomUUID()
const request = (client: Client, url: string) => new Request(`http://test.local${url}`, { headers: { cookie: client.cookie } })
async function list(client: Client, query = '') {
  const response = await listGet(request(client, `/api/dm${query}`), { params: Promise.resolve({}) })
  return { status: response.status, body: await response.json() as DmThreadList }
}
async function messages(client: Client, id: string, query = '') {
  const response = await messagesGet(request(client, `/api/dm/${id}/messages${query}`), { params: Promise.resolve({ id }) })
  return { status: response.status, body: await response.json() as DmMessagePage }
}
async function file(client: Client, id: string) {
  return fileGet(request(client, `/api/forum/files/${id}?inline=1`), { params: Promise.resolve({ id }) })
}
async function send(client: Client, body: string, attachmentIds: string[] = []) {
  const result = await client.act('dm.send', { requestId: key(), threadId, body, attachmentIds })
  expect(result.status).toBe(200)
  return result.body.id as string
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai'); otherSales = await as('xiaoyang')
})
afterAll(closeDb)

it('在职员工列表只返回公开身份字段；两人反向开始对话仍是同一条，requestId防重复', async () => {
  const people = await peopleGet(request(writer, '/api/dm/people?q=阿'), { params: Promise.resolve({}) })
  expect(people.status).toBe(200)
  const person = (await people.json()).rows[0]
  expect(person).toMatchObject({ id: 'u-acheng', name: '阿城' })
  expect(Object.keys(person).sort()).toEqual(['active', 'frame', 'hue', 'id', 'name'].sort())
  const input = { requestId: key(), userId: 'u-xiao' }
  const started = await Promise.all([sales.act('dm.start', input), sales.act('dm.start', input), writer.act('dm.start', { requestId: key(), userId: 'u-acheng' })])
  expect(started.map(row => row.status)).toEqual([200, 200, 200])
  expect(new Set(started.map(row => row.body.id)).size).toBe(1)
  threadId = started[0].body.id
  expect(await db.select().from(t.dmThreads)).toHaveLength(1)
  expect((await sales.act('dm.start', { ...input, userId: 'u-yang' })).status).toBe(400)
  expect((await sales.act('dm.start', { requestId: key(), userId: 'u-acheng' })).status).toBe(400)
  expect((await sales.act('dm.start', { requestId: key(), userId: 'missing' })).status).toBe(404)
})

it('文字按原样保存；发送幂等、未读和提醒按对话合并，旁观老板不收提醒', async () => {
  const body = 'sensitive-message\n**plain text** https://example.test'
  const input = { requestId: key(), threadId, body, attachmentIds: [] }
  const sent = await Promise.all([sales.act('dm.send', input), sales.act('dm.send', input)])
  expect(sent.map(row => row.status)).toEqual([200, 200])
  expect(sent[0].body.id).toBe(sent[1].body.id)
  await send(sales, 'second-message')
  const page = await messages(writer, threadId)
  expect(page.body.rows.map(row => row.body)).toEqual([body, 'second-message'])
  expect(page.body.thread.unreadCount).toBe(2)
  expect((await list(writer)).body.totalUnread).toBe(2)
  expect((await list(sales)).body.totalUnread).toBe(0)
  const notes = await db.select().from(t.notifications).where(eq(t.notifications.tab, `page:dm:${threadId}`))
  expect(notes).toHaveLength(1)
  expect(notes[0]).toMatchObject({ userId: 'u-xiao', title: FORUM_COPY.notify.dmTitle('阿城'), body: [...body].slice(0, 40).join('') })
  const logs = await db.select().from(t.audit).where(eq(t.audit.objectType, 'dm'))
  expect(JSON.stringify(logs)).not.toContain('sensitive-message')
  expect(logs.every(row => !row.note && !row.proof && !row.objectLabel)).toBe(true)
  expect((await sales.act('dm.send', { ...input, body: 'changed' })).status).toBe(400)
  const countBefore = (await db.select().from(t.dmMessages)).length
  expect((await sales.act('dm.send', { requestId: key(), threadId, body: 'invalid attachment', attachmentIds: ['missing-file'] })).status).toBe(404)
  expect(await db.select().from(t.dmMessages)).toHaveLength(countBefore)
})

it('非参与员工读写及SSE均隔离；老板旁观只读且不改变已读或提醒', async () => {
  const beforeReads = await db.select().from(t.dmReads)
  const beforeNotes = await db.select().from(t.notifications)
  expect((await list(otherSales)).body).toMatchObject({ mine: [], others: [], totalUnread: 0 })
  expect((await messages(otherSales, threadId)).status).toBe(404)
  expect((await otherSales.act('dm.send', { requestId: key(), threadId, body: 'not allowed' })).status).toBe(404)
  const viewed = await messages(boss, threadId)
  expect(viewed.status).toBe(200)
  expect(viewed.body.thread).toMatchObject({ readOnly: true, canSend: false, counterpart: null, unreadCount: 0 })
  expect((await list(boss)).body).toMatchObject({ mine: [], others: [{ id: threadId }], totalUnread: 0 })
  expect((await boss.act('dm.send', { requestId: key(), threadId, body: 'observe only' })).body.error).toBe(FORUM_COPY.errors.observer)
  expect((await boss.act('dm.retract', { requestId: key(), id: viewed.body.rows[0].id })).body.error).toBe(FORUM_COPY.errors.observer)
  expect((await boss.act('dm.read', { requestId: key(), threadId })).body.readOnly).toBe(true)
  expect(await db.select().from(t.dmReads)).toEqual(beforeReads)
  expect(await db.select().from(t.notifications)).toEqual(beforeNotes)
  const event = { kind: 'dm', at: Date.now(), version: 1, resource: { type: 'dm' as const, id: threadId } }
  for (const [client, expected] of [[writer, true], [sales, true], [boss, true], [otherSales, false]] as const) {
    const ctx = (await getCtx(request(client, '/')))!
    expect(await canReceiveForumEvent(ctx, event)).toBe(expected)
  }
})

it('只有显式标记已读才改变游标；新消息重新提醒，旧请求重放不吞掉新未读', async () => {
  const input = { requestId: key(), threadId }
  expect((await writer.act('dm.read', input)).status).toBe(200)
  expect((await messages(sales, threadId)).body.lastOwnMessageRead).toBe(true)
  expect((await list(writer)).body.totalUnread).toBe(0)
  await send(sales, 'after-read')
  expect((await writer.act('dm.read', input)).status).toBe(200)
  expect((await list(writer)).body.totalUnread).toBe(1)
  expect((await messages(sales, threadId)).body.lastOwnMessageRead).toBe(false)
  const notes = await db.select().from(t.notifications).where(eq(t.notifications.tab, `page:dm:${threadId}`))
  expect(notes).toHaveLength(2)
  expect(notes.filter(row => !row.readAt)).toHaveLength(1)
})

it('消息游标前翻按时间及ID稳定分页，不重复不遗漏；校验5000字与空消息', async () => {
  for (let i = 0; i < 4; i++) await send(writer, `page-${i}`)
  let cursor: string | null = null
  const ids: string[] = []
  do {
    const result = await messages(writer, threadId, `?limit=2${cursor ? `&before=${cursor}` : ''}`)
    expect(result.status).toBe(200)
    const times = result.body.rows.map(row => Date.parse(row.createdAt))
    expect(times).toEqual([...times].sort((a, b) => a - b))
    ids.push(...result.body.rows.map(row => row.id)); cursor = result.body.next
  } while (cursor)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.length).toBe((await db.select().from(t.dmMessages).where(eq(t.dmMessages.threadId, threadId))).length)
  expect((await messages(writer, threadId, '?before=invalid')).status).toBe(400)
  for (const body of ['', '   \n ', '字'.repeat(5001)]) expect((await writer.act('dm.send', { requestId: key(), threadId, body })).status).toBe(400)
})

it('附件只对参与者和老板可读；撤回清空文本并真实删除文件，超时/代人撤回被拒绝', async () => {
  const attachmentId = `dma_${key()}`, filePath = path.join(process.env.STORAGE_DIR!, attachmentId + '.txt')
  await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, 'dm-private-file-content')
  await db.insert(t.forumAttachments).values({ id: attachmentId, uploadedBy: 'u-acheng', name: 'private-file.txt', size: 23, mime: 'text/plain', path: filePath })
  expect((await writer.act('dm.send', { requestId: key(), threadId, body: 'claim another upload', attachmentIds: [attachmentId] })).status).toBe(404)
  expect((await writer.act('dm.read', { requestId: key(), threadId })).status).toBe(200)
  const messageId = await send(sales, 'attachment secret', [attachmentId])
  for (const client of [sales, writer, boss]) expect((await file(client, attachmentId)).status).toBe(200)
  const forbidden = await file(otherSales, attachmentId)
  expect(forbidden.status).toBe(404); expect(await forbidden.text()).not.toContain('dm-private-file-content')
  expect((await writer.act('dm.retract', { requestId: key(), id: messageId })).status).toBe(403)
  const ctx = (await getCtx(request(sales, '/')))!
  await expect(db.transaction(async tx => {
    await DM_ACTIONS['dm.retract'].run(tx, ctx, await loadWorld(tx), { requestId: key(), id: messageId })
    throw new Error('rollback-check')
  })).rejects.toThrow('rollback-check')
  await expect(access(filePath)).resolves.toBeUndefined()
  expect((await messages(writer, threadId)).body.rows.find(row => row.id === messageId)?.body).toBe('attachment secret')
  expect((await file(writer, attachmentId)).status).toBe(200)
  expect((await writer.act('dm.read', { requestId: key(), threadId })).status).toBe(200)
  expect((await db.select().from(t.notifications).where(eq(t.notifications.body, 'attachment secret')))[0].readAt).toBeTruthy()
  const retractInput = { requestId: key(), id: messageId }
  expect((await sales.act('dm.retract', retractInput)).status).toBe(200)
  expect((await sales.act('dm.retract', retractInput)).status).toBe(200)
  await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await db.select().from(t.notifications).where(eq(t.notifications.body, 'attachment secret'))).toEqual([])
  for (const client of [sales, writer, boss]) {
    const retracted = (await messages(client, threadId)).body.rows.find(row => row.id === messageId)!
    expect(retracted.body).toBe(''); expect(retracted.attachments).toEqual([]); expect(retracted.retractedAt).toBeTruthy()
    expect((await file(client, attachmentId)).status).toBe(404)
  }
  const tooOld = await send(sales, 'old')
  await db.update(t.dmMessages).set({ createdAt: new Date(Date.now() - 121_000).toISOString() }).where(eq(t.dmMessages.id, tooOld))
  expect((await sales.act('dm.retract', { requestId: key(), id: tooOld })).body.error).toBe(FORUM_COPY.errors.retractExpired)
})

it('停用账号历史可读、不能新发；员工即使被错误授予dm.viewAll也看不到别人对话及审计', async () => {
  await db.update(t.users).set({ active: false }).where(eq(t.users.id, 'u-xiao'))
  expect((await messages(sales, threadId)).status).toBe(200)
  expect((await messages(sales, threadId)).body.thread.canSend).toBe(false)
  expect((await sales.act('dm.start', { requestId: key(), userId: 'u-xiao' })).body.id).toBe(threadId)
  expect((await sales.act('dm.send', { requestId: key(), threadId, body: 'blocked' })).body.error).toBe(FORUM_COPY.errors.accountInactive('肖森凯'))
  const people = await peopleGet(request(sales, '/api/dm/people'), { params: Promise.resolve({}) })
  expect((await people.json()).rows.some((row: { id: string }) => row.id === 'u-xiao')).toBe(false)
  const [role] = await db.select().from(t.roles).where(eq(t.roles.id, 'r-sales'))
  await db.update(t.roles).set({ perms: [...role.perms, 'dm.viewAll', 'audit.view'] }).where(eq(t.roles.id, 'r-sales'))
  const ctx = (await getCtx(request(otherSales, '/')))!
  expect(canDmViewAll(ctx)).toBe(false)
  expect((await messages(otherSales, threadId)).status).toBe(404)
  expect((await list(otherSales)).body.others).toEqual([])
  expect(await db.select().from(t.audit).where(and(eq(t.audit.objectType, 'dm'), dmAuditVisibility(ctx)))).toEqual([])
})

it('老板在自己的对话可以来回发消息，只收到自己的私信提醒，两组列表分开', async () => {
  const started = await boss.act('dm.start', { requestId: key(), userId: 'u-yang' })
  expect(started.status).toBe(200)
  const ownThread = started.body.id
  expect((await boss.act('dm.send', { requestId: key(), threadId: ownThread, body: 'boss own message' })).status).toBe(200)
  expect((await otherSales.act('dm.send', { requestId: key(), threadId: ownThread, body: 'reply to boss' })).status).toBe(200)
  const inbox = (await list(boss)).body
  expect(inbox.mine.map(row => row.id)).toEqual([ownThread])
  expect(inbox.others.map(row => row.id)).toEqual([threadId])
  expect(inbox.totalUnread).toBe(1)
  expect(inbox.mine[0]).toMatchObject({ readOnly: false, canSend: true, counterpart: { id: 'u-yang' } })
  const notes = await db.select().from(t.notifications).where(eq(t.notifications.userId, 'u-boss'))
  expect(notes.map(row => row.tab)).toEqual([`page:dm:${ownThread}`])
})
