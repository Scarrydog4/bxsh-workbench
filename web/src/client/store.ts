'use client'

import { celebrate } from './rewards/celebrate'
import { clearReportCache } from './report-cache'
import { invalidateAfterSaleTasks } from './query-client'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import type { Boot, PublicUser } from '@/server/bootstrap'
import type { AfterSaleReason, Assignee, OrderView, PermKey, Role, SalesMode } from '@/shared/types'
import { can as roleCan } from '@/shared/perm'
import { expandOrder } from '@/shared/order-wire'
import type { AvatarFrameId } from '@/shared/avatar-frames'
import { previewChange, previewTask, type Preview } from './optimistic'
import type { AfterSaleTask } from '@/shared/aftersale-task'
import type { ActionOptions, ActionResult } from './operation-feedback'
import type { UploadPhase } from './UploadState'

/**
 * 前端缓存：服务端按权限裁剪好的数据（/api/bootstrap）。
 * 写操作走 /api/act，普通订单变更只同步受影响订单。待保存的界面变化独立叠加，失败仅撤销本次。
 */

let state: Boot | null = null
const previews=new Map<symbol,{scope:string;value:Preview}>()
const framePreviews = new Map<symbol, { scope: string; id: string; frame: AvatarFrameId }>()
const frameWrites = new Map<string, Promise<unknown>>()
let snapshot:Boot|null=null
const scope=()=>state?state.me.id+JSON.stringify(state.role):''
function activePreviews(){const key=scope();return [...previews.values()].filter(p=>p.scope===key).map(p=>p.value)}
function currentSnapshot(){
 if(!state)return state!
 if(!snapshot){
  const pending=activePreviews(), frames=new Map([...framePreviews.values()].filter(p=>p.scope===scope()).map(p=>[p.id,p.frame]))
  const framed=<T extends { id:string;frame?:AvatarFrameId }>(u:T):T=>frames.has(u.id)?{...u,frame:frames.get(u.id)!}:u
  snapshot=pending.length||frames.size?{...state,me:frames.size?framed(state.me):state.me,users:frames.size?state.users.map(framed):state.users,orders:pending.length?state.orders.map(o=>pending.reduce((row,p)=>p.ids.has(row.id)?p.order(row):row,o)):state.orders}:state
 }
 return snapshot
}
export function pendingAfterSaleTasks(tasks:AfterSaleTask[]){
 const pending=activePreviews(),known=new Map(state?.orders.flatMap(o=>o.afterSales.map(a=>[a.id,a] as const)))
 return tasks.map(task=>{const current=known.get(task.id);return pending.reduce(previewTask,current?{...task,...current}:task)})
}
const listeners = new Set<() => void>()
const emit = (change?:{orderIds?:string[]}) => { snapshot=null; if(change)invalidateAfterSaleTasks(); listeners.forEach((l) => l()); if(change&&typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bxsh:changed',{detail:change})) }
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export type BootStatus = 'loading' | 'ready' | 'login' | 'mustChange' | 'error'
let status: BootStatus = 'loading'
export type WorkspaceStatus = 'loading' | 'ready' | 'error'
let workspaceStatus: WorkspaceStatus = 'loading'
let inflight: Promise<void> | null = null
let refreshRevision = 0

export async function refresh(fresh = false) {
  if (fresh) refreshRevision++
  if (pending) { clearTimeout(pending); pending = null }
  if (inflight) return inflight
  if (workspaceStatus !== 'ready') { workspaceStatus = 'loading'; if (state) emit() }
  const shellController = new AbortController()
  let active = true
  // Run in parallel, so slow metadata never delays a complete response. After initial boot we keep the existing delta refresh path.
  if (!state && typeof window !== 'undefined') {
    const revision = refreshRevision
    void fetch('/api/bootstrap?phase=shell', { cache: 'no-store', signal: shellController.signal })
      .then(async r => r.ok ? await r.json() as Boot : null)
      .then(data => {
        if (!active || state || !data || revision !== refreshRevision) return
        state = { ...data, orders: [], income: {}, audit: [] }
        status = 'ready'
        emit()
      })
      .catch(() => { /* The complete request owns authentication and retry errors. */ })
  }
  inflight = (async () => {
    try {
      for (;;) {
        const revision = refreshRevision
        const r = await fetch('/api/bootstrap', { cache: 'no-store' })
        const data = await r.json()
        // 写入期间返回的旧快照不能覆盖刚完成的操作，再取一次最新数据。
        if (revision !== refreshRevision) continue
        if (r.status === 401) { clearReportCache(); status = 'login' }
        else if (r.status === 403 && data.mustChangePassword) status = 'mustChange'
        else if (!r.ok) {
          if (workspaceStatus !== 'ready') workspaceStatus = 'error'
          status = state ? 'ready' : 'error'
        }
        else {
          const same=state?.me.id===data.me.id&&JSON.stringify(state?.role)===JSON.stringify(data.role)
          if (state && !same) clearReportCache()
          state = {...data,orders:data.orders.map(expandOrder),income:same?state!.income:{},audit:same?state!.audit:[]}
          workspaceStatus = 'ready'
          status = 'ready'
        }
        break
      }
    } catch {
      if (workspaceStatus !== 'ready') workspaceStatus = 'error'
      status = state ? 'ready' : 'error'
    } finally {
      active = false
      shellController.abort()
      inflight = null
      emit({})
    }
  })()
  return inflight
}

let sse: EventSource | null = null
let pending: ReturnType<typeof setTimeout> | null = null
/** 实时：服务端有改动就推一条，这边 300ms 内合并成一次重新拉取 */
export function connectLive() {
  if (sse || typeof EventSource === 'undefined') return
  sse = new EventSource('/api/events')
  // 论坛、私信：只带资源编号，页面自己重新拉；铃铛只刷新提醒
  for(const kind of ['forum','dm'] as const)sse.addEventListener(kind,e=>{
    const data=JSON.parse((e as MessageEvent).data)
    if(data.resource)window.dispatchEvent(new CustomEvent('bxsh:forum-live',{detail:data.resource}))
    if(noteTimer)clearTimeout(noteTimer)
    noteTimer=setTimeout(()=>{noteTimer=null;void refreshNotes()},400)
  })
  sse.addEventListener('hello', e=>{if(state && Number((e as MessageEvent).data)!==state.version)void refresh(true)})
  sse.addEventListener('changed', e=>{
    const data=JSON.parse((e as MessageEvent).data)
    if(!state || data.version<=state.version)return
    if(Array.isArray(data.orderIds)&&data.orderIds.length&&data.orderIds.length<=200)void refreshOrders(data.orderIds)
    else if(!Array.isArray(data.orderIds)){if(pending)clearTimeout(pending);pending=setTimeout(()=>{pending=null;void refresh(true)},300)}
    else {state={...state,version:data.version};emit()}
  })
}

let noteTimer: ReturnType<typeof setTimeout> | null = null
/** 只刷新提醒（论坛、私信推送后用） */
export async function refreshNotes() {
  const actor=state?.me.id
  const r=await fetch('/api/me/notifications',{cache:'no-store'}).catch(()=>null)
  if(!r?.ok||!state||state.me.id!==actor)return
  const data=await r.json()
  const notes=new Map(state.notifications.map(n=>[n.id,n]));for(const n of data.notifications)notes.set(n.id,n)
  state={...state,unread:data.unread,notifications:[...notes.values()].sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,200)}
  emit()
}

let deltaQueue=Promise.resolve()
export function refreshOrders(ids:string[]) {
  const actor=state?.me.id
  deltaQueue=deltaQueue.then(async()=>{
    if(!state||state.me.id!==actor)return
    refreshRevision++
    const r=await fetch(`/api/orders?ids=${ids.map(encodeURIComponent).join(',')}`,{cache:'no-store'})
    if(!r.ok){if(r.status===401){status='login';emit()}else await refresh(true);return}
    const data=await r.json()
    if(!state||state.me.id!==actor)return
    const changed=new Map<string,OrderView>(data.orders.map((o:Partial<OrderView>)=>[o.id!,expandOrder(o)])),removed=new Set<string>(data.removed)
    const orders=state.orders.filter(o=>!removed.has(o.id)).map(o=>{const next=changed.get(o.id);if(next)changed.delete(o.id);return next??o})
    orders.push(...changed.values());orders.sort((a,b)=>b.no.localeCompare(a.no))
    const notes=new Map(state.notifications.map(n=>[n.id,n]));for(const n of data.notifications)notes.set(n.id,n)
    const channelIds=new Set([...orders,...state.trash].map(o=>o.channelId))
    const labels=new Map([...(state.orderChannels??[]),...(data.orderChannels??[])].filter(ch=>channelIds.has(ch.id)).map(ch=>[ch.id,ch]))
    state={...state,orders,orderChannels:[...labels.values()],changedOrderIds:ids,version:data.version,unread:data.unread,notifications:[...notes.values()].sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,200)}
    emit({orderIds:ids})
  }).catch(()=>{void refresh(true)})
  return deltaQueue
}
const incomeRequests = new Map<string, Promise<boolean>>()
const incomeLoaded = new Map<string, number>()
export function loadIncome(target: string): Promise<boolean> {
  const actor = state?.me.id, version = state?.version
  const key = JSON.stringify([actor, state?.role, version, target])
  if (state?.income[target] && Date.now() - (incomeLoaded.get(key) ?? 0) < 30_000) return Promise.resolve(true)
  const pending = incomeRequests.get(key)
  if (pending) return pending
  const work = (async () => {
    try {
      const rows: Boot['income'][string] = []
      let offset: number | null = 0
      while (offset !== null) {
        const response: Response = await fetch(`/api/income?user=${encodeURIComponent(target)}&offset=${offset}&limit=1000`)
        if (!response.ok) return false
        const data: { rows: Boot['income'][string]; next: number | null } = await response.json()
        rows.push(...data.rows)
        offset = data.next
      }
      if (!state || state.me.id !== actor || state.version !== version || key !== JSON.stringify([state.me.id, state.role, state.version, target])) return false
      state = { ...state, income: { ...state.income, [target]: rows } }
      incomeLoaded.set(key, Date.now())
      if (incomeLoaded.size > 30) incomeLoaded.delete(incomeLoaded.keys().next().value!)
      emit()
      return true
    } catch { return false }
    finally { incomeRequests.delete(key) }
  })()
  incomeRequests.set(key, work)
  return work
}
let auditQuery='',auditNext:number|null=null,auditRequest=0
export async function loadAudit(query='recent=1',append=false) {
 const request=++auditRequest,actor=state?.me.id,key=actor+query,incremental=!append&&auditQuery===key&&state?.audit.length
 const after=incremental?'&after='+state!.audit[0].id:''
 const r=await fetch('/api/audit?'+query+after);if(!r.ok)throw new Error('审计日志加载失败，请重试');const data=await r.json()
 if(state&&state.me.id===actor&&request===auditRequest){
   const rows=append?[...state.audit,...data.rows]:incremental?[...data.rows,...state.audit]:data.rows
   state={...state,audit:query==='recent=1'?rows.slice(0,20):rows};emit()
   if(!incremental)auditNext=data.next
   if(!append)auditQuery=key
 }
 return auditNext
}

