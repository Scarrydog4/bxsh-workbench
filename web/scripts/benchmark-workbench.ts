/** 仅用于独立 benchmark 库；--seed 建 1000 条合成订单，不接触真实库。 */
import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { db, sql } from '../src/server/db'
import * as t from '../src/server/schema'
import { migrateAndSeed } from '../src/server/setup'
import { hashPassword } from '../src/server/password'
import { loadWorld } from '../src/server/repo'
import { buildBoot } from '../src/server/bootstrap'
import { compactOrder } from '../src/shared/order-wire'
import { broadcast } from '../src/server/events'
import { eq } from 'drizzle-orm'
if(!new URL(process.env.DATABASE_URL??'http://invalid').pathname.includes('_benchmark_'))throw new Error('只允许独立 benchmark 库')
if(process.argv.includes('--seed')) {
 await migrateAndSeed(sql)
 const [{n}]=await sql`select count(*)::int n from orders`
 if(n!==0)throw new Error('只在空的 benchmark 库造数据')
 const password=process.env.BENCHMARK_PASSWORD
 if(!password)throw new Error('请设置测试账号密码')
 const passwordHash=await hashPassword(password)
 await db.insert(t.users).values([{id:'benchmark-boss',name:'老板',account:'boss',roleId:'r-admin',hue:20,canWrite:true,passwordHash,mustChangePassword:false},{id:'benchmark-writer',name:'测试写手',account:'writer',roleId:'r-writer',hue:160,canWrite:true,passwordHash,mustChangePassword:false}])
 await db.insert(t.channels).values(Array.from({length:20},(_,i)=>({id:`benchmark-channel-${i}`,name:`测试渠道 ${i+1}`,ownerId:'benchmark-boss'})))
 for(let batch=0;batch<10;batch++) {
  const rows=Array.from({length:100},(_,i)=>{const n=batch*100+i;return {id:`benchmark-order-${n}`,no:`DD261008${String(n+1).padStart(4,'0')}`,title:`测试订单 ${n+1} · 工程设计与业务流程研究`,orderDate:'2026-10-08',dueDate:'2026-10-18',ownerId:'benchmark-boss',creatorId:'benchmark-boss',channelId:`benchmark-channel-${n%20}`,type:n%2?'本科':'专科',basePrice:300+n%10*100,status:n%3?'未交付':'已交付',commissionRate:.5}})
  await db.insert(t.orders).values(rows)
  await db.insert(t.orderWriters).values(rows.map(r=>({orderId:r.id,userId:'benchmark-writer',pay:150,sort:0})))
  await db.insert(t.payments).values(rows.map(r=>({id:r.id+'-payment',orderId:r.id,amount:100,date:'2026-10-08',tag:'定金',by:'benchmark-boss'})))
 }
}
const w=await loadWorld(db,{includeDeleted:true}),me=w.users.find(u=>u.account==='boss')!,c={me:{...me,mustChangePassword:false},role:w.roles.find(r=>r.id===me.roleId)!,sessionId:'benchmark',ip:''}
const times:number[]=[];let bytes=0,gzip=0
for(let i=0;i<12;i++){if(i===0)broadcast();const start=performance.now();const boot=await buildBoot(c,true);const wire=JSON.stringify({...boot,orders:boot.orders.map(compactOrder)});times.push(performance.now()-start);bytes=Buffer.byteLength(wire);gzip=gzipSync(wire).length}
const id=w.orders[0].id
await db.update(t.orders).set({note:'基准 '+Date.now()}).where(eq(t.orders.id,id));broadcast('changed',[id])
const start=performance.now(),next=await buildBoot(c,true),updatedMs=performance.now()-start
const warm=times.slice(1).sort((a,b)=>a-b)
console.log(JSON.stringify({orders:w.orders.length,rawBytes:bytes,gzipBytes:gzip,coldMs:+times[0].toFixed(2),warmMedianMs:+warm[Math.floor(warm.length/2)].toFixed(2),warmMaxMs:+warm.at(-1)!.toFixed(2),afterOneChangeMs:+updatedMs.toFixed(2),oneOrderBytes:Buffer.byteLength(JSON.stringify(compactOrder(next.orders.find(o=>o.id===id)!)))},null,2))
await sql.end()
