import { useEffect, useState } from 'react'
import { Plus, DownloadSimple, PencilSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AppDialogContent, AppDialogHeader, AppDialogBody } from '@/components/ui/app-dialog'
import { useCompactLayout } from './useCompactLayout'
import { IncomeDateFilter, incomePreset } from './IncomeDateFilter'
import { DataTable, TablePageHeader } from './table-kit'
import { ImageDrop, inputCls, Money } from './ui'
import { useNav } from './nav'
import { useSession } from './store'
import { businessDate } from '@/shared/format'
import type { ContractorReport } from '@/server/contractors'
type Partner = ContractorReport['rows'][number]
async function request(body?: unknown): Promise<ContractorReport> {
  const r=await fetch('/api/contractors',body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined)
  const data=await r.json();if(!r.ok) throw new Error(data.error||'外包往来暂时无法加载')
  return data
}
const face=(p:Pick<Partner,'name'|'avatar'>)=><span className="inline-flex min-w-0 items-center gap-2">{p.avatar?<img src={p.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover"/>:<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">{p.name.slice(0,1)}</span>}<span className="truncate">{p.name}</span></span>
export function ContractorsPage(){
  const compact=useCompactLayout()
  const {role,s}=useSession(),[data,setData]=useState<ContractorReport>(),[error,setError]=useState(''),[editing,setEditing]=useState<Partner| 'new' | null>(null),[selected,setSelected]=useState<string|null>(null)
  const load=()=>request().then(v=>{setData(v);setError('')}).catch(e=>setError(e.message))
  useEffect(()=>{if(role.locked)void load()},[role.locked,s.version])
  if(!role.locked)return null
  return <div className="flex h-full min-h-0 flex-col bg-card">
    <TablePageHeader title="外包合作方" summary={data?`${data.rows.length} 家`:''}><Button size="sm" onClick={()=>setEditing('new')}><Plus size={14} className="mr-1"/>新建合作方</Button></TablePageHeader>
    {error?<div role="alert" className="p-5 text-sm">{error}<Button variant="ghost" onClick={()=>void load()}>重试</Button></div>:!data?<div className="space-y-3 p-5" role="status" aria-label="正在加载外包合作方">{[1,2,3,4].map(v=><div key={v} className="h-10 animate-pulse rounded bg-muted"/>)}</div>:<>
      {data.unfiled.length>0&&<div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground"><span>历史外包方尚未建档：</span>{data.unfiled.map(name=><button key={name} className="rounded border px-2 py-1 hover:text-primary" onClick={()=>{setEditing({...emptyPartner(),name});}}>{name} ＋</button>)}</div>}
      <DataTable key={compact?'compact':'wide'} id="contractors" fill rows={data.rows} rowId={p=>p.id} searchPlaceholder="合作方、曾用名、备注" preferredFilterFields={['active','remaining']} defaultVisibility={{note:false,aliases:false,advance:false,cost:!compact,paid:!compact,active:!compact}} onRowClick={p=>setSelected(p.id)} cols={[
        {id:'name',header:'合作方',size:compact?160:220,filterType:'text',sort:p=>p.name,cell:face},
        {id:'remaining',header:'待付',size:compact?90:110,filterType:'number',sort:p=>p.remaining,cell:p=><Money value={p.remaining}/>},
        {id:'cost',header:'成本合计',size:120,filterType:'number',sort:p=>p.cost,cell:p=><Money value={p.cost}/>},
        {id:'paid',header:'已付',size:110,filterType:'number',sort:p=>p.paid,cell:p=><Money value={p.paid}/>},
        {id:'advance',header:'预付余额',size:120,filterType:'number',sort:p=>p.advance,cell:p=><Money value={p.advance}/>},
        {id:'active',header:'状态',size:100,filterType:'text',sort:p=>p.active?'合作中':'已停用',cell:p=><span className="text-xs text-muted-foreground">{p.active?'合作中':'已停用'}</span>},
        {id:'aliases',header:'曾用名',size:180,filterType:'text',sort:p=>p.aliases.join(' '),cell:p=>p.aliases.join('、')||'—'},
        {id:'note',header:'备注',size:220,filterType:'text',sort:p=>p.note,cell:p=>p.note||'—'},
        {id:'edit',header:'操作',size:70,sort:()=>'',cell:p=><Button size="icon" variant="ghost" aria-label={`编辑${p.name}`} onClick={e=>{e.stopPropagation();setEditing(p)}}><PencilSimple size={16}/></Button>},
      ]}/>
    </>}
    {editing&&<PartnerEditor partner={editing==='new'?emptyPartner():editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);void load()}}/>}
    {data&&selected&&<PartnerLedger partner={data.rows.find(p=>p.id===selected)!} onClose={()=>setSelected(null)} reload={load}/>}
  </div>
}
const emptyPartner=():Partner=>({id:crypto.randomUUID(),name:'',note:'',avatar:null,active:true,aliases:[],updatedAt:'',cost:0,paid:0,remaining:0,advance:0,lines:[],payments:[]})
function PartnerEditor({partner:p,onClose,onSaved}:{partner:Partner;onClose:()=>void;onSaved:()=>void}){
  const [name,setName]=useState(p.name),[note,setNote]=useState(p.note),[avatar,setAvatar]=useState<string>(),[active,setActive]=useState(p.active),[busy,setBusy]=useState(false)
  return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose()}}><AppDialogContent size="sm"><AppDialogHeader><DialogTitle>合作方资料</DialogTitle><DialogDescription className="sr-only">管理外包合作方名称、头像和备注</DialogDescription></AppDialogHeader><AppDialogBody className="p-5"><form className="grid gap-4" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);try{await request({action:'save',id:p.id,name,note,active,avatar});toast.success('合作方已保存');onSaved()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}}>
    <ImageDrop compact preview={avatar||p.avatar||undefined} onImage={setAvatar} showCamera/>
    <label className="grid gap-1 text-sm">名称<input autoFocus required maxLength={100} aria-label="合作方名称" className={inputCls} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="grid gap-1 text-sm">备注<textarea maxLength={1000} className={inputCls} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>合作中</label>
    <Button disabled={busy||!name.trim()}>{busy?'保存中…':'保存'}</Button>
  </form></AppDialogBody></AppDialogContent></Dialog>
}
function PartnerLedger({partner:p,onClose,reload}:{partner:Partner;onClose:()=>void;reload:()=>Promise<unknown>}){
  const compact=useCompactLayout()
  const {openOrder}=useNav(),[dates,setDates]=useState(()=>incomePreset('month')),[allDates,setAllDates]=useState(true),[pay,setPay]=useState(false),[amount,setAmount]=useState(''),[date,setDate]=useState(businessDate(new Date())),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[requestId,setRequestId]=useState(()=>crypto.randomUUID())
  const [revoking,setRevoking]=useState<string|null>(null),[reason,setReason]=useState('')
  const from=allDates?'':dates.from,to=allDates?'':dates.to
  const entries=[...p.lines.map(l=>({id:l.id,date:l.date,kind:'订单成本',title:l.title,orderId:l.orderId,note:l.name+(l.note?' · '+l.note:''),cost:l.amount,paid:0,revoked:false})),...p.payments.map(l=>({id:l.id,date:l.date,kind:l.revokedAt?'已撤销付款':'已付款',title:'',orderId:'',note:l.note+(l.revokeReason?' · '+l.revokeReason:''),cost:0,paid:l.amount,revoked:!!l.revokedAt}))].filter(l=>(!from||l.date>=from)&&(!to||l.date<=to)).sort((a,b)=>b.date.localeCompare(a.date))
  return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose()}}><AppDialogContent size="lg"><AppDialogHeader><DialogTitle>{face(p)}</DialogTitle><DialogDescription>成本只扣一次；这里的付款仅记录已经付给合作方的钱。</DialogDescription></AppDialogHeader><AppDialogBody className="flex flex-col">
    <div className="grid grid-cols-3 gap-2 border-b px-4 py-3 text-sm">{[['累计成本',p.cost],['累计已付',p.paid],['累计待付',p.remaining]].map(([label,v])=><div key={String(label)}><div className="text-xs text-muted-foreground">{label}</div><Money value={Number(v)}/></div>)}</div>
    <div className="flex flex-wrap items-center gap-2 border-b p-3"><IncomeDateFilter compact label="日期" value={dates} all={allDates} onChange={value=>{setDates(value);setAllDates(false)}}/><Button size="sm" variant="ghost" onClick={()=>setAllDates(true)}>全部日期</Button>{p.active&&<Button size="sm" onClick={()=>setPay(!pay)}>记付款</Button>}</div>
    {pay&&<form className="grid gap-2 border-b bg-muted/20 p-3 sm:grid-cols-3" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);try{await request({action:'pay',id:requestId,contractorId:p.id,amount:Number(amount),date,note});await reload();setPay(false);setAmount('');setNote('');setRequestId(crypto.randomUUID());toast.success('付款已记录')}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}}><label className="text-xs">已付金额<input aria-label="外包付款金额" className={inputCls} type="number" min="0.01" step="0.01" value={amount} required onChange={e=>setAmount(e.target.value)}/></label><label className="text-xs">付款日期<input aria-label="外包付款日期" className={inputCls} type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><label className="text-xs">付款依据<input aria-label="外包付款依据" className={inputCls} required maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label><Button disabled={busy}>{busy?'保存中…':'确认记录'}</Button></form>}
    {revoking&&<form className="flex gap-2 border-b p-3" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await request({action:'revoke',id:revoking,reason});await reload();setRevoking(null);setReason('');toast.success('付款已撤销')}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}}><input autoFocus className={inputCls} value={reason} required maxLength={500} placeholder="撤销原因" onChange={e=>setReason(e.target.value)}/><Button disabled={busy}>确认撤销</Button><Button type="button" variant="ghost" onClick={()=>setRevoking(null)}>取消</Button></form>}
    <DataTable key={compact?'compact':'wide'} id="contractor-ledger" rows={entries} rowId={r=>r.id} toolbarActions={table=><Button size="sm" variant="outline" disabled={busy} onClick={async()=>{setBusy(true);try{const response=await fetch('/api/contractors/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:p.id,ids:table.getRowModel().rows.map(r=>r.original.id)})});if(!response.ok)throw Error('导出失败，请重试');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=p.name+'-外包往来.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast.success('明细已导出')}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}}><DownloadSimple size={15} className="mr-1"/>导出</Button>} defaultVisibility={{note:false,date:!compact,kind:!compact,action:!compact}} cols={[
      {id:'date',header:'日期',size:115,sort:r=>r.date,cell:r=>r.date},
      {id:'title',header:'订单名称',size:compact?145:240,sort:r=>r.title,cell:r=>r.orderId?<button className="text-left hover:text-primary" onClick={()=>{onClose();openOrder(r.orderId)}}>{r.title}</button>:r.kind},
      {id:'kind',header:'类别',size:110,sort:r=>r.kind,cell:r=>r.kind},
      {id:'cost',header:'成本',size:compact?80:100,filterType:'number',sort:r=>r.cost,cell:r=><Money value={r.cost}/>},
      {id:'paid',header:'已付',size:compact?80:100,filterType:'number',sort:r=>r.paid,cell:r=><span className={r.revoked?'line-through opacity-50':''}><Money value={r.paid}/></span>},
      {id:'note',header:'说明',size:240,sort:r=>r.note,cell:r=>r.note},
      {id:'action',header:'操作',size:80,sort:()=>'',cell:r=>r.kind==='已付款'?<Button size="sm" variant="ghost" onClick={()=>setRevoking(r.id)}>撤销</Button>:null},
    ]}/>
  </AppDialogBody></AppDialogContent></Dialog>
}
