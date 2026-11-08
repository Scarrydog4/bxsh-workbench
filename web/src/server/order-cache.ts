import { calc } from '@/shared/calc'
import { project } from '@/shared/perm'
import type { Order, OrderView, Role, User } from '@/shared/types'

type Entry={fingerprint:string;calculated:ReturnType<typeof calc>;views:Map<string,OrderView>}
const entries=new Map<string,Entry>()
// 数据版本变化后整库快照重读；内容未变的订单复用计算结果。用户 id 是权限缓存键的一部分。
function entry(order:Order,admins:Set<string>) {
 const fingerprint=JSON.stringify(order)+'|'+[...admins].sort().join(',')
 let cached=entries.get(order.id)
 if(!cached||cached.fingerprint!==fingerprint){cached={fingerprint,calculated:calc(order,admins),views:new Map()};entries.set(order.id,cached)}
 if(entries.size>5000)entries.delete(entries.keys().next().value!)
 return cached
}
export const cachedCalc=(order:Order,admins:Set<string>)=>entry(order,admins).calculated
export function cachedProject(order:Order,user:User,role:Role,admins:Set<string>) {
 const cached=entry(order,admins),key=user.id+'|'+JSON.stringify(role)
 let result=cached.views.get(key)
 if(!result){result=project(order,user,role,admins,cached.calculated);cached.views.set(key,result)}
 if(cached.views.size>100)cached.views.delete(cached.views.keys().next().value!)
 return result
}
