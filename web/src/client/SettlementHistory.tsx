import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSession } from './store'
import { Money, Pill } from './ui'
import { SettlementNoteView } from './SettlementNote'
import { batchState } from './SettlePage'
import { businessDate } from '@/shared/format'
import { canViewSettlement } from '@/shared/settlement-access'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettlementNote } from './SettlementNote'
import { updateBatchNote } from './store-p2'
import { SettlementDate } from './SettlementDate'

export function SettlementHistory({ orderId, kind, title, payeeId, onClose }: { orderId: string; kind: string; title: string; payeeId: string; onClose: () => void }) {
  const { s, me, role, can } = useSession()
  const manage = can('settle.manage') && (role.locked || (kind === '写手工资' ? role.fields.writerPay : role.fields.commission) === 'all')
  const [edit, setEdit] = useState<{ id: string; note: string; shots: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const batches = s.batches.filter(b => canViewSettlement(b, me.id, role) && b.kind === kind && b.payeeId === payeeId && b.lines.some(l => l.orderId === orderId))
    .sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? '') || b.createdAt.localeCompare(a.createdAt))
  return <Dialog open onOpenChange={open => !open && !busy && !reading && onClose()}><DialogContent className="flex max-h-[85dvh] w-[calc(100vw-24px)] max-w-xl flex-col overflow-hidden">
    <DialogTitle>发放记录</DialogTitle><DialogDescription className="truncate">{title} · {kind}</DialogDescription>
    <div className="scroll-thin min-h-0 space-y-3 overflow-y-auto">{batches.length ? batches.map(b => {
      const line = b.lines.find(l => l.orderId === orderId)!
      const state = batchState(b)
      return <section key={b.id} className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>{b.historical ? '历史发放明细' : b.no}</strong><Pill tone={state.tone}>{state.label}</Pill></div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"><span>本单本次 <Money value={line.amount} className="font-semibold"/></span><span className="text-xs text-muted-foreground">{b.confirmedAt ? <time dateTime={b.confirmedAt}>发放于 {businessDate(b.confirmedAt)}</time> : b.status === '草稿' && b.createdAt ? <time dateTime={b.createdAt}>草稿创建于 {businessDate(b.createdAt)}</time> : '原发放日期未记录'}</span></div>
        {line.note && <p className="whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-sm">{line.note}</p>}
        {role.locked && manage && b.status === '已确认' && !b.confirmedAt && <SettlementDate id={b.id} disabled={busy || reading} onBusy={setBusy}/>}
        {edit?.id === b.id ? <>
          {b.lines.length > 1 && <p className="text-xs text-muted-foreground">此备注用于同批 {b.lines.length} 单</p>}
          <SettlementNote note={edit.note} shots={edit.shots} onNote={note => setEdit({ ...edit, note })} onShots={shots => setEdit({ ...edit, shots })} disabled={busy} onReading={setReading}/>
          <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy || reading} onClick={() => setEdit(null)}>取消</Button><Button size="sm" disabled={busy || reading} onClick={async () => { setBusy(true); try { if (await updateBatchNote(edit.id, edit.note, edit.shots)) setEdit(null) } finally { setBusy(false) } }}>{busy ? '保存中…' : '保存备注'}</Button></div>
        </> : <><SettlementNoteView note={b.note} shots={b.shots}/>{manage && !b.historical && b.status !== '已作废' && <button disabled={busy || reading} className="text-xs text-primary" onClick={() => setEdit({ id: b.id, note: b.note, shots: b.shots ?? [] })}>编辑备注 / 截图</button>}</>}
      </section>
    }) : <p className="py-8 text-center text-sm text-muted-foreground">暂无批次记录，历史已发金额见订单</p>}</div>
  </DialogContent></Dialog>
}
