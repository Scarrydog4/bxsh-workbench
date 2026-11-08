/**
 * 测试工具：重建测试库、建测试账号，直接调用路由处理函数（和真实 HTTP 请求走同一份代码）。
 */
import { expandOrder } from '@/shared/order-wire'
import { GET as incomeGet } from '@/app/api/income/route'
import { GET as auditGet } from '@/app/api/audit/route'
import { sql } from '@/server/db'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { migrateAndSeed } from '@/server/setup'
import { hashPassword } from '@/server/password'
import { POST as login } from '@/app/api/auth/login/route'
import { GET as bootstrap } from '@/app/api/bootstrap/route'
import { POST as actRoute } from '@/app/api/act/[name]/route'
import { GET as activity } from '@/app/api/orders/[id]/activity/route'
import { GET as exportOrders } from '@/app/api/export/orders/route'
import { POST as uploadInit } from '@/app/api/upload/route'
import { PUT as uploadPut, GET as uploadGet } from '@/app/api/upload/[id]/route'
import { POST as uploadDone } from '@/app/api/upload/[id]/complete/route'
import { GET as fileGet } from '@/app/api/files/[id]/route'
import { POST as changePassword } from '@/app/api/auth/password/route'

export const PW = 'Test-pass-1234'

export const PEOPLE = {
  boss: { id: 'u-boss', name: '老板', account: 'boss', roleId: 'r-admin', canWrite: false },
  acheng: { id: 'u-acheng', name: '阿城', account: 'acheng', roleId: 'r-sales', canWrite: false },
  yang: { id: 'u-yang', name: '小羊老师', account: 'xiaoyang', roleId: 'r-sales', canWrite: false },
  xiao: { id: 'u-xiao', name: '肖森凯', account: 'xiaosenkai', roleId: 'r-writer', canWrite: true },
} as const

export async function resetDb() {
  await sql.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;')
  await migrateAndSeed(sql)
  const hash = await hashPassword(PW)
  for (const p of Object.values(PEOPLE)) await db.insert(t.users).values({ ...p, hue: 100, passwordHash: hash, mustChangePassword: false })
  await db.insert(t.options).values({ key: 'defaultWriter', values: ['u-xiao'] })
}

const base = 'http://test.local'
const noParams = { params: Promise.resolve({}) }

export async function loginAs(account: string, password = PW) {
  const r = await login(new Request(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password }) }))
  const cookie = r.headers.get('set-cookie')?.split(';')[0] ?? ''
  return { status: r.status, cookie, body: await r.json() }
}

export type Client = Awaited<ReturnType<typeof as>>

/** 以某个账号的身份调接口 */
export async function as(account: string, password = PW) {
  const { cookie, status } = await loginAs(account, password)
  if (status !== 200) throw new Error(`登录失败 ${account}`)
  const h = (extra: Record<string, string> = {}) => ({ cookie, ...extra })
  return {
    cookie,
    async boot() {
      const r = await bootstrap(new Request(`${base}/api/bootstrap`, { headers: h() }), noParams)
      const body=await r.json()
      if(r.ok){
        body.orders=body.orders.map(expandOrder)
        const targets=body.role.locked||body.role.perms.includes('income.all')?body.users.map((u:{id:string})=>u.id):[body.me.id]
        for(const target of targets){let offset:number|null=0;const rows=[];while(offset!==null){const ir=await incomeGet(new Request(`${base}/api/income?user=${target}&offset=${offset}`,{headers:h()}),noParams);if(!ir.ok)break;const page=await ir.json();rows.push(...page.rows);offset=page.next}body.income[target]=rows}
        if(body.role.locked||body.role.perms.includes('audit.view')){let before:number|null=null;for(let page=0;page<8;page++){const ar=await auditGet(new Request(`${base}/api/audit?views=1${before?'&before='+before:''}`,{headers:h()}),noParams);if(!ar.ok)break;const data=await ar.json();body.audit.push(...data.rows);before=data.next;if(before===null)break}}
      }
      return { status: r.status, body }
    },
    async act(name: string, payload: unknown) {
      const r = await actRoute(new Request(`${base}/api/act/${name}`, { method: 'POST', headers: h({ 'content-type': 'application/json' }), body: JSON.stringify(payload) }), { params: Promise.resolve({ name }) })
      return { status: r.status, body: await r.json() }
    },
    async activity(id: string) {
      const r = await activity(new Request(`${base}/api/orders/${id}/activity`, { headers: h() }), { params: Promise.resolve({ id }) })
      return { status: r.status, body: await r.json() }
    },
    async exportXlsx(ids?: string[]) {
      const r = await exportOrders(new Request(`${base}/api/export/orders${ids ? `?ids=${ids.join(',')}` : ''}`, { headers: h() }), noParams)
      return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }
    },
    async upload(orderId: string, name: string, data: Buffer, afterSaleId?: string, mime = 'application/octet-stream') {
      const i = await uploadInit(new Request(`${base}/api/upload`, { method: 'POST', headers: h({ 'content-type': 'application/json' }), body: JSON.stringify({ orderId, afterSaleId, name, size: data.length, mime }) }), noParams)
      const init = await i.json()
      if (i.status !== 200) return { status: i.status, body: init }
      // 故意分两片，第二片先用错的偏移量，验证续传逻辑
      const half = Math.ceil(data.length / 2)
      const p = (id: string) => ({ params: Promise.resolve({ id }) })
      await uploadPut(new Request(`${base}/api/upload/${init.id}?offset=0`, { method: 'PUT', headers: h(), body: new Uint8Array(data.subarray(0, half)) }), p(init.id))
      const wrong = await uploadPut(new Request(`${base}/api/upload/${init.id}?offset=0`, { method: 'PUT', headers: h(), body: new Uint8Array(data.subarray(half)) }), p(init.id))
      const st = await (await uploadGet(new Request(`${base}/api/upload/${init.id}`, { headers: h() }), p(init.id))).json()
      await uploadPut(new Request(`${base}/api/upload/${init.id}?offset=${st.received}`, { method: 'PUT', headers: h(), body: new Uint8Array(data.subarray(st.received)) }), p(init.id))
      const d = await uploadDone(new Request(`${base}/api/upload/${init.id}/complete`, { method: 'POST', headers: h({ 'content-type': 'application/json' }), body: '{}' }), p(init.id))
      return { status: d.status, body: await d.json(), wrongOffsetStatus: wrong.status }
    },
    async file(id: string) {
      const r = await fileGet(new Request(`${base}/api/files/${id}`, { headers: h() }), { params: Promise.resolve({ id }) })
      return { status: r.status, buf: r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null }
    },
    async changePassword(current: string, next: string) {
      const r = await changePassword(new Request(`${base}/api/auth/password`, { method: 'POST', headers: h({ 'content-type': 'application/json' }), body: JSON.stringify({ current, next }) }), noParams)
      return { status: r.status, body: await r.json() }
    },
  }
}

export async function closeDb() {
  await sql.end()
}

/** 上传真实图片，走和浏览器相同的分片与存档接口。 */
export async function deliveryProof(client: Client, orderId: string, afterSaleId?: string) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII=', 'base64')
  const result = await client.upload(orderId, '交付截图.png', png, afterSaleId, 'image/png')
  if (result.status !== 200) throw new Error(JSON.stringify(result))
  return [result.body.id as string]
}