export function useBootStatus() {
  return useSyncExternalStore(subscribe, () => status, () => 'loading' as BootStatus)
}

/** A shell snapshot is not an empty workspace: pages must show loading until the complete snapshot arrives. */
export function useWorkspaceStatus() {
  return useSyncExternalStore(subscribe, () => workspaceStatus, () => 'loading' as WorkspaceStatus)
}

export function getConfirmedOrder(id: string) { return state?.orders.find(order => order.id === id) }

export function getState() {
  return currentSnapshot()
}

export function useAppState() {
  return useSyncExternalStore(subscribe, currentSnapshot, currentSnapshot)
}

export type { PublicUser }

export function salesPeople(s: Boot) {
  return s.users.filter((u) => u.isSales && u.active !== false)
}

// 订单页只订阅它用到的数据；通知、审计、收入刷新不让整张表重新计算。
const tableKeys = ['me', 'role', 'users', 'channels', 'orderChannels', 'orders', 'statuses'] as const
type TableData = Pick<Boot, typeof tableKeys[number]>
function makeTableSession(s: TableData, previous?: {
  s: TableData; adminIds: Set<string>; can: (p: PermKey) => boolean
  user: (id: string) => PublicUser | undefined
  channel: (id: string) => NonNullable<Boot['orderChannels']>[number] | undefined
  order: (id: string) => OrderView | undefined
}) {
  const sameUsers = previous?.s.users === s.users
  const sameChannels = previous?.s.channels === s.channels && previous?.s.orderChannels === s.orderChannels
  const users = sameUsers ? undefined : new Map(s.users.map(u => [u.id, u]))
  const channels = sameChannels ? undefined : new Map([...(s.orderChannels ?? []), ...s.channels].map(ch => [ch.id, ch]))
  const sameOrders = previous?.s.orders === s.orders
  const orders = sameOrders ? undefined : new Map(s.orders.map(o => [o.id, o]))
  return {
    s, me: s.me, role: s.role, views: s.orders,
    adminIds: sameUsers ? previous!.adminIds : new Set(s.users.filter(u => u.isAdmin).map(u => u.id)),
    can: previous?.s.role === s.role ? previous.can : (p: PermKey) => roleCan(s.role, p),
    user: sameUsers ? previous!.user : (id: string) => users!.get(id),
    channel: sameChannels ? previous!.channel : (id: string) => channels!.get(id),
    order: sameOrders ? previous!.order : (id: string) => orders!.get(id),
  }
}
let tableSession: ReturnType<typeof makeTableSession> | undefined
function selectTableSession(s: Boot) {
  if (!tableSession || tableKeys.some(key => tableSession!.s[key] !== s[key])) {
    // 显式截取字段，避免向调用者暴露过期的通知或其他全局状态。
    const data: TableData = { me: s.me, role: s.role, users: s.users, channels: s.channels, orderChannels: s.orderChannels, orders: s.orders, statuses: s.statuses }
    tableSession = makeTableSession(data, tableSession)
  }
  return tableSession
}
function currentTableSession() { return selectTableSession(currentSnapshot()) }
export function useOrderTableSession() {
  return useSyncExternalStore(subscribe, currentTableSession, currentTableSession)
}

