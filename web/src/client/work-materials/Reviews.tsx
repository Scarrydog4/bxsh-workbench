import { businessDateTime } from '@/shared/format'
import { WorkspaceHeading, pageAction } from '../WorkspaceHeading'
import { useNav } from '../nav'
import { SelectField } from '../SelectField'
import { useMemo, useState } from 'react'
import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { reviewStatus, type QualityReview } from '@/shared/work-materials'
import { fuzzyMatch } from '@/shared/search'
import { SettlementNote } from '../SettlementNote'
import { useSession } from '../store'
import { Person } from '../ui'
import { ImageViewer, Thumbs } from '../ImageViewer'
import { PageLoading } from '../PageLoading'
import { Frame, button, field, primary } from './Forms'
import { request, useWorkData } from './data'

const pickerLimit = 50

function CreateReview({ close, saved }: { close: () => void; saved: (id: string) => void }) {
  const { s, channel, user } = useSession()
  const [id] = useState(() => crypto.randomUUID())
  const [query, search] = useState(''), [orderId, chooseOrder] = useState(''), [writerId, chooseWriter] = useState('')
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [issue, setIssue] = useState(''), [shots, setShots] = useState<string[]>([])
  const writable = useMemo(() => new Set(s.users.filter(u => u.active && u.canWrite).map(u => u.id)), [s.users])
  const options = s.orders.filter(o => o.assignees.some(a => writable.has(a.userId)) && fuzzyMatch([o.no, o.title, channel(o.channelId)?.name], query))
  const order = s.orders.find(o => o.id === orderId)
  const writers = order ? order.assignees.map(a => a.userId).filter(userId => writable.has(userId)) : []
  const assigned = writers.includes(writerId) ? writerId : writers[0]
  function pick(next: string) { chooseOrder(next); chooseWriter(''); search('') }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!order || !assigned) { toast.error('请先选择订单'); return }
    if (!issue.trim() && !shots.length) { toast.error('请填写复盘内容或添加截图'); return }
    setBusy(true)
    try {
      await request('/api/reviews', 'POST', { id, issue, orderId: order.id, writerId: assigned, title: order.title, images: shots })
      saved(id); close()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return <Frame title="发起复盘" close={() => !busy && close()}><form className="grid gap-3" onSubmit={submit}>
    {order ? <div className="grid gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-semibold" title={order.title}>{order.title}</span>
        <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => pick('')}>换一单</button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">写手{writers.length > 1
          ? <span role="group" aria-label="负责写手" className="flex flex-wrap gap-1">{writers.map(userId => <button key={userId} type="button" aria-pressed={userId === assigned} onClick={() => chooseWriter(userId)}
              className={'rounded-md border px-1.5 py-0.5 text-foreground '+(userId === assigned ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent')}><Person user={user(userId)}/></button>)}</span>
          : <span className="text-foreground"><Person user={user(assigned!)}/></span>}</span>
      </div>
    </div> : <div className="grid gap-1.5">
      <label>关联订单<input autoFocus className={field} placeholder="搜索订单名称或渠道" value={query} onChange={e => search(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (options[0]) pick(options[0].id) } }}/></label>
      <div className="max-h-56 overflow-auto rounded-md border">
        {options.slice(0, pickerLimit).map(o => <button key={o.id} type="button" onClick={() => pick(o.id)} className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" title={o.title}>
          <b className="font-semibold">{o.title}</b><span className="ml-2 text-muted-foreground">{o.assignees.map(a => user(a.userId)?.name).filter(Boolean).join('、')}</span></button>)}
        {!options.length && <p className="p-3 text-center text-sm text-muted-foreground">没有匹配的订单</p>}
        {options.length > pickerLimit && <p className="p-2 text-center text-xs text-muted-foreground">还有 {options.length - pickerLimit} 单，继续输入可缩小范围</p>}
      </div>
    </div>}
    <SettlementNote note={issue} shots={shots} onNote={setIssue} onShots={setShots} onReading={setReading} disabled={busy} label="复盘内容" placeholder="写几句说明，或直接粘贴截图（最多 5 张）" maxImages={5} maxLength={8000}/>
    <button className={primary+' justify-self-end'} disabled={busy || reading || (!issue.trim() && !shots.length)}>{busy ? '正在发起…' : '发起'}</button>
  </form></Frame>
}

function Status({ r }: { r: QualityReview }) {
  const colors = { pending: 'bg-warn/10 text-foreground', waiting: 'bg-info/10 text-foreground', done: 'bg-muted text-muted-foreground' }
  return <span className={'inline-block rounded px-2 py-0.5 text-xs '+colors[r.status]}>{reviewStatus[r.status]}</span>
}
function Detail({ r, reload }: { r: QualityReview; reload: () => void }) {
  const { me, role, views, can, user } = useSession()
  const { openOrder } = useNav()
  const hasOrder = can('order.view') && views.some(view => view.id === r.orderId)
  const [reply, setReply] = useState(''), [busy, setBusy] = useState(false), [zoom, setZoom] = useState<number | null>(null)
  const [asking,setAsking] = useState(false), [note,setNote] = useState('')
  const [shots,setShots] = useState<string[]>([]), [reading,setReading] = useState(false)
  const pictures = (r.images ?? (r.image ? [r.image] : [])).map((src, index) => ({src, name:'复盘截图'+(index+1)+'.webp'}))
  async function change(action: 'confirm' | 'reply' | 'supplement') {
    setBusy(true)
    try {
      await request('/api/reviews/' + r.id, 'POST', {action,reply,note,images:action==='confirm' ? undefined : shots,version:r.history.length})
      setReply(''); setNote(''); setShots([]); setAsking(false); reload(); window.dispatchEvent(new Event('bxsh:review-updated'))
    } catch (e) { toast.error((e as Error).message); reload() } finally { setBusy(false) }
  }
  return <article className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0"><Status r={r}/>
        <h2 className="my-2 break-words text-xl font-semibold">{hasOrder ? <a className="hover:underline" href={'/?o='+encodeURIComponent(r.orderNo)}
          onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); openOrder(r.orderId) } }}>{r.orderTitle}</a> : r.orderTitle}</h2></div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">写手<span className="text-foreground"><Person user={user(r.writerId) ?? {id:r.writerId,name:r.writerName,hue:150}}/></span></span>
      </div>
    </div>
    {r.issue && <p className="whitespace-pre-wrap break-words">{r.issue}</p>}
    {!!pictures.length && <div className="flex flex-wrap gap-2">{pictures.map((pic,index) => <button key={pic.src+index} className="block cursor-zoom-in overflow-hidden rounded-lg border" aria-label={'放大复盘截图 '+(index+1)} onClick={() => setZoom(index)}><img className="max-h-60 max-w-full object-contain" alt={'复盘截图 '+(index+1)} src={pic.src}/></button>)}</div>}
    {r.history.length>0 && <div><h3 className="mb-2 text-sm font-semibold">回复记录</h3>
      <ol className="grid gap-2">{r.history.map((msg,i)=><li key={i} className={'rounded-md border-l-2 p-3 '+(msg.type==='supplement'?'border-amber-500 bg-amber-500/10':'border-primary bg-muted')}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><b>{msg.type==='supplement'?'请补充':'写手回复'}</b><span>{msg.actorName}</span><time dateTime={msg.at}>{businessDateTime(msg.at)}</time></div>
        {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
        {!!msg.images?.length && <Thumbs className="mt-2" imgClass="h-16 w-16" pics={msg.images.map((hash,n) => { const src = '/api/reviews/'+r.id+'/image?v='+hash; return {src,thumb:src,name:'复盘回复'+(n+1)+'.webp'} })}/>}
      </li>)}</ol>
    </div>}
    {r.writerId === me.id && r.status === 'pending' && <form className="grid gap-2" onSubmit={e => {e.preventDefault(); void change('reply')}}>
      <SettlementNote note={reply} shots={shots} onNote={setReply} onShots={setShots} onReading={setReading} disabled={busy} label="回复复盘" placeholder={r.history.length ? '补充回复，可直接粘贴截图' : '写回复，可直接粘贴截图'} maxImages={5} maxLength={8000}/>
      <button className={primary+' justify-self-end'} disabled={busy || reading || (!reply.trim() && !shots.length)}>回复</button>
    </form>}
    {role.locked && r.status==='waiting' && (asking ? <form className="grid gap-2" onSubmit={e=>{e.preventDefault();void change('supplement')}}>
      <SettlementNote note={note} shots={shots} onNote={setNote} onShots={setShots} onReading={setReading} disabled={busy} label="补充要求" placeholder="请写明还要写手说明什么，可直接粘贴截图" maxImages={5} maxLength={8000}/>
      <div className="flex justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={()=>setAsking(false)}>取消</button><button className={primary} disabled={busy || reading || (!note.trim() && !shots.length)}>发送</button></div>
    </form> : <div className="flex justify-end gap-2"><button className={button} disabled={busy} onClick={()=>setAsking(true)}>请补充</button><button className={primary} disabled={busy} onClick={()=>void change('confirm')}>确认完成</button></div>)}
    <ImageViewer pics={pictures} index={zoom} onIndex={setZoom}/>
  </article>
}
function updatedAt(r: QualityReview) {
  return Math.max(...[r.createdAt, r.repliedAt, r.confirmedAt, ...r.history.map(msg => msg.at)].filter((v): v is string => !!v).map(Date.parse))
}
export function Reviews() {
  const { me, role, s } = useSession()
  const { data, error, reload } = useWorkData<QualityReview[]>('/api/reviews', me.id, s.version)
  const [selected, select] = useState(''), [creating, create] = useState(false)
  const priority = role.locked ? ['waiting','pending','done'] : ['pending','waiting','done']
  const [search, setSearch] = useState(''), [status, setStatus] = useState('')
  const needle = search.trim().toLowerCase()
  const rows = (data ?? []).filter(r => (!status || status === r.status) &&
    fuzzyMatch([r.orderNo,r.orderTitle,r.writerName,r.ownerName,r.issue], search))
    .sort((a,b) => priority.indexOf(a.status) - priority.indexOf(b.status) || updatedAt(b) - updatedAt(a))
  const selection = rows.find(r => r.id === selected) ?? rows[0]
  return <section className="mx-auto w-full max-w-[1240px] space-y-4"><WorkspaceHeading title="复盘">{role.locked && <button className={pageAction} onClick={() => create(true)}><Plus/>发起复盘</button>}</WorkspaceHeading>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
      <label className="relative min-w-0 grow sm:max-w-sm"><MagnifyingGlass className="absolute left-3 top-3 text-muted-foreground"/><input aria-label="搜索复盘" placeholder="搜索订单名称或写手" className={field+' pl-9'} value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <div className="w-32"><SelectField aria-label="复盘状态" value={status} onChange={e=>setStatus(e.target.value)}>
        <option value="">全部状态</option>{Object.entries(reviewStatus).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SelectField></div>
      {(needle || status) && <button className="ml-auto text-sm text-primary" onClick={()=>{setSearch('');setStatus('')}}>清除筛选</button>}
    </div>
    {!data ? <PageLoading page="reviews" error={!!error} onRetry={reload}/> : selection ? <div className="grid items-start gap-4 lg:grid-cols-[minmax(210px,1fr)_minmax(0,2fr)]">
      <div className="flex max-h-[65vh] gap-2 overflow-auto rounded-xl border bg-card p-3 lg:flex-col">{rows.map(r => <button key={r.id} onClick={() => select(r.id)} aria-pressed={r.id===selection.id} className={'min-w-48 rounded-md border p-3 text-left '+(r.id===selection.id?'border-primary/25 bg-primary/5':'border-transparent hover:bg-muted')}><Status r={r}/><b className="my-1 block break-words text-sm">{r.orderTitle}</b><span className="text-xs text-muted-foreground">{r.writerName}</span><time className="mt-1 block text-xs text-muted-foreground" dateTime={new Date(updatedAt(r)).toISOString()}>更新于 {businessDateTime(new Date(updatedAt(r)))}</time></button>)}</div>
      <Detail key={selection.id} r={selection} reload={reload}/></div> : <p className="rounded-xl border bg-card p-10 text-center text-muted-foreground">{needle || status ? '当前筛选下没有复盘' : '暂无复盘'}</p>}
    {creating && <CreateReview close={() => create(false)} saved={id => {setSearch('');setStatus('');select(id);reload()}}/>}
  </section>
}
