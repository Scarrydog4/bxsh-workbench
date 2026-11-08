import { useCallback, useEffect, useState } from 'react'
import { BellRinging, CaretDown, Check, CopySimple, LinkSimple, Prohibit, ArrowClockwise } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { CustomerPortalInternal, CustomerRequest } from '@/shared/customer-portal'
import { Thumbs } from './ImageViewer'
import { useSession } from './store'
import { inputCls } from './ui'

const stamp = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

export function OrderCustomer({ orderId }: { orderId: string }) {
  const { me } = useSession()
  const [data, setData] = useState<CustomerPortalInternal | null>(null)
  const [error, setError] = useState(''), [open, setOpen] = useState(false), [busy, setBusy] = useState(false)
  const [path, setPath] = useState(''), [confirm, setConfirm] = useState<'create' | 'revoke' | null>(null)
  const key = `bxsh:customer-link:${me.id}:${orderId}`
  const endpoint = `/api/orders/${encodeURIComponent(orderId)}/customer`
  const reload = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '客户记录加载失败')
      setData(result); setError('')
      try {
        const cached = JSON.parse(sessionStorage.getItem(key) || 'null')
        setPath(result.link.active && cached?.id === result.link.id ? cached.path : '')
      } catch { setPath('') }
    } catch (e) { setError(e instanceof Error ? e.message : '客户记录加载失败') }
  }, [endpoint, key])
  useEffect(() => {
    void reload()
    const changed = (event: Event) => {
      const ids = (event as CustomEvent<{ orderIds?: string[] }>).detail?.orderIds
      if (!ids || ids.includes(orderId)) void reload()
    }
    const reveal = (event: Event) => { if ((event as CustomEvent<string>).detail === orderId) setOpen(true) }
    window.addEventListener('bxsh:changed', changed)
    window.addEventListener('bxsh:customer-open', reveal)
    return () => { window.removeEventListener('bxsh:changed', changed); window.removeEventListener('bxsh:customer-open', reveal) }
  }, [reload, orderId])
  async function update(action: 'create' | 'revoke' | 'resolve', requestId?: string, reply?: string) {
    setBusy(true)
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, requestId, reply }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '操作未完成，请重试')
      if (action === 'create') {
        setPath(result.link.path)
        try { sessionStorage.setItem(key, JSON.stringify(result.link)) } catch { /* 当前页面仍可复制 */ }
      } else if (action === 'revoke') {
        setPath(''); try { sessionStorage.removeItem(key) } catch { /* 无持久缓存 */ }
      }
      setConfirm(null); await reload()
      // 浏览器禁用存储时仍保留刚生成的链接。
      if (action === 'create') setPath(result.link.path)
      toast.success(action === 'create' ? '客户链接已生成' : action === 'revoke' ? '客户链接已停用' : '已处理')
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : '操作未完成，请重试'); return false }
    finally { setBusy(false) }
  }
  async function loadMore() {
    if (!data?.hasMore || data.nextOffset == null) return
    setBusy(true)
    try {
      const response = await fetch(`${endpoint}?offset=${data.nextOffset}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '记录加载失败')
      setData(current => current && { ...result, requests: [...new Map([...current.requests, ...result.requests].map((row: CustomerRequest) => [row.id, row])).values()] })
    } catch (e) { toast.error(e instanceof Error ? e.message : '记录加载失败') }
    finally { setBusy(false) }
  }
  const pending = data?.requests.filter(row => row.status === 'pending').length ?? 0
  return <section data-order-field="客户消息" className="rounded-lg border">
    <button type="button" aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(!open)}>
      <BellRinging size={17} className="text-primary"/><span className="font-medium">客户催单与要求</span>
      {pending > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{pending} 待处理</span>}
      <CaretDown size={14} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`}/>
    </button>
    {open && <div className="space-y-3 border-t p-3">
      {error ? <div role="alert" className="flex items-center justify-between gap-2 text-sm text-danger">{error}<Button variant="outline" size="sm" onClick={() => void reload()}>重试</Button></div> : !data ? <p className="text-sm text-muted-foreground">正在读取…</p> : <>
        {data.canManage && <div className="space-y-2 rounded-lg bg-muted/40 p-3">
          <div className="flex flex-wrap items-center gap-2"><LinkSimple size={16}/><span className="text-sm font-medium">客户链接</span><span className="text-xs text-muted-foreground">{data.link.active ? '已开启' : '未开启'}</span>
            {!data.link.active && <Button size="sm" className="ml-auto" disabled={busy} onClick={() => void update('create')}>生成链接</Button>}
            {data.link.active && <div className="ml-auto flex gap-1"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm('create')}><ArrowClockwise size={14}/>重新生成</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm('revoke')}><Prohibit size={14}/>停用</Button></div>}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">发到该订单群，客户可催单、补充要求与截图；只展示这一单的进度。</p>
          {path && data.link.active && <div className="flex gap-2"><input aria-label="客户链接" readOnly className={`${inputCls} min-w-0 flex-1 text-xs`} value={typeof location === 'undefined' ? path : `${location.origin}${path}`} onFocus={event => event.currentTarget.select()}/><Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}${path}`); toast.success('链接已复制，可发到订单群') } catch { toast('请选中左侧链接复制') } }}><CopySimple size={15}/>复制</Button></div>}
          {data.link.active && !path && <p className="text-xs text-muted-foreground">已发出的链接仍有效。要再次取得链接，可重新生成；旧链接会失效。</p>}
          {confirm && <div className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs"><span className="flex-1">{confirm === 'create' ? '重新生成后，群里原来的链接将失效。' : '停用后，客户将无法打开原链接。'}</span><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>取消</Button><Button size="sm" disabled={busy} onClick={() => void update(confirm)}>确认{confirm === 'create' ? '重新生成' : '停用'}</Button></div>}
        </div>}
        {!data.requests.length ? <p className="py-3 text-center text-sm text-muted-foreground">暂无客户催单或补充要求</p> : <div className="divide-y">{data.requests.map(row => <CustomerMessage key={row.id} row={row} canResolve={data.canResolve} busy={busy} onResolve={(reply) => update('resolve', row.id, reply)}/>)}</div>}
        {data.hasMore && <Button variant="outline" className="w-full" disabled={busy} onClick={() => void loadMore()}>加载更多记录</Button>}
      </>}
    </div>}
  </section>
}

function CustomerMessage({ row, canResolve, busy, onResolve }: { row: CustomerRequest; canResolve: boolean; busy: boolean; onResolve: (reply: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false), [reply, setReply] = useState('')
  return <article className="space-y-2 py-3 first:pt-0">
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium text-foreground">{row.kind === 'nudge' ? '催单' : '补充要求'}</span><span>{row.name || '客户'}</span><time className="text-muted-foreground">{stamp(row.createdAt)}</time><span className={`ml-auto ${row.status === 'pending' ? 'text-warn' : 'text-muted-foreground'}`}>{row.status === 'pending' ? '待处理' : '已处理'}</span></div>
    {row.body && <p className="whitespace-pre-wrap break-words text-sm">{row.body}</p>}
    {!!row.shots.length && <Thumbs pics={row.shots.map((src, i) => ({ src, name: `客户截图${i + 1}.webp` }))} imgClass="h-16 w-16"/>}
    {row.reply && <p className="whitespace-pre-wrap rounded bg-primary/5 p-2 text-sm"><span className="text-muted-foreground">回复客户：</span>{row.reply}</p>}
    {row.status === 'pending' && canResolve && (editing ? <div className="space-y-2"><textarea aria-label="回复客户" maxLength={2000} rows={2} className={`${inputCls} h-auto w-full`} value={reply} onChange={e => setReply(e.target.value)} placeholder="回复客户（可选），填写后客户能看到"/><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>取消</Button><Button size="sm" disabled={busy} onClick={async () => { if (await onResolve(reply)) setEditing(false) }}><Check size={14}/>{reply.trim() ? '回复并标记已处理' : '标记已处理'}</Button></div></div> : <Button size="sm" variant="outline" onClick={() => setEditing(true)}>处理</Button>)}
  </article>
}
