import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { OrderView } from '@/shared/types'
import { confirmationState } from '@/shared/as-rules'
import { confirmAfterSale, confirmAfterSaleHours, useSession } from './store'
import { DateTimePicker } from './DatePicker'
export const taskTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})
export function ConfirmationPanel({orderId,a,now}:{orderId:string;a:OrderView['afterSales'][number];now:number}) {
  const {me}=useSession(),state=confirmationState(a,now),lock=useRef(false)
  const [busy,setBusy]=useState(false),[specific,setSpecific]=useState(false),[when,setWhen]=useState(()=>new Date(Date.now()+(10+8)*3600_000).toISOString().slice(0,16))
  if(!a.confirmBy||a.cancelledAt||a.doneAt)return null
  const submit=async(hours?:number)=>{
    if(lock.current)return
    lock.current=true;setBusy(true)
    try{const ok=state==='default'?await confirmAfterSale(orderId,a.id,a.due):hours?await confirmAfterSaleHours(orderId,a.id,hours):await confirmAfterSale(orderId,a.id,new Date(when+':00+08:00').toISOString());if(ok)toast.success('交付时间已确认')}finally{lock.current=false;setBusy(false)}
  }
  return <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs"><p className="font-medium">{a.confirmedAt?'已确认交付时间':state==='default'?'已按 24 小时计算':'几小时能改完？'}</p><p className="text-muted-foreground">{taskTime(a.due)} 前交付</p>
    {!a.confirmedAt&&a.writerId===me.id&&<>{state==='default'?<Button size="sm" disabled={busy} onClick={()=>void submit()}>知晓默认交付时间</Button>:<><div className="flex flex-wrap gap-2">{[2,4,8,12,24].map(h=><Button size="sm" variant="outline" key={h} disabled={busy} onClick={()=>void submit(h)}>{h} 小时</Button>)}<Button size="sm" variant="ghost" onClick={()=>setSpecific(!specific)}>指定时间</Button></div>{specific&&<div className="space-y-2"><DateTimePicker value={when} onChange={setWhen}/><Button size="sm" disabled={busy} onClick={()=>void submit()}>确认时间</Button></div>}</>}</>}
  </div>
}
