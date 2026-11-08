import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { GET as listGet, POST as createPost } from '@/app/api/forum/route'
import { GET as detailGet, PATCH as editPost, DELETE as deletePost } from '@/app/api/forum/[id]/route'
import { GET as trashGet } from '@/app/api/forum/trash/route'
import { GET as fileGet } from '@/app/api/forum/files/[id]/route'
import { GET as auditGet } from '@/app/api/audit/route'
import { FORUM_COPY } from '@/shared/copy/forum'
import type { ForumPostDetail, ForumPostList } from '@/shared/forum'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { as, closeDb, resetDb, type Client } from './helpers'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }))
const key = () => randomUUID()
let boss: Client, sales: Client, writer: Client, other: Client
let publicPost: string, privatePost: string, announcement: string, writerAttachment: string, replyId: string
const noParams = { params: Promise.resolve({}) }
const request = (client: Client, path: string, options: RequestInit = {}) => new Request(`http://test.local${path}`, { ...options, headers: { cookie: client.cookie, 'content-type': 'application/json' } })
async function list(client: Client, query: Record<string, string> = {}) {
  const res = await listGet(request(client, `/api/forum?${new URLSearchParams(query)}`), noParams)
  return { status: res.status, body: await res.json() as ForumPostList }
}
async function detail(client: Client, id: string) {
  const res = await detailGet(request(client, `/api/forum/${id}`), { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.json() as ForumPostDetail }
}
async function seedFile(userId: string, name: string, version: string | null = null) {
  const id = `fa_${key()}`, dir = process.env.TEST_STORAGE_DIR ?? '/tmp/bxsh-forum-posts-test-storage'
  await mkdir(dir, { recursive: true })
  const path = join(dir, id), data = Buffer.from('forum attachment test bytes')
  await writeFile(path, data)
  await db.insert(t.forumAttachments).values({ id, uploadedBy: userId, name, size: data.length, mime: 'application/zip', path, version })
  return id
}
beforeAll(async () => {
  await resetDb()
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai'); other = await as('xiaoyang')
})
afterAll(closeDb)

it('员工公开发帖、私密反馈及老板公告；重复 requestId 只落一帖，不改任何订单和工资', async () => {
  const input = { requestId: key(), category: 'document', title: '公开上手指南', body: '保留 Markdown 原文\n    code' }
  const r = await Promise.all([sales.act('forum.create', input), sales.act('forum.create', input)])
  expect(r.map(x => x.status)).toEqual([200, 200]); expect(r[0].body.id).toBe(r[1].body.id)
  publicPost = r[0].body.id
  expect((await sales.act('forum.create', { ...input, body: '修改请求' })).status).toBe(400)
  writerAttachment = await seedFile('u-xiao', '只有老板能搜到的私密截图包.zip')
  const privateResult = await writer.act('forum.create', { requestId: key(), category: 'feedback', feedbackKind: '建议', private: true, title: '私密账号问题', body: '只给老板看的内容', attachmentIds: [writerAttachment] })
  expect(privateResult.status).toBe(200); privatePost = privateResult.body.id
  const ann = await createPost(request(boss, '/api/forum', { method: 'POST', body: JSON.stringify({ requestId: key(), category: 'announcement', title: '全员公告', body: '公告正文'.repeat(30) }) }), noParams)
  expect(ann.status).toBe(200); announcement = (await ann.json()).id
  expect((await detail(sales, publicPost)).body).toMatchObject({ category: 'document', author: { id: 'u-acheng', name: '阿城' }, body: input.body })
  expect((await detail(writer, privatePost)).body).toMatchObject({ status: '待处理', private: true, feedbackKind: '建议', attachmentCount: 1 })
  const [orders] = await db.select({ n: count() }).from(t.orders), [batches] = await db.select({ n: count() }).from(t.settleBatches)
  expect(orders.n).toBe(0); expect(batches.n).toBe(0)
})

it('私密帖不从列表、正文和附件名搜索、详情、附件下载泄漏，公开帖所有账号可见', async () => {
  for (const client of [sales, other]) {
    expect((await list(client)).body.rows.map(x => x.id).sort()).toEqual([publicPost, announcement].sort())
    for (const q of ['私密账号', '只给老板看的内容', '只有老板能搜到的私密截图包']) expect((await list(client, { q })).body.total).toBe(0)
    expect((await detail(client, privatePost)).status).toBe(404)
    const r = await fileGet(request(client, `/api/forum/files/${writerAttachment}`), { params: Promise.resolve({ id: writerAttachment }) })
    expect(r.status).toBe(404); expect(await r.text()).not.toContain('forum attachment test bytes')
  }
  for (const client of [writer, boss]) {
    expect((await list(client, { q: '只有老板能搜到的私密截图包' })).body.rows.map(x => x.id)).toEqual([privatePost])
    expect((await detail(client, privatePost)).status).toBe(200)
  }
  const privateView = (await detail(boss, privatePost)).body
  expect(privateView.attachments[0]).not.toHaveProperty('path')
  expect(privateView.author).not.toHaveProperty('account')
  expect(privateView).not.toHaveProperty('legacyFeedbackId')
})

it('员工不能发公告、改处理状态、置顶或删除/编辑别人的帖，老板可以', async () => {
  const denied = await sales.act('forum.create', { requestId: key(), category: 'announcement', title: '非法公告' })
  expect(denied).toEqual({ status: 403, body: { error: FORUM_COPY.errors.announce } })
  expect(await sales.act('forum.status', { requestId: key(), id: publicPost, status: '处理中' })).toEqual({ status: 403, body: { error: FORUM_COPY.errors.manage } })
  for (const name of ['forum.pin', 'forum.delete']) {
    expect((await writer.act(name, { requestId: key(), id: publicPost, pinned: true })).body.error).toBe(FORUM_COPY.errors.pinDelete)
  }
  expect(await writer.act('forum.edit', { requestId: key(), id: publicPost, title: '别人编辑' })).toEqual({ status: 403, body: { error: FORUM_COPY.errors.edit } })
  expect((await boss.act('forum.pin', { requestId: key(), id: publicPost, pinned: true })).status).toBe(200)
  expect((await list(writer, { limit: '1', sort: 'created' })).body.rows[0].id).toBe(publicPost)
  expect((await boss.act('forum.status', { requestId: key(), id: privatePost, status: '处理中' })).status).toBe(200)
  const notices = await db.select().from(t.notifications).where(eq(t.notifications.tab, `page:forum:${privatePost}`))
  expect(notices.map(n => n.userId)).toEqual(['u-xiao'])
  expect(notices[0].title).toBe('反馈状态改为「处理中」')
})

it('员工不能借切换分类重置处理状态，也不能在编辑内容时夹带状态', async () => {
  const created = await writer.act('forum.create', { requestId: key(), category: 'feedback', title: '分类切换状态回归', private: true })
  const id = created.body.id
  expect((await boss.act('forum.status', { requestId: key(), id, status: '已解决' })).status).toBe(200)
  expect(await writer.act('forum.edit', { requestId: key(), id, category: 'document' })).toEqual({ status: 403, body: { error: FORUM_COPY.errors.manage } })
  expect((await writer.act('forum.edit', { requestId: key(), id, body: '补充内容', status: '待处理' })).status).toBe(200)
  expect((await detail(writer, id)).body).toMatchObject({ category: 'feedback', status: '已解决', body: '补充内容' })
  expect((await boss.act('forum.edit', { requestId: key(), id, category: 'document' })).status).toBe(200)
  expect((await detail(writer, id)).body).toMatchObject({ category: 'document', status: null })
  // 收回这条回归用帖，避免改变后续列表分页场景。
  expect((await writer.act('forum.delete', { requestId: key(), id })).status).toBe(200)
})

it('回复、编辑和有用按作者权限执行；未读与附件计数、分页和字面搜索正确', async () => {
  expect((await sales.act('forum.reply', { requestId: key(), id: privatePost, body: '偷看' })).status).toBe(404)
  const attachmentId = await seedFile('u-xiao', '100%_sample.zip')
  const input = { requestId: key(), id: publicPost, body: '公开回复正文', attachmentIds: [attachmentId] }
  const r = await Promise.all([writer.act('forum.reply', input), writer.act('forum.reply', input)])
  expect(r.map(x => x.status)).toEqual([200, 200]); replyId = r[0].body.replyId
  let post = (await detail(sales, publicPost)).body
  expect(post).toMatchObject({ replyCount: 1, attachmentCount: 1, unread: true })
  expect(post.replies[0]).toMatchObject({ id: replyId, author: { id: 'u-xiao' }, attachments: [{ id: attachmentId }] })
  expect((await sales.act('forum.editReply', { requestId: key(), id: publicPost, replyId, body: '改他人回复' })).status).toBe(403)
  expect((await writer.act('forum.editReply', { requestId: key(), id: publicPost, replyId, body: '自己的编辑回复' })).status).toBe(200)
  expect((await sales.act('forum.read', { requestId: key(), id: publicPost })).status).toBe(200)
  expect((await detail(sales, publicPost)).body.unread).toBe(false)
  for (let n = 0; n < 2; n++) expect((await sales.act('forum.like', { requestId: key(), id: publicPost, liked: true })).status).toBe(200)
  post = (await detail(sales, publicPost)).body
  expect(post).toMatchObject({ liked: true, likeCount: 1 })
  expect((await sales.act('forum.like', { requestId: key(), id: publicPost, liked: false })).body.likeCount).toBe(0)
  expect((await list(other, { q: '100%_' })).body.rows.map(x => x.id)).toEqual([publicPost])
  expect((await list(other, { q: '100%' })).body.total).toBe(1)
  const first = (await list(boss, { limit: '1' })).body, second = (await list(boss, { limit: '1', offset: String(first.next) })).body
  expect(first.total).toBe(3); expect(first.next).toBe(1); expect(first.rows[0].id).not.toBe(second.rows[0].id)
})

it('附件不能跨作者认领或跨帖绑定，Skill 版本按上传时间倒序且仅最新版本标记', async () => {
  const stolen = await seedFile('u-xiao', '他人的待上传.zip')
  expect((await sales.act('forum.edit', { requestId: key(), id: publicPost, attachmentIds: [stolen] })).status).toBe(404)
  expect((await sales.act('forum.edit', { requestId: key(), id: publicPost, attachmentIds: [writerAttachment] })).status).toBe(404)
  const old = await seedFile('u-xiao', '润色-v1.zip', 'v1'), newer = await seedFile('u-xiao', '润色-v2.zip', 'v2')
  await db.update(t.forumAttachments).set({ createdAt: '2026-10-01T01:00:00Z' }).where(eq(t.forumAttachments.id, old))
  await db.update(t.forumAttachments).set({ createdAt: '2026-10-02T01:00:00Z' }).where(eq(t.forumAttachments.id, newer))
  const r = await writer.act('forum.create', { requestId: key(), category: 'skill', title: '润色 Skill', attachmentIds: [old, newer] })
  expect(r.status).toBe(200)
  const post = (await detail(other, r.body.id)).body
  expect(post.attachments.map(x => [x.id, x.latest])).toEqual([[newer, true], [old, false]])
  const edited = await editPost(request(writer, `/api/forum/${post.id}`, { method: 'PATCH', body: JSON.stringify({ requestId: key(), attachmentIds: [newer] }) }), { params: Promise.resolve({ id: post.id }) })
  expect(edited.status).toBe(200)
  expect((await detail(writer, post.id)).body.attachments.map(x => x.id)).toEqual([newer])
  const removed = await fileGet(request(writer, `/api/forum/files/${old}`), { params: Promise.resolve({ id: old }) })
  expect(removed.status).toBe(404)
})

it('所有编辑记录留痕；公开改私密时历史提醒同步收回', async () => {
  const publicFeedback = await writer.act('forum.create', { requestId: key(), category: 'feedback', title: '公开再收回', body: '敏感资料' })
  const id = publicFeedback.body.id
  await db.insert(t.notifications).values({ userId: 'u-acheng', kind: '反馈', tab: `page:forum:${id}`, title: '旧提醒里有敏感资料' })
  expect((await writer.act('forum.edit', { requestId: key(), id, private: true })).status).toBe(200)
  expect((await detail(sales, id)).status).toBe(404)
  expect(await db.select().from(t.notifications).where(and(eq(t.notifications.userId, 'u-acheng'), eq(t.notifications.tab, `page:forum:${id}`)))).toHaveLength(0)
  const audits = await db.select().from(t.audit).where(eq(t.audit.objectId, publicPost))
  expect(audits.map(x => x.action)).toEqual(expect.arrayContaining(['forum.create', 'forum.reply', 'forum.editReply', 'forum.like']))
  expect(audits.map(x => x.action)).not.toContain('forum.read')
})

it('删帖及回复附件一并不可见，老板能从回收站原样恢复，员工不能恢复', async () => {
  const before = (await detail(writer, privatePost)).body
  const r = await deletePost(request(writer, `/api/forum/${privatePost}`, { method: 'DELETE', body: JSON.stringify({ requestId: key() }) }), { params: Promise.resolve({ id: privatePost }) })
  expect(r.status).toBe(200)
  for (const client of [writer, boss, sales]) expect((await detail(client, privatePost)).status).toBe(404)
  const file = await fileGet(request(boss, `/api/forum/files/${writerAttachment}`), { params: Promise.resolve({ id: writerAttachment }) })
  expect(file.status).toBe(404)
  const trash = await trashGet(request(boss, '/api/forum/trash'), noParams)
  expect(trash.status).toBe(200); expect((await trash.json()).rows.map((x: { id: string }) => x.id)).toContain(privatePost)
  expect((await trashGet(request(writer, '/api/forum/trash'), noParams)).status).toBe(403)
  expect((await writer.act('forum.restore', { requestId: key(), id: privatePost })).status).toBe(403)
  expect((await boss.act('forum.restore', { requestId: key(), id: privatePost })).status).toBe(200)
  const after = (await detail(writer, privatePost)).body
  expect(after.body).toBe(before.body); expect(after.attachments).toEqual(before.attachments)
})

it('标题、正文长度及非法参数按统一文案返回，员工不能绕过权限点', async () => {
  for (const [patch, error] of [[{ title: ' ' }, FORUM_COPY.errors.titleRequired], [{ body: 'a'.repeat(20_001) }, FORUM_COPY.errors.bodyTooLong], [{ category: 'arbitrary' }, FORUM_COPY.errors.unknown]] as const) {
    expect((await writer.act('forum.create', Object.assign({ requestId: key(), category: 'document', title: '有效标题' }, patch))).body.error).toBe(error)
  }
  expect((await list(sales, { category: 'random' })).status).toBe(400)
  expect((await list(sales, { offset: '-1' })).status).toBe(400)
  expect((await list(sales, { sort: 'random' })).status).toBe(400)
  expect((await writer.act('forum.reply', { requestId: key(), id: publicPost, body: ' ' })).status).toBe(400)
  const role = await boss.act('role.save', { name: '假管理员', perms: ['forum.manage', 'forum.announce'], rowScope: 'all', fields: { sales: false, writerPay: 'none', commission: 'none', profit: false, channelNo: false } })
  expect(role.status).toBe(200)
  const [saved] = await db.select().from(t.roles).where(eq(t.roles.id, role.body.id))
  expect(saved.perms).not.toContain('forum.manage'); expect(saved.perms).not.toContain('forum.announce')
})

it('审计权限不泄露他人私密反馈正文；公告提醒只有一份且准确截取正文', async () => {
  const role = await boss.act('role.save', { name: '论坛审计检查员', perms: ['audit.view'], rowScope: 'all', fields: { sales: false, writerPay: 'none', commission: 'none', profit: false, channelNo: false } })
  expect(role.status).toBe(200)
  await boss.act('user.update', { id: 'u-acheng', patch: { roleId: role.body.id } })
  const auditor = await as('acheng')
  const response = await auditGet(request(auditor, '/api/audit?views=1'), noParams)
  expect(response.status).toBe(200)
  const rows = (await response.json()).rows
  expect(rows.some((x: { objectId: string }) => x.objectId === privatePost)).toBe(false)
  expect(rows.some((x: { objectId: string }) => x.objectId === publicPost)).toBe(true)
  const notes = await db.select().from(t.notifications).where(eq(t.notifications.tab, `page:forum:${announcement}`))
  expect(notes.map(x => x.userId).sort()).toEqual(['u-acheng', 'u-xiao', 'u-yang'])
  expect(notes.every(x => x.title === '新公告：全员公告' && x.body === '公告正文'.repeat(30).slice(0, 60))).toBe(true)
})