/** 当前账号、角色、按权限裁剪后的订单（服务端已裁好） */
function sessionFor(s: Boot) { return { ...selectTableSession(s), s } }
const sessions = new WeakMap<Boot, ReturnType<typeof sessionFor>>()
export function useSession() {
  const s = useAppState()
  let session = sessions.get(s)
  if (!session) { session = sessionFor(s); sessions.set(s, session) }
  return session
}

// ---------- 调接口 ----------

export async function act<T = { ok: true }>(name: string, payload: unknown, opts: ActionOptions & { onRejected?: () => void } = {}): Promise<T | null> {
  let result: ActionResult
  try {
    const r = await fetch(`/api/act/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await r.json().catch(() => null)
    const rejected = r.status >= 400 && r.status < 500 && r.status !== 408
    if (rejected) opts.onRejected?.()
    if (r.ok && data !== null) {
      opts.onResult?.({ status: 'success' })
      return data as T
    }
    result = { status: rejected ? 'error' : 'uncertain', message: rejected ? data?.error ?? '未能保存，请检查后重试' : '结果尚未确认，内容已保留，请核对后重试' }
    if (r.status === 401) { status = 'login'; emit() }
  } catch {
    result = { status: 'uncertain', message: '网络中断，结果尚未确认；内容已保留，请核对后重试' }
  }
  opts.onResult?.(result)
  if (!opts.silent) toast.error(result.message)
  return null
}

/** 预览不改服务器快照；并发失败不会覆盖其他已成功的修改。 */
async function change<T = { ok: true }>(name: string, payload: unknown, opts: ActionOptions = {}): Promise<T | null> {
  const token=Symbol(name),preview=previewChange(name,payload,state?.me.id??'')
  if(preview&&state){previews.set(token,{scope:scope(),value:preview});emit()}
  try {
    const r = await act<T>(name, payload, opts)
    if (r) {
      // Acknowledgement must not turn a confirmed write into a failed write.
      try { await opts.onConfirmed?.() } catch { /* still refresh the confirmed result */ }
      const i=payload as Record<string,unknown>, result=r as Record<string,unknown>
      const ids=name.startsWith('order.') ? (Array.isArray(i.ids)?i.ids as string[]:[String(i.id??result.id??'')]).filter(Boolean) : name.startsWith('aftersale.') ? [String(i.orderId)] : undefined
      if(ids?.length&&ids.length<=200&&!['order.delete','order.restore'].includes(name))await refreshOrders(ids)
      else await refresh(true)
    }
    return r
  } finally { if(previews.delete(token))emit() }
}
const ok = (r: unknown) => r !== null

type Editable = Partial<{ title: string; orderDate: string; dueDate: string | null; ownerId: string; salesMode: SalesMode; channelId: string; channelNo: string; wechatGroup: string; type: string; basePrice: number; status: string; note: string; progressNote: string }>

export const updateOrder = async (id: string, patch: Editable, memo?: { reason: string; proof?: string }, opts?: ActionOptions) => ok(await change('order.update', { id, patch, ...memo }, opts))
export const bulkStatus = async (ids: string[], status: string, opts?: ActionOptions) => (await change<{ count: number }>('order.bulkStatus', { ids, status }, opts))?.count ?? 0
export const setAssignees = async (id: string, writers: { userId: string; pay?: number | null; rate?: number | null }[], opts?: ActionOptions) => ok(await change('order.setWriters', { id, writers }, opts))
export const addAdjustment = async (id: string, amount: number, reason: string, proof?: string) => ok(await change('order.addAdjustment', { id, amount, reason, proof }))
export const checkPayment = async (id: string, checked: boolean, snapshot: string) => ok(await change('order.checkPayment', { id, checked, snapshot }))
export const restoreChannel = async (id: string) => ok(await change('channel.restore', { id }))
export async function deleteChannel(id: string, targetId?: string) {
  const result = await act<{ ok: true; moved: number }>('channel.delete', { id, targetId })
  if (!result) return null
  if (state) {
    state = {
      ...state,
      channels: state.channels.filter(c => c.id !== id),
      orders: state.orders.map(o => o.channelId === id && targetId ? { ...o, channelId: targetId } : o),
      trash: state.trash.map(o => o.channelId === id && targetId ? { ...o, channelId: targetId } : o),
    }
    emit()
  }
  void refresh(true)
  return result
}
// 没收到成功响应时保留请求号；同一笔重试复用，成功后下一笔使用新号。
const pendingPayments = new Map<string, string>()
export async function addPayment(id: string, p: { amount: number; date: string; tag: string; note: string; proof?: string }, opts?: ActionOptions) {
  const key = JSON.stringify([state?.me.id, id, p])
  const requestId = pendingPayments.get(key) ?? crypto.randomUUID()
  pendingPayments.set(key, requestId)
  const saved = ok(await change('order.addPayment', { id, ...p, requestId }, opts))
  if (saved) pendingPayments.delete(key)
  return saved
}
export const revokePayment = async (id: string, paymentId: string, reason: string) => ok(await change('order.revokePayment', { id, paymentId, reason }))
export const revokeAdjustment = async (id: string, adjustmentId: string, reason: string) => ok(await change('order.revokeAdjustment', { id, adjustmentId, reason }))
export const setOrderImportance = async (id: string, important: boolean, note = '') => ok(await change('order.setImportance', { id, important, note }))
export const setOrderUrgency = async (id: string, urgent: boolean, note = '') => ok(await change('order.setUrgency', { id, urgent, note }))
export const markDraft = async (id: string, proofIds: string[] = [], opts?: ActionOptions) => { const done = ok(await change('order.markDraft', { id, proofIds }, opts)); if (done) celebrate({ kind: 'deliver', orderId: id }); return done }
export const markDemo = async (id: string, proofIds: string[] = [], opts?: ActionOptions) => ok(await change('order.markDraft', { id, proofIds, mode: 'demo' }, opts))
export async function deleteOrders(ids: string[], opts?: ActionOptions & { reason?: string }) {
  const requestScope = scope(), deleted = new Set(ids)
  return ok(await change('order.delete', { ids, reason: opts?.reason ?? '' }, {
    ...opts,
    onConfirmed: async () => {
      // Remove only after the server acknowledges. Do not wait for a slow full refresh.
      if (state && scope() === requestScope) {
        state = { ...state, orders: state.orders.filter(order => !deleted.has(order.id)) }
        emit()
      }
      await opts?.onConfirmed?.()
    },
  }))
}
export const restoreOrders = async (ids: string[], opts?: ActionOptions) => ok(await change('order.restore', { ids }, opts))

export interface NewOrder {
  inquiryId?: string
  /** 替暂停的销售代录：ownerId 是那个销售 */
  proxy?: boolean
  urgent?: boolean
  urgencyNote?: string
  title: string
  suggestedNumber?: string
  orderDate: string
  dueDate: string | null
  ownerId: string
  salesMode?: SalesMode
  channelId: string
  channelNo: string
  type: string
  basePrice: number
  assignees: Assignee[]
  note: string
}
export const createOrder = async (input: NewOrder, via?: string, opts?: ActionOptions) => { const r = await change<{ id: string; no: string; title?: string }>('order.create', { ...input, via }, opts); if (r?.id) celebrate({ kind: 'order', orderId: r.id }); return r }

export const createChannel = (name: string, ownerId: string, avatar?: string) => change<{ id: string }>('channel.create', { name, ownerId, avatar })
export const updateChannel = async (id: string, patch: { ownerId?: string; name?: string; note?: string }) => ok(await change('channel.update', { id, patch }))
export const toggleChannel = async (id: string) => ok(await change('channel.toggle', { id }))
export const setChannelAvatar = async (id: string, avatar: string) => ok(await change('channel.update', { id, patch: { avatar } }))

export const saveRole = async (role: Role) => ok(await change('role.save', { id: role.id.startsWith('new-') ? undefined : role.id, name: role.name, perms: role.perms, fields: role.fields, rowScope: role.rowScope }))
export const createRole = (role: Omit<Role, 'id'>) => change<{ id: string }>('role.save', { name: role.name, perms: role.perms, fields: role.fields, rowScope: role.rowScope })
export const deleteRole = async (id: string) => ok(await change('role.delete', { id }))
export const setUserRole = async (userId: string, roleId: string) => ok(await change('user.update', { id: userId, patch: { roleId } }))
export const setUserCanWrite = async (userId: string, canWrite: boolean) => ok(await change('user.update', { id: userId, patch: { canWrite } }))
export const setUserPaused = async (id: string, paused: boolean) => ok(await change('user.pause', { id, paused }))
export const updateUser = async (userId: string, patch: Partial<{ name: string; commissionRate: number; writerRate: number; salesMode: SalesMode; active: boolean }>) => ok(await change('user.update', { id: userId, patch }))
export const setUserAvatar = async (id: string, avatar: string) => ok(await change('user.avatar', { id, avatar }))
/** Preview immediately; serialize this person's picks so a slower earlier save cannot win. */
export async function setUserFrame(id: string, frame: AvatarFrameId) {
  if (!state) return false
  const token = Symbol('user.frame'), actorScope = scope(), queueKey = `${actorScope}:${id}`
  framePreviews.set(token, { scope: actorScope, id, frame }); emit()
  const write = (frameWrites.get(queueKey) ?? Promise.resolve()).then(async () => {
    if (scope() !== actorScope) return false
    const saved = ok(await change('user.frame', { id, frame }))
    // A confirmed save stays visible even if its follow-up bootstrap refresh is offline.
    if (saved && state && scope() === actorScope) {
      state = { ...state, me: state.me.id === id ? { ...state.me, frame } : state.me, users: state.users.map(u => u.id === id ? { ...u, frame } : u) }
    }
    return saved
  })
  frameWrites.set(queueKey, write)
  try { return await write }
  finally {
    framePreviews.delete(token)
    if (frameWrites.get(queueKey) === write) frameWrites.delete(queueKey)
    emit()
  }
}

export const createUser = (input: { name: string; account: string; roleId: string; canWrite: boolean }) => change<{ id: string; tempPassword: string }>('user.create', input)
export const resetPassword = (id: string) => change<{ tempPassword: string }>('user.resetPassword', { id })
export const forceLogout = async (id: string) => ok(await change('user.forceLogout', { id }))
export const setDefaultWriter = async (userId: string) => ok(await change('settings.defaultWriter', { userId }))
export const updateMe = async (name: string) => ok(await change('me.update', { name }))

export const createAfterSale = (orderId: string, input: { reason: AfterSaleReason; req: string[]; shots: string[]; due?: string; extra: number; writerId?: string }) =>
  change<{ id: string; round: number }>('aftersale.create', { orderId, ...input }).then(r => { if (r?.id) celebrate({ kind: 'followup-new', orderId, afterSaleId: r.id }); return r })
export const confirmAfterSaleHours = async(orderId:string,asId:string,hours:number) => ok(await change('aftersale.confirm',{orderId,asId,hours}))
export const recallAfterSale = async(orderId:string,asId:string) => ok(await change('aftersale.recall',{orderId,asId}))
export const confirmAfterSale = async (orderId: string, asId: string, due: string) => ok(await change('aftersale.confirm', { orderId, asId, due }))
export const finishAfterSale = async (orderId: string, asId: string, proofIds: string[] = [], opts?: ActionOptions) => { const done = ok(await change('aftersale.finish', { orderId, asId, proofIds }, opts)); if (done) celebrate({ kind: 'followup-done', orderId, afterSaleId: asId }); return done }
export const nudgeAfterSale = async (orderId: string, asId: string) => ok(await change('aftersale.nudge', { orderId, asId }))
export const setAfterSaleReason = async (orderId: string, asId: string, reason: AfterSaleReason, money: { extra?: number; charge?: number; requestId?: string } = {}) => ok(await change('aftersale.reason', { orderId, asId, reason, ...money }))
export const updateAfterSale = async (orderId: string, asId: string, patch: { due?: string; writerId?: string }) => ok(await change('aftersale.update', { orderId, asId, ...patch }))

export const clearReview = async (id: string) => ok(await change('order.clearReview', { id }))
export const removeAttachment = async (fileId: string) => ok(await change('attachment.remove', { id: fileId }))

export async function markNotesRead(ids: string[]) {
  if (!state) return
  state = { ...state, readNotes: Array.from(new Set([...state.readNotes, ...ids])) }
  emit()
  await act('notes.read', { ids }, { silent: true })
}

export function logView(orderId: string) {
  void act('log.view', { orderId }, { silent: true })
}
export function logExport(label: string, orderIds: string[]) {
  void act('log.export', { label, orderIds }, { silent: true })
}

// ---------- 上传：分片 + 断点续传，不限大小 ----------

class UploadFailure extends Error { constructor(message: string, readonly status: 'error' | 'uncertain') { super(message) } }
const uploadFailure = (r: Response, message: string) => new UploadFailure(message, r.status >= 400 && r.status < 500 && r.status !== 408 ? 'error' : 'uncertain')
const uploadResult = (e: unknown): ActionResult => ({ status: e instanceof UploadFailure ? e.status : 'uncertain', message: e instanceof UploadFailure && e.status === 'error' ? e.message : '上传结果尚未确认，文件已保留，可继续上传' })
const pendingUploads = new WeakMap<File, Map<string, { id: string; chunk: number }>>()
async function uploadOne(file: File, target: { orderId: string; afterSaleId?: string }, onProgress?: (p: number) => void) {
  const key = JSON.stringify([state?.me.id, target])
  const pending = pendingUploads.get(file) ?? new Map<string, { id: string; chunk: number }>()
  pendingUploads.set(file, pending)
  let info = pending.get(key)
  const resuming = !!info
  if (!info) {
    const init = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...target, name: file.name || '粘贴的图片.png', size: file.size, mime: file.type || 'application/octet-stream' }) })
    const body = await init.json()
    if (!init.ok) throw uploadFailure(init, body.error ?? '上传失败')
    info = { id: body.id, chunk: body.chunk }
    pending.set(key, info)
  }
  const resume = resuming ? await fetch(`/api/upload/${info.id}`).then(r => r.ok ? r.json() : null).catch(() => null) : null
  let offset = resume?.received ?? 0
  let tries = 0
  while (offset < file.size) {
    // 分片先读成字节，避免 Android 相册的临时文件引用在 fetch 发送时失效。
    // 一次只读取当前分片，整份大文件不进入内存。
    const part = await file.slice(offset, offset + info.chunk).arrayBuffer()
    const r = await fetch(`/api/upload/${info.id}?offset=${offset}`, { method: 'PUT', body: part }).catch(() => null)
    if (r?.ok) {
      offset = (await r.json()).received
      tries = 0
      onProgress?.(offset / file.size)
      continue
    }
    // 断了：查服务端收到多少，从那里接着传
    if (++tries > 5) {
      if (r && r.status >= 400 && r.status < 500 && r.status !== 408) throw uploadFailure(r, '上传被拒绝，请检查文件或权限后重试')
      throw new Error('网络不稳定，上传中断了')
    }
    await new Promise((res) => setTimeout(res, 800 * tries))
    const s = await fetch(`/api/upload/${info.id}`).then((x) => (x.ok ? x.json() : null)).catch(() => null)
    if (s) offset = s.received
  }
  onProgress?.(1)
  const done = await fetch(`/api/upload/${info.id}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const result = await done.json()
  if (!done.ok) throw uploadFailure(done, result.error ?? '上传失败')
  pending.delete(key)
  return result.id as string
}

export async function uploadDeliveryShot(file: File, target: { orderId: string; afterSaleId?: string }, onProgress?: (p: number) => void, opts: ActionOptions = {}) {
  try { const id = await uploadOne(file, target, onProgress); opts.onResult?.({ status: 'success' }); return id }
  catch (e) { const result = uploadResult(e); opts.onResult?.(result); if (!opts.silent) toast.error(result.message); return null }
}

export type UploadOptions = ActionOptions & { onFile?: (event: { file: File; index: number; total: number; phase: UploadPhase; progress?: number; message?: string }) => void }
// Keep only a failed batch's completed files; callers retain that batch for retry.
const uploadBatches = new WeakMap<File[], Map<string, Set<File>>>()
export async function uploadFiles(files: File[], target: { orderId: string; afterSaleId?: string }, opts: UploadOptions = {}) {
  if (!files.length) return false
  const key = JSON.stringify([state?.me.id, target])
  const scopes = uploadBatches.get(files) ?? new Map<string, Set<File>>()
  uploadBatches.set(files, scopes)
  const completed = scopes.get(key) ?? new Set<File>()
  scopes.set(key, completed)
  const id = opts.silent ? undefined : toast.loading(`上传 ${files.length} 个文件…`)
  let index = 0
  const report = (phase: UploadPhase, progress?: number, message?: string) => opts.onFile?.({ file: files[index], index, total: files.length, phase, progress, message })
  try {
    for (; index < files.length; index++) {
      if (completed.has(files[index])) { report('uploaded'); continue }
      report('uploading', 0)
      await uploadOne(files[index], target, p => {
        report(p < 1 ? 'uploading' : 'saving', p)
        if (!opts.silent) toast.loading(p < 1 ? `上传 ${files[index].name} · ${Math.round(p * 100)}%（${index + 1}/${files.length}）` : `正在保存 ${files[index].name}`, { id })
      })
      completed.add(files[index]); report('uploaded')
    }
    scopes.delete(key)
    opts.onResult?.({ status: 'success' })
    if (!opts.silent) toast.success(`已上传 ${files.map(f => f.name).join('、')}`, { id })
    await refreshOrders([target.orderId])
    return true
  } catch (e) {
    const result = uploadResult(e)
    report(result.status === 'error' ? 'error' : 'uncertain', undefined, result.message)
    opts.onResult?.(result)
    if (!opts.silent) toast.error(result.message, { id })
    await refreshOrders([target.orderId])
    return false
  }
}

export const addAttachments = (orderId: string, files: File[], opts?: UploadOptions) => uploadFiles(files, { orderId }, opts)
export const addAfterSaleFiles = (orderId: string, afterSaleId: string, files: File[], opts?: UploadOptions) => uploadFiles(files, { orderId, afterSaleId }, opts)

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  location.href = '/login'
}

export const bulkWriters=async(ids:string[],writerId:string,opts?:ActionOptions)=>change<{count:number}>('order.bulkWriters',{ids,writerId},opts)

export const addOrderCost = async (id: string, data: { requestId: string; name: string; contractor: string; contractorId?: string; amount: number; date: string; note: string; proof?: string }) => ok(await change('order.addCost', { id, ...data }))
export const revokeOrderCost = async (id: string, costId: string, reason: string) => ok(await change('order.revokeCost', { id, costId, reason }))
