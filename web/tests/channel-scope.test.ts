import { afterAll, beforeAll, expect, it } from 'vitest'
import { as, closeDb, resetDb, type Client } from './helpers'
import { POST as exportChannel } from '@/app/api/export/channel/route'
import { GET as statement } from '@/app/api/statement/route'
import { GET as ordersDelta } from '@/app/api/orders/route'
import { sql } from '@/server/db'

let boss: Client, sales: Client, other: Client, writer: Client
let own: string, foreign: string, empty: string, mine: string, assigned: string, oldOrder: string
const day = '2026-10-08'
const payload = (channelId: string, title='权限测试') => ({ title, channelId, ownerId:'u-acheng', orderDate:day, dueDate:null, basePrice:100 })
beforeAll(async () => {
  await resetDb()
  boss=await as('boss'); sales=await as('acheng'); other=await as('xiaoyang'); writer=await as('xiaosenkai')
  own=(await boss.act('channel.create',{name:'阿城渠道',ownerId:'u-acheng'})).body.id
  foreign=(await boss.act('channel.create',{name:'小羊渠道',ownerId:'u-yang'})).body.id
  empty=(await boss.act('channel.create',{name:'老板空渠道',ownerId:'u-boss'})).body.id
  mine=(await boss.act('order.create',payload(own))).body.id
  assigned=(await boss.act('order.create',{...payload(foreign),ownerId:'u-yang'})).body.id
  // 历史合并渠道保留原订单归属：能看订单不代表能使用接收渠道。
  oldOrder=(await boss.act('order.create',payload(foreign,'历史归属订单'))).body.id
})
afterAll(closeDb)
const ids=(channels:{id:string}[])=>channels.map(c=>c.id).sort()

