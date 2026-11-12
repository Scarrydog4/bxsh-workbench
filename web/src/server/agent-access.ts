import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import * as t from './schema'
import { can, project, rowVisible } from '@/shared/perm'
import { fuzzyMatch } from '@/shared/search'
import { loadWorld, adminIdsOf } from './repo'
import { incomeRows } from './bootstrap'
import { deny, HttpError } from './http'
import { log, WRITE_LOCK } from './actions'
import { clientIp, type Ctx } from './session'
import type { Role } from '@/shared/types'
export type AgentScope='orders'|'income'
const hash=(token:string)=>createHash('sha256').update(token).digest('hex')
export async function listAgentTokens(c:Ctx){
  return db.select({id:t.agentTokens.id,name:t.agentTokens.name,scopes:t.agentTokens.scopes,expiresAt:t.agentTokens.expiresAt,revokedAt:t.agentTokens.revokedAt}).from(t.agentTokens).where(eq(t.agentTokens.userId,c.me.id))
}
export async function issueAgentToken(c:Ctx,name:string,scopes:AgentScope[],days:number){
  if(!can(c.role,'order.view'))throw deny()
  const token='bxsh_ro_'+randomBytes(32).toString('base64url'),id=randomUUID(),expiresAt=new Date(Date.now()+days*86400000).toISOString()
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    await tx.insert(t.agentTokens).values({id,hash:hash(token),userId:c.me.id,name,scopes,expiresAt})
    await log(tx,c,{action:'创建只读 Agent 令牌',objectType:'user',objectId:c.me.id,objectLabel:name,to:scopes.join('、')})
  })
  return {id,token,expiresAt}
}
export async function revokeAgentToken(c:Ctx,id:string){
  await db.transaction(async tx=>{
    const changed=await tx.update(t.agentTokens).set({revokedAt:new Date().toISOString()}).where(and(eq(t.agentTokens.id,id),eq(t.agentTokens.userId,c.me.id),isNull(t.agentTokens.revokedAt))).returning({id:t.agentTokens.id})
    if(changed.length)await log(tx,c,{action:'撤销 Agent 令牌',objectType:'user',objectId:c.me.id})
  })
}
export async function agentContext(req:Request){
  const token=req.headers.get('authorization')?.match(/^Bearer (bxsh_ro_[\w-]+)$/)?.[1]
  if(!token)throw new HttpError(401,'请提供有效的只读令牌')
  const [row]=await db.select({token:t.agentTokens,u:t.users,r:t.roles}).from(t.agentTokens).innerJoin(t.users,eq(t.users.id,t.agentTokens.userId)).innerJoin(t.roles,eq(t.roles.id,t.users.roleId)).where(and(eq(t.agentTokens.hash,hash(token)),isNull(t.agentTokens.revokedAt),gt(t.agentTokens.expiresAt,new Date().toISOString())))
  if(!row||!row.u.active||row.u.mustChangePassword)throw new HttpError(401,'令牌已失效，请重新授权')
  const c:Ctx={me:{id:row.u.id,name:row.u.name,account:row.u.account,roleId:row.u.roleId,hue:row.u.hue,commissionRate:row.u.commissionRate,salesMode:row.u.salesMode,canWrite:row.u.canWrite,active:row.u.active,mustChangePassword:false},role:{...row.r,perms:row.r.perms as Role['perms'],fields:row.r.fields as unknown as Role['fields'],rowScope:row.r.rowScope as Role['rowScope']},sessionId:row.token.id,ip:clientIp(req)}
  if(!can(c.role,'order.view'))throw deny()
  return {c,scopes:row.token.scopes}
}
export async function queryAgent(c:Ctx,scopes:AgentScope[],input:{tool:'orders_search'|'income_rows';query?:string;from?:string;to?:string;targetId?:string;offset:number;limit:number}){
  const world=await loadWorld(db,{includeDeleted:true})
  if(input.tool==='income_rows'){
    if(!scopes.includes('income'))throw deny('此令牌未开放收入查询')
    const target=input.targetId||c.me.id
    if(target!==c.me.id&&!can(c.role,'income.all'))throw deny()
    const rows=(await incomeRows(c,target,world)).filter(r=>(!input.from||r.date>=input.from)&&(!input.to||r.date<=input.to)&&fuzzyMatch([r.title,r.no,r.kind],input.query||''))
    return {basis:'原订单收入明细；应得与已结算分开，不代表已到账',total:rows.length,rows:rows.slice(input.offset,input.offset+input.limit),next:input.offset+input.limit<rows.length?input.offset+input.limit:null}
  }
  if(!scopes.includes('orders'))throw deny('此令牌未开放订单查询')
  const admins=adminIdsOf(world),rows=world.orders.filter(o=>!o.deletedAt&&rowVisible(o,c.me,c.role)&&(!input.from||o.orderDate>=input.from)&&(!input.to||o.orderDate<=input.to)&&fuzzyMatch([o.title,o.no,o.type,o.note],input.query||''))
  const allowed=['id','no','title','status','type','orderDate','dueDate','draftAt','ownerId',...(scopes.includes('income')?['sales','received','unpaid','myPay','commission','proxyFee','writerTotal','profit']:[])]
  return {total:rows.length,rows:rows.slice(input.offset,input.offset+input.limit).map(o=>Object.fromEntries(Object.entries(project(o,c.me,c.role,admins)).filter(([key])=>allowed.includes(key)))),next:input.offset+input.limit<rows.length?input.offset+input.limit:null}
}
