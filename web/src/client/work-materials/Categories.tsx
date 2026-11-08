import { useState } from 'react'
import { toast } from 'sonner'
import type { MaterialKind } from '@/shared/work-materials'
import { request } from './data'
import { button, field, primary, Frame } from './Forms'

type Change = {action:'add'|'remove';name:string} | {action:'rename';name:string;next:string}
export function Categories({kind, names, close, saved}: {kind:MaterialKind; names:string[]; close:()=>void; saved:(change:Change)=>void}) {
  const [name,setName] = useState(''), [editing,setEditing] = useState(''), [removing,setRemoving] = useState(''), [busy,setBusy] = useState(false)
  async function submit(change: Change) {
    setBusy(true)
    try {
      await request('/api/materials/categories?kind='+kind,'POST',change)
      setName(''); setEditing(''); setRemoving(''); saved(change)
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  return <Frame title="管理分类" close={() => !busy && close()}>
    <form className="mb-3 flex gap-2" onSubmit={e => {e.preventDefault(); void submit(editing ? {action:'rename',name:editing,next:name.trim()} : {action:'add',name:name.trim()})}}>
      <input className={field} aria-label="分类名称" placeholder="分类名称" maxLength={40} value={name} onChange={e => setName(e.target.value)} required/>
      <button className={primary+' shrink-0'} disabled={busy || !name.trim()}>{editing ? '保存' : '添加'}</button>
    </form>
    <div className="grid gap-1">{names.map(t => <div key={t} className="flex flex-wrap items-center gap-2 border-b py-2 text-sm">
      <span className="mr-auto">{t}</span>
      <button className={button} disabled={busy} onClick={()=>{setRemoving('');setEditing(t);setName(t)}}>改名</button>
      <button className={button} disabled={busy} onClick={()=>{if (removing===t) void submit({action:'remove',name:t}); else setRemoving(t)}}>{removing===t?'确认移除':'移除'}</button>
      {removing===t && <small className="w-full text-muted-foreground">该分类下的素材将移到「未分类」。</small>}
    </div>)}</div>
  </Frame>
}
