import { useState } from 'react'
import type { PublicUser } from '@/server/bootstrap'
import { Person, Combobox } from './ui'
import { cn } from '@/lib/utils'
import { SalesModeBadge, salesModeLabel } from './SalesModeBadge'
export function PersonChoice({people,value,onChange,label='选择人员',showSalesMode=false}:{people:PublicUser[];value:string;onChange:(id:string)=>void;label?:string;showSalesMode?:boolean}) {
  const [more,setMore]=useState(false)
  const first=people.slice(0,6)
  const selected=people.find(p=>p.id===value)
  const shown=selected&&!first.includes(selected)?[...first.slice(0,5),selected]:first
  return <div className="flex flex-wrap gap-2" role="group" aria-label={label}>{shown.map(p=><button key={p.id} type="button" aria-pressed={p.id===value} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm transition-colors',value===p.id?'border-primary bg-primary/10':'border-transparent bg-muted/40 hover:bg-accent')} onClick={()=>onChange(p.id)}><Person user={p} size={20}/>{showSalesMode && p.isSales && !p.isAdmin && <SalesModeBadge mode={p.salesMode}/>}</button>)}{people.length>6&&<><button type="button" className="rounded-lg px-2 text-xs text-primary" onClick={()=>setMore(!more)}>更多</button>{more&&<Combobox value={value} onChange={id=>{onChange(id);setMore(false)}} options={people.map(p=>({value:p.id,label:p.name,hint:showSalesMode && p.isSales && !p.isAdmin ? salesModeLabel(p.salesMode) : undefined,icon:<Person user={p} size={20}/>}))}/>}</>}</div>
}
