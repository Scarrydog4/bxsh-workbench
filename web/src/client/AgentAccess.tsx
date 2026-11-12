import { useEffect,useState } from 'react'
import { Copy,Check } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { inputCls } from './ui'
type Token={id:string;name:string;scopes:string[];expiresAt:string;revokedAt:string|null}
export function AgentAccess(){
 const [rows,setRows]=useState<Token[]>([]),[name,setName]=useState('我的 Agent'),[income,setIncome]=useState(false),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[error,setError]=useState('')
 async function load(){try{const r=await fetch('/api/agent/tokens'),d=await r.json();if(!r.ok)throw Error(d.error);setRows(d.rows);setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{void load()},[])
 async function act(body:unknown){setBusy(true);try{const r=await fetch('/api/agent/tokens',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error);if(d.token){setSecret(d.token);setCopied(false)}await load()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}
 return <div className="space-y-3 text-sm"><p className="text-muted-foreground">连接 Codex、Claude Desktop 等支持 MCP 的客户端。仅能查询你有权限的记录。</p>
 <form className="flex flex-wrap items-center gap-2" onSubmit={e=>{e.preventDefault();void act({action:'create',name,scopes:income?['orders','income']:['orders'],days:30})}}><input aria-label="Agent 连接名称" className={inputCls+' w-44'} required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={income} onChange={e=>setIncome(e.target.checked)}/>允许收入查询</label><Button size="sm" disabled={busy}>创建只读令牌</Button></form>
 {secret&&<div className="rounded-md border p-3"><p className="mb-2 text-xs text-muted-foreground">令牌只显示本次，有效期 30 天。请保存到客户端的私密环境变量中。</p><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs">{secret}</code><Button size="icon" variant="ghost" aria-label="复制 Agent 令牌" onClick={async()=>{try{await navigator.clipboard.writeText(secret);setCopied(true)}catch{toast.error('请手动复制令牌')}}}>{copied?<Check size={17}/>:<Copy size={17}/>}</Button></div></div>}
 {error&&<p role="alert">{error}</p>}
 <ul className="divide-y">{rows.map(t=><li key={t.id} className="flex items-center gap-2 py-2"><span className="min-w-0 flex-1 truncate">{t.name}<span className="ml-2 text-xs text-muted-foreground">{t.revokedAt?'已撤销':new Date(t.expiresAt)<new Date()?'已过期':`到期 ${t.expiresAt.slice(0,10)}`}</span></span>{!t.revokedAt&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void act({action:'revoke',id:t.id})}>撤销</Button>}</li>)}</ul>
 <a className="text-primary underline underline-offset-4" href="https://github.com/Scarrydog4/bxsh-workbench/tree/main/integrations/workbench-agent" target="_blank" rel="noreferrer">MCP 连接说明</a>
 </div>
}
