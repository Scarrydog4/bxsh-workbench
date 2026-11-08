import { OrderBadges } from './OrderUrgency'
import { DeliverButton } from './DeliverButton'
import { CopyOrderName } from './CopyOrderName'
import { confirmationState } from '@/shared/as-rules'
import { finishLater, usePendingFinish } from './undoable'
import {useState} from 'react'
import {CheckCircle,BellRinging} from '@phosphor-icons/react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import {ChannelName,Person} from './ui'
import {useSession,finishAfterSale,nudgeAfterSale,addAfterSaleFiles} from './store'
import {ConfirmationPanel} from './TaskReply'
import {afterSaleState} from '@/shared/as-rules'
import type {AfterSaleTask} from '@/shared/aftersale-task'
/** 离确认或交付截止不到 12 小时：倒计时变橙并轻轻闪，提醒抓紧处理。 */
export function isUrgent(a:{due:string;doneAt:string|null;cancelledAt?:string|null;confirmBy?:string|null;confirmedAt?:string|null;lateConfirm?:boolean;start:string},now:number){if(a.doneAt||a.cancelledAt)return false;const waiting=confirmationState(a,now)==='waiting';const left=new Date(waiting?a.confirmBy!:a.due).getTime()-now;return left>0&&left<=12*3600_000}
export function TaskCountdown({a,now,short}:{a:AfterSaleTask;now:number;short?:boolean}) {const state=afterSaleState(a,now),urgent=isUrgent(a,now);if(short)state.label=state.label.replace(/^(已确认|默认交付) · /,'');return <span className={cn('inline-flex items-center gap-1 text-xs tabular-nums',state.tone==='late'?'font-medium text-danger':state.tone==='soon'||urgent?'text-warn':'text-muted-foreground',urgent&&'urgent-pulse font-medium')}>{(urgent||state.tone==='late')&&<span className="h-1.5 w-1.5 rounded-full bg-current"/>}{state.label}</span>}
export function TaskAction({a}:{a:AfterSaleTask}) {const{me,role,can}=useSession(),[busy,setBusy]=useState(false),waiting=usePendingFinish(a.id);if(a.doneAt||a.cancelledAt)return null;const finish=role.locked||a.writerId===me.id;if(finish&&waiting)return <span className="inline-flex h-7 items-center gap-1 px-2 text-xs text-ok"><CheckCircle size={14} weight="fill"/>已交付</span>;if(finish)return <DeliverButton kind="aftersale" orderId={a.orderId} asId={a.id} no={a.no} label="交付本次跟进"/>;return <Button size="sm" variant="ghost" className="h-7 gap-1" disabled={busy||!finish&&!can('aftersale.create')} onClick={async e=>{e.stopPropagation();if(busy)return;if(finish){finishLater(a.orderId,a.id,'跟进已交付');return}setBusy(true);try{if(await nudgeAfterSale(a.orderId,a.id))toast.success('已提醒写手')}finally{setBusy(false)}}}>{finish?<CheckCircle size={14}/>:<BellRinging size={14}/>} {finish?'交付本次跟进':'催一下'}</Button>}
export function TaskCard({a,now,onOpen}:{a:AfterSaleTask;now:number;onOpen:()=>void}) {const{user,channel,me,role,order}=useSession(),[uploaded,setUploaded]=useState(false),[uploading,setUploading]=useState(false);return <article className="space-y-2 rounded-xl border bg-card p-3" onDragOver={e=>{if(a.writerId===me.id||role.locked)e.preventDefault()}} onDrop={async e=>{e.preventDefault();if(!(a.writerId===me.id||role.locked)||!e.dataTransfer.files.length||uploading)return;setUploading(true);try{if(await addAfterSaleFiles(a.orderId,a.id,Array.from(e.dataTransfer.files)))setUploaded(true)}finally{setUploading(false)}}}>
 <div className="mb-1 flex items-center justify-between gap-2"><strong className="text-xs">第 {a.round} 轮</strong><TaskCountdown a={a} now={now}/></div>
 <div className="flex min-w-0 items-start gap-1"><OrderBadges v={order(a.orderId) ?? {}}/><button type="button" className="flex min-w-0 flex-1 items-start gap-1.5 text-left text-sm font-medium hover:text-primary" onClick={onOpen}><span className="min-w-0 [overflow-wrap:anywhere]">{a.title}</span></button><CopyOrderName title={a.title}/></div>
 <button type="button" className="block w-full text-left" onClick={onOpen}><p className="line-clamp-2 text-xs text-muted-foreground">{a.req.join('；')||'见截图'}</p></button><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><ChannelName channel={channel(a.channelId)} size={18}/><Person user={user(a.writerId)} size={18}/><TaskAction a={a}/></div><ConfirmationPanel orderId={a.orderId} a={a} now={now}/>{uploading&&<p className="text-xs">上传中…</p>}{uploaded&&!a.doneAt&&<div className="flex items-center gap-2 text-xs">修改稿已上传。交付时还要附一张截图：<DeliverButton kind="aftersale" orderId={a.orderId} asId={a.id} no={a.no} label="去交付" variant="default"/><Button variant="ghost" size="sm" onClick={()=>setUploaded(false)}>稍后</Button></div>}</article>}
