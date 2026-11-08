import { SelectField } from './SelectField'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Coins } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { inputCls, Empty } from './ui'
import type { PointsView } from '@/shared/points'
import { relTime } from '@/shared/format'
import { useSession } from './store'

export function PointsDialog({ open, onOpenChange, wallet, reload }: { open: boolean; onOpenChange: (v: boolean) => void; wallet: PointsView | null; reload: () => Promise<void> }) {
  const { me } = useSession()
  const pendingKey = `bxsh:pending-points:${me.id}`
  const [userId, setUserId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [tab, setTab] = useState('mine')
  const amountInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) setTab(wallet?.manage ? 'manage' : 'mine')
  }, [open, wallet?.manage])
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(pendingKey) ?? 'null')
      if (p && typeof p.id === 'string' && typeof p.userId === 'string' && typeof p.amount === 'string' && typeof p.note === 'string') {
        setRequestId(p.id); setUserId(p.userId); setAmount(p.amount); setNote(p.note)
      }
    } catch { /* 本机没有待恢复的分配 */ }
  }, [pendingKey])
  function clearPending() { setRequestId(null); try { localStorage.removeItem(pendingKey) } catch { /* 本机存储不可用 */ } }
  async function update(body: { action: string } & Record<string, unknown>) {
    setBusy(true)
    try {
      const r = await fetch('/api/points', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = await r.json()
      if (!r.ok) { if (r.status < 500 && body.action === 'allocate') clearPending(); throw new Error(data.error ?? '保存失败') }
      await reload()
      toast.success(body.action === 'allocate' ? `已给 ${wallet?.accounts?.find((a) => a.userId === body.userId)?.name ?? '该账号'} 增加 ${body.points} 积分` : '积分价格已更新')
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : '连接中断，再次点击会恢复本次分配'); return false }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[650px]"><DialogHeader><DialogTitle>{wallet?.manage ? '分配积分' : '账号积分'}</DialogTitle><DialogDescription>{wallet?.manage ? '可给任意启用账号增加积分，包括自己的账号。每次分配都会记入明细。' : '积分由管理员分配。任务提交时预占，完成后扣除；失败会退回。'}</DialogDescription></DialogHeader>
    <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-4 text-center"><div><p className="text-xs text-muted-foreground">可用积分</p><p className="mt-1 text-xl font-semibold num">{wallet?.available ?? '—'}</p></div><div><p className="text-xs text-muted-foreground">处理中占用</p><p className="mt-1 text-xl font-semibold num">{wallet?.reserved ?? '—'}</p></div><div><p className="text-xs text-muted-foreground">总余额</p><p className="mt-1 text-xl font-semibold num">{wallet?.balance ?? '—'}</p></div></div>
    <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="mine">我的明细</TabsTrigger>{wallet?.manage && <TabsTrigger value="manage">查看与分配</TabsTrigger>}</TabsList>
      <TabsContent value="mine" className="mt-4 grid gap-2">
        {wallet?.entries.length ? wallet.entries.map((e) => <div key={e.id} className="flex gap-3 border-b py-2.5 text-sm"><div className="min-w-0 flex-1"><p>{e.kind}</p><p className="mt-1 text-xs text-muted-foreground">{e.note} · {e.actorName} · {relTime(e.at)}</p></div><span className="shrink-0 num">{e.delta ? `${e.delta > 0 ? '+' : ''}${e.delta}` : e.reservedDelta > 0 ? `预占 ${e.reservedDelta}` : `退回 ${-e.reservedDelta}`}</span></div>) : <Empty icon={<Coins size={20} />} title="还没有积分记录" />}
      </TabsContent>
      {wallet?.manage && <TabsContent value="manage" className="mt-4 grid gap-5">
        <div className="overflow-hidden rounded-lg border"><div className="grid grid-cols-[1fr_45px_45px_60px] gap-2 bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><span>账号</span><span className="text-right">可用</span><span className="text-right">占用</span><span /></div>{wallet.accounts?.map((a) => <div key={a.userId} className="grid grid-cols-[1fr_45px_45px_60px] items-center gap-2 border-t px-3 py-2 text-sm"><div className="min-w-0"><p className="truncate">{a.name}{a.userId === me.id && '（自己）'}{!a.active && '（已停用）'}</p><p className="truncate text-xs text-muted-foreground">{a.account}</p></div><span className="text-right num">{a.available}</span><span className="text-right num">{a.reserved}</span><Button type="button" size="sm" variant="outline" className="px-2" aria-label={`给 ${a.account} 加积分`} disabled={!a.active || busy || !!requestId} onClick={() => { setUserId(a.userId); if (!amount) setAmount('20'); if (!note) setNote('管理员分配'); amountInput.current?.focus() }}>加积分</Button></div>)}</div>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault(); if (busy) return
          const id = requestId ?? crypto.randomUUID(); setRequestId(id)
          try { localStorage.setItem(pendingKey, JSON.stringify({ id, userId, amount, note })) } catch { /* 仍使用当前分配编号 */ }
          if (await update({ action: 'allocate', userId, points: Number(amount), note, requestId: id })) { setAmount(''); setNote(''); clearPending() }
        }}><h3 className="text-sm font-semibold">分配积分</h3>
          <SelectField aria-label="分配给谁" value={userId} className={inputCls} required disabled={busy || !!requestId} onChange={(e) => setUserId(e.target.value)}><option value="">选择账号</option>{wallet.accounts?.filter((a) => a.active).map((a) => <option key={a.userId} value={a.userId}>{a.name} · {a.account}{a.userId === me.id ? '（自己）' : ''}</option>)}</SelectField>
          <input ref={amountInput} aria-label="分配积分数量" type="number" min="1" max="100000000" step="1" required value={amount} disabled={busy || !!requestId} onChange={(e) => setAmount(e.target.value)} placeholder="本次增加多少积分" className={inputCls} />
          <div className="flex gap-2">{[20, 50, 100].map((points) => <Button key={points} type="button" size="sm" variant="outline" disabled={busy || !!requestId} onClick={() => { setAmount(String(points)); if (!note) setNote('管理员分配') }}>{points} 积分</Button>)}</div>
          <input aria-label="分配原因" required maxLength={200} value={note} disabled={busy || !!requestId} onChange={(e) => setNote(e.target.value)} placeholder="分配原因（会记入明细）" className={inputCls} />
          <Button disabled={busy || !userId || !amount || !note.trim()}>{busy ? '正在保存…' : requestId ? '恢复本次分配' : '确认分配'}</Button>
          {requestId && !busy && <p className="text-xs text-muted-foreground">本次分配编号已保留。再次点击只确认原分配，不会重复加积分。</p>}
        </form>
        <form className="grid gap-2 border-t pt-4" onSubmit={async (e) => { e.preventDefault(); if (!busy && await update({ action: 'price', points: Number(price) })) setPrice('') }}>
          <h3 className="text-sm font-semibold">双降价格</h3><p className="text-xs text-muted-foreground">当前：{wallet.price ? `每次 ${wallet.price.points} 积分` : '尚未设置，处理入口暂时关闭'}。新价格只影响后续任务。</p>
          <div className="flex gap-2"><input aria-label="每次处理积分" type="number" min="1" max="1000000" step="1" required value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} placeholder="每次处理的固定积分" className={inputCls} /><Button variant="outline" disabled={busy || !price}>保存价格</Button></div>
        </form>
      </TabsContent>}
    </Tabs>
  </DialogContent></Dialog>
}
