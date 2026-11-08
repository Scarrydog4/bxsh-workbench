import { afterAll, beforeAll, expect, it } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { AVATAR_FRAME_IDS } from '@/shared/avatar-frames'

let boss: Client, sales: Client, writer: Client
beforeAll(async () => { await resetDb(); boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai') })
afterAll(closeDb)

it('旧账号默认不带框，三种角色均可给自己选框，写手可选择全部 13 款', async () => {
  const initial = (await writer.boot()).body
  expect(initial.me.frame).toBe('none')
  expect(initial.users.every((u: { frame: string }) => u.frame === 'none')).toBe(true)
  expect((await boss.act('user.frame', { id: 'u-boss', frame: 'crown' })).status).toBe(200)
  expect((await sales.act('user.frame', { id: 'u-acheng', frame: 'bow' })).status).toBe(200)
  for (const frame of AVATAR_FRAME_IDS) expect((await writer.act('user.frame', { id: 'u-xiao', frame })).status, frame).toBe(200)
  const fresh = (await (await as('xiaosenkai')).boot()).body
  expect(fresh.me.frame).toBe('bow')
  expect(fresh.users.find((u: { id: string }) => u.id === 'u-boss').frame).toBe('crown')
  expect((await sql`select avatar_frame from users where id='u-xiao'`)[0].avatar_frame).toBe('bow')
})

it('只允许修改本人；管理员可改其他人，普通销售与写手不可越权', async () => {
  for (const client of [sales, writer]) expect((await client.act('user.frame', { id: 'u-boss', frame: 'star' })).status).toBe(403)
  expect((await boss.act('user.frame', { id: 'u-xiao', frame: 'knight' })).status).toBe(200)
  expect((await writer.boot()).body.me.frame).toBe('knight')
  expect((await boss.act('user.frame', { id: 'missing-user', frame: 'gold' })).status).toBe(404)
})

it('服务端拒绝白名单外、空值及对象，失败时保留原框', async () => {
  for (const frame of ['', 'admin-crown', '<script>', null, {}, 1]) expect((await writer.act('user.frame', { id: 'u-xiao', frame })).status).toBe(400)
  expect((await writer.boot()).body.me.frame).toBe('knight')
})

it('修改记录前后名称，重复选择不加日志；取消头像框持久化为空且其他账号看到 none', async () => {
  expect((await writer.act('user.frame', { id: 'u-xiao', frame: 'gold' })).status).toBe(200)
  const [entry] = await sql`select field, from_value as "from", to_value as "to" from audit where object_id='u-xiao' and field='头像框' order by id desc limit 1`
  expect(entry).toEqual({ field: '头像框', from: '蓝骑士', to: '金环' })
  const [{ count: before }] = await sql`select count(*)::int from audit where object_id='u-xiao' and field='头像框'`
  expect((await writer.act('user.frame', { id: 'u-xiao', frame: 'gold' })).status).toBe(200)
  const [{ count: after }] = await sql`select count(*)::int from audit where object_id='u-xiao' and field='头像框'`
  expect(after).toBe(before)
  expect((await writer.act('user.frame', { id: 'u-xiao', frame: 'none' })).status).toBe(200)
  expect((await sql`select avatar_frame from users where id='u-xiao'`)[0].avatar_frame).toBeNull()
  expect((await sales.boot()).body.users.find((u: { id: string }) => u.id === 'u-xiao').frame).toBe('none')
})