it('老板看到全部渠道；销售只拿到自己的渠道，连空渠道也不泄露',async()=>{
  expect(ids((await boss.boot()).body.channels)).toEqual([own,foreign,empty].sort())
  expect(ids((await sales.boot()).body.channels)).toEqual([own])
  expect(ids((await other.boot()).body.channels)).toEqual([foreign])
})
it('写手仅保留可见订单的渠道名称和头像，不开放渠道库；历史订单也不丢名称',async()=>{
  const w=(await writer.boot()).body, s=(await sales.boot()).body
  expect(w.channels).toEqual([])
  expect(ids(w.orderChannels)).toEqual([own,foreign].sort())
  expect(ids(s.orderChannels)).toEqual([own,foreign].sort())
  expect(s.orderChannels.find((c:{id:string})=>c.id===foreign)).toEqual({id:foreign,name:'小羊渠道'})
  expect(JSON.stringify(w)).not.toContain('老板空渠道')
})
it('猜到别人的渠道 ID 也不能录单、改渠道、导出、对账或创建分享',async()=>{
  expect((await sales.act('order.create',payload(foreign))).status).toBe(404)
  expect((await sales.act('order.update',{id:mine,patch:{channelId:foreign}})).status).toBe(404)
  expect((await sales.act('share.create',{channelId:foreign,month:'2026-10',days:1})).status).toBe(404)
  const headers={cookie:sales.cookie,'content-type':'application/json'}
  expect((await exportChannel(new Request('http://test.local/api/export/channel',{method:'POST',headers,body:JSON.stringify({channelId:foreign,columns:['no'],language:'zh'})}),{params:Promise.resolve({})})).status).toBe(404)
  expect((await statement(new Request(`http://test.local/api/statement?channelId=${foreign}&month=2026-10`,{headers}),{params:Promise.resolve({})})).status).toBe(404)
  expect((await statement(new Request(`http://test.local/api/statement?channelId=${own}&month=2026-10`,{headers}),{params:Promise.resolve({})})).status).toBe(200)
  expect((await exportChannel(new Request('http://test.local/api/export/channel',{method:'POST',headers,body:JSON.stringify({channelId:own,columns:['no'],language:'zh'})}),{params:Promise.resolve({})})).status).toBe(200)
})
it('订单增量更新只附带本次可见订单的渠道标识',async()=>{
  const response=await ordersDelta(new Request(`http://test.local/api/orders?ids=${oldOrder},${assigned}`,{headers:{cookie:sales.cookie}}),{params:Promise.resolve({})})
  const data=await response.json()
  expect(data.orders.map((o:{id:string})=>o.id)).toEqual([oldOrder])
  expect(data.orderChannels).toEqual([{id:foreign,name:'小羊渠道'}])
})
it('允许销售为自己的渠道录单；新建渠道不能伪造其他归属',async()=>{
  expect((await sales.act('order.create',payload(own))).status).toBe(200)
  const created=await sales.act('channel.create',{name:'销售新建',ownerId:'u-boss'})
  expect(created.status).toBe(200)
  expect((await sales.boot()).body.channels.find((c:{id:string})=>c.id===created.body.id).ownerId).toBe('u-acheng')
})
it('即使给销售管理权限和全部订单范围，仍不能操作别人的渠道或转给他人',async()=>{
  const boot=(await boss.boot()).body, role=boot.roles.find((r:{id:string})=>r.id==='r-sales')
  const updated=await boss.act('role.save',{...role,perms:[...new Set([...role.perms,'channel.manage','order.assign','trash.view'])],rowScope:'all'})
  expect(updated.status).toBe(200)
  expect(ids((await sales.boot()).body.channels)).not.toContain(foreign)
  for(const [name,payload] of [
    ['channel.update',{id:foreign,patch:{name:'错误改名'}}],
    ['channel.toggle',{id:foreign}],
    ['channel.transferPreview',{id:foreign}],
    ['channel.delete',{id:empty}],
    ['channel.delete',{id:own,targetId:foreign}],
    ['channel.delete',{id:own}],
    ['channel.transferPreview',{id:own}],
    ['channel.toggle',{id:own}],
  ] as const) expect((await sales.act(name,payload)).status,name).toBe(403)
  expect((await sales.act('channel.update',{id:own,patch:{ownerId:'u-yang'}})).status).toBe(403)
  expect((await sales.act('channel.update',{id:own,patch:{note:'自己的渠道也不能改备注'}})).status).toBe(403)
  expect((await boss.act('channel.delete',{id:empty})).status).toBe(200)
  expect((await sales.boot()).body.trashChannels).toEqual([])
  expect((await sales.act('channel.restore',{id:empty})).status).toBe(403)
})
it('销售可改自己的头像，不能改他人头像；扩大角色权限也不能伪造新渠道归属',async()=>{
  const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='
  expect((await sales.act('channel.update',{id:own,patch:{avatar}})).status).toBe(200)
  expect((await sales.boot()).body.channels.find((c:{id:string})=>c.id===own).avatar).toMatch(/^\/api\/img\//)
  expect((await sales.act('channel.update',{id:foreign,patch:{avatar}})).status).toBe(404)
  expect((await writer.act('channel.update',{id:own,patch:{avatar}})).status).toBe(403)
  expect((await sales.act('channel.update',{id:own,patch:{avatar:null}})).status).toBe(200)
  const created=await sales.act('channel.create',{name:'扩大权限仍归自己',ownerId:'u-boss'})
  expect(created.status).toBe(200)
  expect((await sales.boot()).body.channels.find((c:{id:string})=>c.id===created.body.id).ownerId).toBe('u-acheng')
})
it('老板转交渠道后，渠道名单和关联订单归属立即同步',async()=>{
  expect((await boss.act('channel.update',{id:own,patch:{ownerId:'u-yang'}})).status).toBe(200)
  expect(ids((await sales.boot()).body.channels)).not.toContain(own)
  expect(ids((await other.boot()).body.channels)).toContain(own)
  const [row]=await sql`select owner_id from orders where id=${mine}`
  expect(row.owner_id).toBe('u-yang')
})
