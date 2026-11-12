import { useEffect,useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog,DialogTitle,DialogDescription } from '@/components/ui/dialog'
import { AppDialogContent,AppDialogBody,AppDialogHeader } from '@/components/ui/app-dialog'
import { useCompactLayout } from './useCompactLayout'
import { DataTable,TablePageHeader } from './table-kit'
import { inputCls,Combobox,Money } from './ui'
import { useSession } from './store'
import { useNav } from './nav'
import type { Inquiry } from '@/server/inquiries'
async function request(body?:unknown){const r=await fetch('/api/inquiries',body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);const d=await r.json();if(!r.ok)throw new Error(d.error||'意向单加载失败');return d}
const labels:Record<string,string>={active:'洽谈中',converted:'已转订单',archived:'已归档'}
export function InquiriesPage(){
  const compact=useCompactLayout()
  const {s,role,can,me}=useSession(),{newOrder,openOrder}=useNav(),[rows,setRows]=useState<Inquiry[]>(),[error,setError]=useState(''),[edit,setEdit]=useState<Inquiry|'new'|null>(null)
  const load=()=>request().then(d=>{setRows(d.rows);setError('')}).catch(e=>setError(e.message))
  useEffect(()=>{if(can('order.create'))void load()},[me.id,s.orders.length])
  useEffect(()=>{const converted=(event:Event)=>{const {id,orderId}=(event as CustomEvent<{id:string;orderId:string}>).detail;setRows(old=>old?.map(row=>row.id===id?{...row,status:'converted',orderId}:row))};window.addEventListener('bxsh:inquiry-converted',converted);return()=>window.removeEventListener('bxsh:inquiry-converted',converted)},[me.id])
  if(!can('order.create'))return null
  return <div className="flex h-full min-h-0 flex-col bg-card"><TablePageHeader title="意向单" summary="确认接单前单独记录，不计入销售额与工资"><Button size="sm" onClick={()=>setEdit('new')}><Plus size={14} className="mr-1"/>登记意向</Button></TablePageHeader>
    {error?<div role="alert" className="p-4">{error}<Button variant="ghost" onClick={()=>void load()}>重试</Button></div>:!rows?<div role="status" className="space-y-3 p-4" aria-label="正在加载意向单">{[1,2,3].map(v=><div key={v} className="h-10 animate-pulse rounded bg-muted"/>)}</div>:<DataTable key={compact?'compact':'wide'} id="inquiries" rows={rows} fill rowId={r=>r.id} defaultSorting={[{id:'updated',desc:true}]} preferredFilterFields={['status','channel']} searchPlaceholder="意向名称、渠道、备注" defaultVisibility={{note:false,channel:!compact,quote:!compact,owner:!compact,updated:!compact,status:!compact}} cols={[
      {id:'title',header:'意向名称',size:compact?170:280,sort:r=>r.title,cell:r=><button className="text-left hover:text-primary" onClick={()=>r.orderId?openOrder(r.orderId):setEdit(r)}>{r.title}{compact&&<span className="block text-xs text-muted-foreground">{labels[r.status]}</span>}</button>},
      {id:'status',header:'状态',size:110,sort:r=>labels[r.status],filterOptions:'all',cell:r=>labels[r.status]},
      {id:'channel',header:'渠道',size:150,sort:r=>s.channels.find(c=>c.id===r.channelId)?.name||'',cell:r=>s.channels.find(c=>c.id===r.channelId)?.name||'—'},
      {id:'quote',header:'报价',size:110,filterType:'number',sort:r=>r.quote??0,cell:r=>r.quote===null?'未报价':<Money value={r.quote}/>},
      {id:'owner',header:'归属销售',size:120,sort:r=>s.users.find(u=>u.id===r.ownerId)?.name||'',cell:r=>s.users.find(u=>u.id===r.ownerId)?.name||'—'},
      {id:'updated',header:'更新日期',size:125,filterType:'date',sort:r=>r.updatedAt.slice(0,10),cell:r=>r.updatedAt.slice(0,10)},
      {id:'note',header:'备注',size:260,sort:r=>r.note,cell:r=>r.note||'—'},
      {id:'action',header:'操作',size:compact?140:180,cell:r=><div className="flex gap-1">{r.status==='active'&&(role.locked||r.ownerId===me.id)&&<Button size="sm" variant="ghost" onClick={()=>newOrder({inquiryId:r.id,title:r.title,channelId:r.channelId??undefined,ownerId:r.ownerId,basePrice:r.quote===null?undefined:String(r.quote),note:r.note})}>转录单</Button>}{r.status!=='converted'&&<Button size="sm" variant="ghost" onClick={async()=>{try{await request({action:'archive',id:r.id,status:r.status==='archived'?'active':'archived'});await load()}catch(e){toast.error((e as Error).message)}}}>{r.status==='archived'?'恢复':'归档'}</Button>}{r.orderId&&<Button size="sm" variant="ghost" onClick={()=>openOrder(r.orderId!)}>查看订单</Button>}</div>},
    ]}/>}
    {edit&&<InquiryForm row={edit==='new'?null:edit} close={()=>setEdit(null)} saved={()=>{setEdit(null);void load()}}/>}
  </div>
}
function InquiryForm({row,close,saved}:{row:Inquiry|null;close:()=>void;saved:()=>void}){
  const {s}=useSession(),[id]=useState(row?.id??crypto.randomUUID()),[title,setTitle]=useState(row?.title??''),[channelId,setChannel]=useState(row?.channelId??''),[quote,setQuote]=useState(row?.quote===null||!row?'':String(row.quote)),[note,setNote]=useState(row?.note??''),[busy,setBusy]=useState(false)
  return <Dialog open onOpenChange={v=>{if(!v&&!busy)close()}}><AppDialogContent size="sm"><AppDialogHeader><DialogTitle>意向单</DialogTitle><DialogDescription>确定接单后点“转录单”，保存正式订单后才计入业绩。</DialogDescription></AppDialogHeader><AppDialogBody className="p-5"><form className="grid gap-3" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await request({action:'save',id,title,channelId:channelId||null,quote:quote===''?null:Number(quote),note});saved();toast.success('意向单已保存')}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}}>
    <label className="grid gap-1 text-sm">名称<input aria-label="意向名称" autoFocus required maxLength={200} className={inputCls} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label className="grid gap-1 text-sm">渠道<Combobox value={channelId} onChange={setChannel} options={[{value:'',label:'暂未确定'},...s.channels.map(c=>({value:c.id,label:c.name}))]}/></label>
    <label className="grid gap-1 text-sm">报价（可空）<input aria-label="意向报价" className={inputCls} type="number" step="0.01" min="0" value={quote} onChange={e=>setQuote(e.target.value)}/></label>
    <label className="grid gap-1 text-sm">备注<textarea className={inputCls} maxLength={5000} value={note} onChange={e=>setNote(e.target.value)}/></label><Button disabled={busy}>{busy?'保存中…':'保存'}</Button>
  </form></AppDialogBody></AppDialogContent></Dialog>
}
