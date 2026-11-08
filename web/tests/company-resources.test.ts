import { afterAll, beforeAll, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { GET as getCodes, POST as saveCode } from '@/app/api/resources/payments/route'
import { GET as getImage } from '@/app/api/resources/payments/[kind]/image/route'
import { GET as getApk } from '@/app/api/download/android/route'
import { ANDROID_RELEASE } from '@/shared/company-resources'
import { env } from '@/server/env'
import { sql } from '@/server/db'
import { as, closeDb, resetDb, type Client } from './helpers'

let boss: Client, sales: Client, writer: Client, png: Buffer
const params = { params: Promise.resolve({}) }
const req = (client?: Client, body?: unknown) => new Request('http://test.local/api/resources/payments', { method: body === undefined ? 'GET' : 'POST', headers: { ...(client ? { cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const pic = (client?: Client, query = '', kind = 'wechat') => getImage(new Request(`http://test.local/api/resources/payments/${kind}/image${query}`, { headers: client ? { cookie: client.cookie } : {} }), { params: Promise.resolve({ kind }) })
const apkPath = path.join(env.storageDir, 'releases', ANDROID_RELEASE.filename)
beforeAll(async () => {
  await resetDb(); boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai')
  png = await sharp({ create: { width: 121, height: 201, channels: 4, background: '#123456' } }).png().toBuffer()
})
afterAll(closeDb)

it('收款码仅老板与销售可见，默认留空', async () => {
  expect((await getCodes(req(), params)).status).toBe(401)
  expect((await getCodes(req(writer), params)).status).toBe(403)
  const response = await getCodes(req(sales), params)
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ wechat: null, alipay: null })
  expect((await pic(sales)).status).toBe(404)
})
it('只有老板可以上传，微信与支付宝独立保存且不写入收款工资', async () => {
  const body = { kind: 'wechat', image: `data:image/png;base64,${png.toString('base64')}` }
  for (const client of [sales, writer]) expect((await saveCode(req(client, body), params)).status).toBe(403)
  const response = await saveCode(req(boss, body), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ wechat: expect.stringMatching(/^\/api\/resources\/payments\/wechat\/image\?v=[a-f0-9]{64}$/), alipay: null })
  const rows = await sql`select (select count(*) from orders) as orders, (select count(*) from payments) as payments, (select count(*) from settlements) as wages`
  expect(rows[0]).toMatchObject({ orders: '0', payments: '0', wages: '0' })
})
it('原图不裁切不缩小，销售可以下载，未登录与写手不能直接访问图片', async () => {
  expect((await pic()).status).toBe(401); expect((await pic(writer)).status).toBe(403)
  const response = await pic(sales, '?download=1')
  expect(response.status).toBe(200)
  expect(response.headers.get('content-disposition')).toContain('attachment;')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const downloaded = Buffer.from(await response.arrayBuffer())
  expect(await sharp(downloaded).metadata()).toMatchObject({ width: 121, height: 201, format: 'png' })
  expect(await sharp(downloaded).raw().toBuffer()).toEqual(await sharp(png).raw().toBuffer())
})
it('拒绝无效图片和伪造路径，更新前的旧链接不再返回旧收款码', async () => {
  expect((await saveCode(req(boss, { kind: 'wechat', image: 'data:image/png;base64,AAAA' }), params)).status).toBe(400)
  expect((await pic(boss, '', '../avatars')).status).toBe(404)
  expect((await pic(boss, '?v=old-hash')).status).toBe(404)
  const response = await saveCode(req(boss, { kind: 'alipay', image: `data:image/png;base64,${png.toString('base64')}` }), params)
  const codes = await response.json()
  expect(codes.wechat).toBeTruthy(); expect(codes.alipay).toBeTruthy()
})
it('安卓安装包无需登录即可下载，文件名、长度和内容均正确', async () => {
  const data = Buffer.from('APK download test bytes')
  await mkdir(path.dirname(apkPath), { recursive: true }); await writeFile(apkPath, data)
  const response = await getApk(new Request('http://localhost/api/download/android'))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/vnd.android.package-archive')
  expect(response.headers.get('content-disposition')).toContain(ANDROID_RELEASE.filename)
  expect(Number(response.headers.get('content-length'))).toBe(data.length)
  expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(apkPath))
})
it('安装包缺失时返回明确错误，不把网页内容当作APK', async () => {
  await rm(apkPath)
  const response = await getApk(new Request('http://localhost/api/download/android'))
  expect(response.status).toBe(503); expect(response.headers.get('content-disposition')).toBeNull()
})
