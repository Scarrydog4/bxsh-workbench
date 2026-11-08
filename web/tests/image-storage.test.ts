import { beforeAll, afterAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { GET as avatar } from '@/app/api/img/[name]/route'
import { GET as fileGet } from '@/app/api/files/[id]/route'
import sharp from 'sharp'
import { as, resetDb, closeDb, type Client } from './helpers'
let boss:Client,sales:Client,writer:Client,other:Client,orderId:string
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII='
beforeAll(async()=>{await resetDb();boss=await as('boss');sales=await as('acheng');writer=await as('xiaosenkai');other=await as('xiaoyang');const ch=(await boss.act('channel.create',{name:'图片迁移测试',ownerId:'u-acheng',avatar:image})).body.id;orderId=(await sales.act('order.create',{title:'图片授权',channelId:ch,ownerId:'u-acheng',orderDate:'2026-10-08',dueDate:null,basePrice:500})).body.id})
afterAll(closeDb)
it('头像为内容哈希文件、支持缓存，返回真实WebP',async()=>{const boot=(await boss.boot()).body;const url=boot.channels[0].avatar;expect(url).toMatch(/^\/api\/img\/[a-f0-9]{64}\.96\.webp$/);const r=await avatar(new Request('http://test.local'+url),{params:Promise.resolve({name:url.split('/').at(-1)})});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('immutable');const bytes=Buffer.from(await r.arrayBuffer());expect(bytes.toString('ascii',8,12)).toBe('WEBP')})
it('售后截图只保存附件id，负责人可看，其他销售不可看',async()=>{const a=await sales.act('aftersale.create',{orderId,req:[],shots:[image]});expect(a.status).toBe(200);const row=(await db.select().from(t.afterSales).where(eq(t.afterSales.id,a.body.id)))[0];expect(row.shots[0]).toMatch(/^img_/);expect((await writer.file(row.shots[0])).status).toBe(200);expect((await other.file(row.shots[0])).status).toBe(404);expect(JSON.stringify((await writer.boot()).body)).not.toContain('data:image')})
it('收款凭证保持访问权限，带图收款重试仍只入账一次',async()=>{const requestId=randomUUID(),payload={id:orderId,amount:100,date:'2026-10-08',tag:'定金',proof:image,requestId};expect((await sales.act('order.addPayment',payload)).status).toBe(200);expect((await sales.act('order.addPayment',payload)).status).toBe(200);const rows=await db.select().from(t.payments).where(eq(t.payments.orderId,orderId));expect(rows).toHaveLength(1);const id=rows[0].proof!.split('/')[3].split('?')[0];expect((await sales.file(id)).status).toBe(200);expect((await writer.file(id)).status).toBe(404);expect((await other.file(id)).status).toBe(404);expect((await sales.act('order.addPayment',{...payload,amount:200})).status).toBe(400)})

it('上传自动生成小图；同图再次打开返回304，失去订单权限后不能凭缓存读取', async () => {
  const bytes = await sharp({ create: { width: 1876, height: 1300, channels: 3, background: '#279b80' } }).png().toBuffer()
  const result = await writer.upload(orderId, '初稿交付截图.png', bytes, undefined, 'image/png')
  expect(result.status).toBe(200)
  const id = result.body.id, params = { params: Promise.resolve({ id }) }
  const read = (cookie: string, query: string, etag = '') => fileGet(new Request(`http://test.local/api/files/${id}${query}`, { headers: { cookie, 'if-none-match': etag } }), params)
  const thumb = await read(writer.cookie, '?thumb=1')
  expect(thumb.status).toBe(200)
  expect(thumb.headers.get('content-type')).toBe('image/webp')
  const small = Buffer.from(await thumb.arrayBuffer()), meta = await sharp(small).metadata()
  expect(meta.width).toBe(256); expect(small.length).toBeLessThan(bytes.length)
  const etag = thumb.headers.get('etag')!
  expect((await read(writer.cookie, '?thumb=1', etag)).status).toBe(304)
  expect((await read(other.cookie, '?thumb=1', etag)).status).toBe(404)
  const full = await read(writer.cookie, '?inline=1', etag)
  expect(full.status).toBe(200); expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes)
  await db.delete(t.orderWriters).where(eq(t.orderWriters.orderId, orderId))
  expect((await read(writer.cookie, '?thumb=1', etag)).status).toBe(404)
})
