import { fuzzyMatch } from '@/shared/search'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AppDialogBody, AppDialogContent, AppDialogHeader, useAppDialogDismiss } from '@/components/ui/app-dialog'
import { useSession, recallAfterSale } from './store'
import { useNav } from './nav'
import { inputCls, ChannelName, Person } from './ui'
import { Composer, openAfterSale } from './AfterSale'
import { useAfterSaleTasks, useTaskClock } from './after-sale-data'
import { afterSaleState } from '@/shared/as-rules'
import { businessDate } from '@/shared/format'

export function SalesTaskEntry({ embedded = false, onNavigate, initialOrderId = '', onDirtyChange, onBusyChange }: { embedded?: boolean; onNavigate?: () => void; initialOrderId?: string; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void } = {}) {
  const { views, channel, user, me, role } = useSession()
  const { afterSale } = useNav()
  const {tasks}=useAfterSaleTasks(), now=useTaskClock()
  const [open, setOpen] = useState(embedded)
  const [query, setQuery] = useState(''), [orderId, setOrderId] = useState(initialOrderId),[busy,setBusy]=useState('')
  const [dirty, setDirty] = useState(false), [composingBusy, setComposingBusy] = useState(false)
  const dirtyChanged = useCallback((value: boolean) => { setDirty(value); onDirtyChange?.(value) }, [onDirtyChange])
  const busyChanged = useCallback((value: boolean) => { setComposingBusy(value); onBusyChange?.(value) }, [onBusyChange])
  useEffect(() => { dirtyChanged(false); busyChanged(false) }, [orderId, dirtyChanged, busyChanged])
  const dismiss = useAppDialogDismiss({ dirty, blocked: composingBusy || !!busy, onOpenChange: setOpen })
  const order = views.find(v=>v.id===orderId)
  const options = views.filter(v=>v.status!=='退单'&&fuzzyMatch([v.no, v.title, channel(v.channelId)?.name], query)).sort((a,b)=>Number(!!openAfterSale(a))-Number(!!openAfterSale(b))||Number(!['已发演示','已交付'].includes(a.status))-Number(!['已发演示','已交付'].includes(b.status))||b.orderDate.localeCompare(a.orderDate)).slice(0,30)
  const sent=tasks.filter(a=>a.by===me.id&&businessDate(a.start)===businessDate(new Date())).sort((a,b)=>b.start.localeCompare(a.start))
  const content = <div className="space-y-3">
      {!order?<>
        <input autoFocus aria-label="查找需要修改的订单" placeholder="搜索单号、订单名称或渠道" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&options[0]){e.preventDefault();setOrderId(options[0].id)}}} className={inputCls}/>
        <div className="space-y-1">{options.map(v=><button key={v.id} onClick={()=>setOrderId(v.id)} className="block w-full rounded-lg p-2 text-left text-sm hover:bg-accent focus-visible:bg-accent"><div className="truncate"><b className="font-semibold">{v.no}</b> · {v.title}</div><span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><ChannelName channel={channel(v.channelId)} size={18}/><span>{openAfterSale(v)?'修改中':v.status}</span></span></button>)}{!options.length&&<p className="py-3 text-xs text-muted-foreground">没有匹配订单</p>}</div>
      </>:<>
        <div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate" title={order.title}>{order.title}</span><Button variant="ghost" size="sm" onClick={()=>setOrderId('')}>换一单</Button></div>
        {openAfterSale(order)?<div className="flex items-center gap-2 text-sm">这单已有跟进待处理<Button size="sm" variant="outline" onClick={()=>{onNavigate?.();afterSale(openAfterSale(order)!.id)}}>查看跟进</Button></div>:<Composer key={order.id} v={order} embedded onDirtyChange={dirtyChanged} onBusyChange={busyChanged} onPublishClose={() => { if (embedded) onNavigate?.(); else setOpen(false) }} onDone={()=>{setOrderId('');setQuery('')}}/>}
      </>}
      {!!sent.length&&<section className="border-t pt-3"><h3 className="mb-2 text-xs font-medium">今天已发 {sent.filter(a=>!a.cancelledAt).length} 条</h3><div className="divide-y">{sent.map(a=><div key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-xs"><button onClick={()=>{onNavigate?.();afterSale(a.id)}} className="min-w-0 truncate font-semibold hover:text-primary">{a.title}{a.round>1&&` · 第 ${a.round} 轮`}</button><Person user={user(a.writerId)} size={18}/><span className="ml-auto text-muted-foreground">{afterSaleState(a,now).label}</span>{!a.confirmedAt&&!a.doneAt&&!a.cancelledAt&&(a.by===me.id||role.locked)&&<button className="text-danger" disabled={!!busy} onClick={async()=>{setBusy(a.id);try{await recallAfterSale(a.orderId,a.id)}finally{setBusy('')}}}>{busy===a.id?'撤回中':'撤回'}</button>}</div>)}</div></section>}
    </div>
  if (embedded) return content
  return <>
    <Button size="sm" onClick={() => setOpen(true)}>发起跟进</Button>
    <Dialog open={open} onOpenChange={dismiss.requestOpenChange}>
      <AppDialogContent size="md" data-followup-dialog>
        <AppDialogHeader><DialogTitle className="text-base">整理跟进</DialogTitle><DialogDescription className="sr-only">选择订单，填写要求或附上截图</DialogDescription></AppDialogHeader>
        <AppDialogBody className="px-5 py-4 sm:px-6">{content}</AppDialogBody>
      </AppDialogContent>
    </Dialog>
    {dismiss.confirmation}
  </>
}
