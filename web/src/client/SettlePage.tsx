'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Coins, Plus, CheckCircle, Prohibit, PencilSimple, CaretRight } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SettleBatch } from '@/shared/types'
import type { Candidate } from '@/shared/settle'
import { canViewSettlement } from '@/shared/settlement-access'
import { sumMoney } from '@/shared/calc'
import { businessDate, iso, money, paydayKey, periodLabel, relTime } from '@/shared/format'
import { DataTable, TableFooter } from './table-kit'
import { Avatar, Combobox, Empty, Money, PageHeader, Person, Pill, StatusPill, inputCls } from './ui'
import { useSession } from './store'
import { confirmBatch, fetchCandidates, saveBatch, updateBatchNote, voidBatch, type Kind } from './store-p2'
import { SettlementNote, SettlementNoteView } from './SettlementNote'
import { SettlementDate } from './SettlementDate'
import { useNav } from './nav'
import { usePref } from './prefs'
import { IncomeDateFilter, incomePreset, matchesIncomeDate, type IncomeDateSelection } from './IncomeDateFilter'

type Filter = '全部' | '草稿' | '已发放' | '已作废'

/** 管理员确认即表示已付款，不再要求收款人二次确认。 */
export function batchState(b: SettleBatch): { label: string; tone: string } {
  if (b.status === '已作废') return { label: '已作废', tone: 'var(--muted-foreground)' }
  if (b.status === '草稿') return { label: '草稿', tone: 'var(--info)' }
  return { label: '已发放', tone: 'var(--ok)' }
}

/** 结算：写手工资 / 销售提成两个页签。管理员发起、确认、作废；收款人查看记录。 */
export function SettlePage() {
  const { s, me, can, role } = useSession()
  const f = role.locked ? { writerPay: 'all', commission: 'all' } : role.fields
  const manage = (k: Kind) => can('settle.manage') && (k === '写手工资' ? f.writerPay : f.commission) === 'all'
  const kinds = (['写手工资', '销售提成'] as Kind[]).filter((k) => manage(k) || s.batches.some((b) => b.kind === k))
  const [kind, setKind] = useState<Kind>(kinds[0] ?? '写手工资')
  const [filter, setFilter] = useState<Filter>('全部')
  const [payeeFilter, setPayeeFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ batch?: SettleBatch } | null>(null)

  const list = s.batches.filter((b) => canViewSettlement(b, me.id, role) && b.kind === kind && (!payeeFilter || b.payeeId === payeeFilter))
  const shown = list.filter((b) => {
    const st = batchState(b).label
    return filter === '全部' || st === filter
  })
  const count = (x: Filter) => list.filter((b) => batchState(b).label === x).length
  const current = shown.find((b) => b.id === open)

  return (
    <div>
      <PageHeader
        title="结算"
        sub="工资与提成"
      >
        {manage(kind) && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setEditing({})}>
            <Plus size={14} weight="bold" /> 新建结算单
          </Button>
        )}
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 divide-x rounded-lg border bg-card text-sm">
        {[['累计已发', list.filter(b => b.status === '已确认')], ['待发草稿', list.filter(b => b.status === '草稿')]].map(([label, batches]) => <div key={label as string} className="min-w-0 px-3 py-2"><div className="text-xs text-muted-foreground">{label as string}</div><Money value={(batches as SettleBatch[]).reduce((sum, b) => sum + b.total, 0)} className="mt-1 block font-semibold"/></div>)}
      </div>
      <DataTable
        toolbarExtras={<>
        {kinds.length > 1 && (
          <div className="flex rounded-lg border bg-card p-0.5">
            {kinds.map((k) => (
              <button key={k} onClick={() => setKind(k)} className={cn('rounded-md px-3 py-1 text-sm', kind === k ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}>
                {k}
              </button>
            ))}
          </div>
        )}
        {manage(kind) && <Combobox value={payeeFilter} onChange={setPayeeFilter} options={[{ value: '', label: '全部收款人' }, ...s.users.map(u => ({ value: u.id, label: u.name, icon: <Avatar user={u} size={18}/> }))]} placeholder="全部收款人" />}
        <div className="flex flex-wrap gap-1">
          {(['全部', '草稿', '已发放', '已作废'] as Filter[]).map((x) => (
            <button key={x} onClick={() => setFilter(x)} className={cn('h-7 rounded-full border px-2.5 text-xs', filter === x ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {x}
              {x !== '全部' && <span className="num ml-1">{count(x)}</span>}
            </button>
          ))}
        </div>
        </>}
          empty={<Empty icon={<Coins size={22} />} title={list.length ? '没有符合条件的结算单' : '还没有结算单'} />}
          id="settle"
          rows={shown}
          rowId={(b) => b.id}
          onRowClick={(b) => setOpen(b.id)}
          rowClassName={(b) => b.status === '已作废' && 'text-muted-foreground'}
          cols={[
            { id: 'no', header: '单号', size: 110, sort: (b) => b.no, cell: (b) => <span className="num">{b.no}</span> },
            { id: 'payee', header: '收款人', size: 130, sort: (b) => b.payeeId, filterValue: b => s.users.find(u => u.id === b.payeeId)?.name ?? '', cell: (b) => <Person user={s.users.find((u) => u.id === b.payeeId)} /> },
            { id: 'period', header: '发放期', size: 100, sort: (b) => b.period ?? '', cell: (b) => (b.period ? periodLabel(b.period) : <span className="text-muted-foreground">—</span>) },
            { id: 'n', header: '单数', size: 70, align: 'right', sort: (b) => b.lines.length, cell: (b) => <span className="num">{b.lines.length}</span> },
            { id: 'total', header: '合计', size: 110, align: 'right', sort: (b) => b.total, cell: (b) => <Money value={b.total} className={b.status === '已作废' ? 'line-through' : 'font-medium'} /> },
            { id: 'note', header: '备注 / 凭证', size: 200, filterValue: b => b.note, cell: b => <span className="block truncate text-muted-foreground" title={b.note}>{b.note || '—'}{!!b.shots?.length && <span className="ml-2 text-primary">{b.shots.length} 张截图</span>}</span> },
            { id: 'state', header: '状态', size: 140, sort: (b) => batchState(b).label, cell: (b) => <Pill tone={batchState(b).tone}>{batchState(b).label}</Pill> },
            {
              id: 'at',
              header: '时间',
              size: 150,
              sort: (b) => b.confirmedAt ?? b.createdAt,
              cell: (b) => <span className="text-xs text-muted-foreground">{b.confirmedAt ? `结算 ${relTime(b.confirmedAt)}` : b.status === '已确认' ? '原日期未记录' : b.createdAt ? `${b.createdBy === 'system' ? '系统生成' : '新建'} ${relTime(b.createdAt)}` : '原日期未记录'}</span>,
            },
          ]}
      />

      <BatchDialog batch={current} onClose={() => setOpen(null)} onEdit={(b) => (setOpen(null), setEditing({ batch: b }))} canManage={!!current && manage(current.kind)} />
      {editing && <BatchEditor kind={editing.batch?.kind ?? kind} batch={editing.batch} onClose={() => setEditing(null)} onSaved={(id) => (setEditing(null), setOpen(id))} />}
    </div>
  )
}

export function paymentRecordColumnOrder(order: string[]) {
  return order.length && !order.includes('orders') ? ['orders', ...order] : order
}

export function SettlementRecords({ kind, payeeId, tableId: customTableId, hidePayeeFilter = false, queryControls = false }: { kind?: Kind; payeeId?: string; tableId?: string; hidePayeeFilter?: boolean; queryControls?: boolean }) {
  const { s, me, role, can } = useSession()
  const tableId = customTableId ?? (payeeId ? 'income-payment-records' : 'settle')
  const [columnOrder, setColumnOrder] = usePref<string[]>(`cols-order:${tableId}`, [])
  useEffect(() => {
    const next = paymentRecordColumnOrder(columnOrder)
    if (next !== columnOrder) setColumnOrder(next)
  }, [columnOrder, setColumnOrder])
  const manage = (k: Kind) => can('settle.manage') && (role.locked || (k === '写手工资' ? role.fields.writerPay : role.fields.commission) === 'all')
  const [open, setOpen] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<IncomeDateSelection | null>(null)
  const activeDateRange = queryControls ? dateRange : null
  // 待发草稿在「待发」页处理，这里只放发过和撤回的
  const available = s.batches.filter((b) => canViewSettlement(b, me.id, role) && (!kind || b.kind === kind) && b.status !== '草稿' && (!payeeId || b.payeeId === payeeId))
  const list = available.filter((b) => matchesIncomeDate(b.confirmedAt ? businessDate(b.confirmedAt) : null, activeDateRange))
    .sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? '') || b.createdAt.localeCompare(a.createdAt))
  const current = list.find((b) => b.id === open)
  return <>
    <DataTable
      searchPlaceholder="订单名称、收款人、备注"
      preferredFilterFields={['state', ...(!kind ? ['kind'] : []), ...(!hidePayeeFilter && !payeeId ? ['payee'] : []), 'total', ...(!queryControls ? ['at'] : [])]}
      toolbarExtras={queryControls && <IncomeDateFilter compact label="结算日期" value={dateRange ?? incomePreset('month')} all={dateRange === null} onAll={() => setDateRange(null)} onChange={setDateRange} />}
      footer={table => {
        const visible = table.getRowModel().rows.map(row => row.original)
        const confirmed = visible.filter(b => b.status === '已确认')
        const voided = visible.filter(b => b.status === '已作废')
        return <TableFooter><div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span>{visible.some(b => b.historical) ? <>{visible.filter(b => !b.historical).length} 次结算 · {visible.filter(b => b.historical).length} 条历史明细</> : <>{visible.length} 次结算记录</>}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">已发合计 <Money value={sumMoney(confirmed.map(b => b.total))} className="font-semibold text-foreground" />{voided.length > 0 && <span>作废金额 <Money value={sumMoney(voided.map(b => b.total))} /></span>}</span>
        </div></TableFooter>
      }}
      fill
      toolbarSort={queryControls}
      defaultSorting={queryControls ? [{ id: 'at', desc: true }] : undefined}
      id={tableId}
      rows={list}
      rowId={(b) => b.id}
      onRowClick={(b) => setOpen(b.id)}
      rowClassName={(b) => b.status === '已作废' && 'text-muted-foreground'}
      empty={<Empty icon={<Coins size={22} />} title={available.length ? '没有符合条件的记录' : '还没有发放记录'} />}
      cols={[
        { id: 'orders', header: '订单名称', size: 300, minSize: 160, sort: b => b.lines[0]?.title ?? '', filterValue: b => b.lines.map(line => line.title).join(' '), cell: b => <button type="button" className="flex w-full min-w-0 items-center gap-2 text-left hover:text-primary" aria-label={`查看${b.lines.length > 1 ? `这 ${b.lines.length} 单的` : `${b.lines[0]?.title ?? ''}的`}发放明细`} onClick={e => { e.stopPropagation(); setOpen(b.id) }}>
          <span className="min-w-0 flex-1 truncate font-medium" title={b.lines[0]?.title}>{b.lines[0]?.title || '—'}</span>
          {b.lines.length > 1 && <span className="shrink-0 text-xs text-muted-foreground">等 {b.lines.length} 单</span>}
          <CaretRight size={14} className="shrink-0 text-muted-foreground" aria-hidden="true"/>
        </button> },
        { id: 'at', header: '结算日期', filterType: 'date', size: 120, sort: (b) => b.confirmedAt ?? '', filterValue: b => b.confirmedAt ? businessDate(b.confirmedAt) : null, cell: (b) => <span className="num text-muted-foreground">{b.confirmedAt ? businessDate(b.confirmedAt) : '原日期未记录'}</span> },
        { id: 'payee', header: '收款人', size: 130, sort: (b) => b.payeeId, filterValue: b => s.users.find(u => u.id === b.payeeId)?.name ?? '', cell: (b) => <Person user={s.users.find((u) => u.id === b.payeeId)} /> },
        ...(!kind ? [{ id: 'kind', header: '类型', size: 100, filterValue: (b: SettleBatch) => b.kind, cell: (b: SettleBatch) => b.kind }] : []),
        { id: 'total', header: '金额', size: 110, align: 'right', sort: (b) => b.total, cell: (b) => <Money value={b.total} className={b.status === '已作废' ? 'line-through' : 'font-medium'} /> },
        { id: 'n', header: '单数', size: 70, align: 'right', sort: (b) => b.lines.length, cell: (b) => <span className="num">{b.lines.length}</span> },
        { id: 'by', header: '经办人', size: 120, filterValue: b => s.users.find(u => u.id === (b.confirmedBy ?? b.createdBy))?.name ?? '', cell: b => <Person user={s.users.find(u => u.id === (b.confirmedBy ?? b.createdBy))}/> },
        { id: 'note', header: '备注 / 截图', size: 220, filterValue: b => b.note, cell: b => <span className="block truncate text-muted-foreground" title={b.note}>{b.note || '—'}{!!b.shots?.length && <span className="ml-2 text-primary">{b.shots.length} 张截图</span>}</span> },
        { id: 'state', header: '状态', size: 100, sort: (b) => batchState(b).label, cell: (b) => <Pill tone={batchState(b).tone}>{batchState(b).label}</Pill> },
        { id: 'no', header: '记录号', size: 110, sort: (b) => b.no, cell: (b) => <span className="num text-muted-foreground">{b.no}</span> },
      ]}
    />
    <BatchDialog batch={current} onClose={() => setOpen(null)} canManage={!!current && manage(current.kind)} />
  </>
}

export function BatchDialog({ batch: b, onClose, onEdit, canManage }: { batch?: SettleBatch; onClose: () => void; onEdit?: (b: SettleBatch) => void; canManage: boolean }) {
  const { s, user, views, role } = useSession()
  const { openOrder } = useNav()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [note, setNote] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const readingRef = useRef(false)
  const onReading = (value: boolean) => { readingRef.current = value; setReading(value) }
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setVoiding(false)
    setEditingNote(false)
    setReason('')
  }, [b?.id])
  if (!b) return null
  const st = batchState(b)
  const editable = canManage && !b.historical
  const canVoid = editable && b.status !== '已作废'
  return (
    <Dialog open onOpenChange={(o) => !o && !saving && !readingRef.current && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[680px] flex flex-col gap-0 overflow-hidden p-0">
        <div className="border-b px-5 py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            {b.historical && <span>历史发放明细</span>}
            <span className="num">{b.no}</span>
            <span className="text-muted-foreground">·</span>
            {b.kind}
            <Pill tone={st.tone}>{st.label}</Pill>
          </DialogTitle>
          <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              收款人 <Avatar user={user(b.payeeId)} size={16} /> {user(b.payeeId)?.name}
            </span>
            {b.period && <span>发放期 {periodLabel(b.period)}</span>}
            <span>发放日期 {b.confirmedAt ? businessDate(b.confirmedAt) : b.status === '草稿' ? '待发放' : '原日期未记录'}</span>
            <span>经办人 {user(b.confirmedBy ?? b.createdBy)?.name ?? (b.createdBy === 'system' ? '系统' : '—')}</span>
            {b.createdAt && <span>记录于 {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(b.createdAt))}</span>}
          </DialogDescription>
        </div>
        <div className="scroll-thin min-h-0 overflow-auto px-5 py-2">
          {canManage && role.locked && b.status === '已确认' && !b.confirmedAt && <div className="py-3"><SettlementDate key={b.id} id={b.id} disabled={saving || reading} onBusy={setSaving}/></div>}
          <div className="flex items-center justify-between gap-3 border-b py-2 text-xs text-muted-foreground"><span>订单名称</span><span className="shrink-0">本次发放</span></div>
          {b.lines.map((l) => (
            <button key={l.id} disabled={!views.some(v => v.id === l.orderId) || saving || reading} onClick={() => { if (!saving && !readingRef.current) { onClose(); openOrder(l.orderId) } }} className="flex w-full items-center gap-3 border-b py-2.5 text-left text-sm last:border-b-0 enabled:hover:text-primary disabled:cursor-default">
              <span className="min-w-0 flex-1">
                <span className="block whitespace-normal break-words">{l.title}</span>
                {l.note && <span className="mt-1 block whitespace-pre-wrap text-xs text-muted-foreground">{l.note}</span>}
              </span>
              <Money value={l.amount} className="shrink-0" />
            </button>
          ))}
          <div className="space-y-2 border-t py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground"><span>备注 / 凭证</span>{editable && b.status !== '已作废' && !editingNote && <button className="text-primary" onClick={() => { setNote(b.note); setShots(b.shots ?? []); setEditingNote(true) }}>编辑备注</button>}</div>
            {editingNote ? <>
              <SettlementNote note={note} shots={shots} onNote={setNote} onShots={setShots} disabled={saving} onReading={onReading}/>
              <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={saving || reading} onClick={() => { if (!saving && !readingRef.current) setEditingNote(false) }}>取消</Button><Button size="sm" disabled={saving || reading} onClick={async () => { if (saving || readingRef.current) return; setSaving(true); try { if (await updateBatchNote(b.id, note, shots)) { setEditingNote(false); toast.success('备注已保存') } } finally { setSaving(false) } }}>保存备注</Button></div>
            </> : b.note || b.shots?.length ? <SettlementNoteView note={b.note} shots={b.shots}/> : <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </div>
        <div className="grid shrink-0 gap-3 border-t px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{b.lines.length} 单</span>
            <span className="font-medium">
              合计 <Money value={b.total} className="text-lg" />
            </span>
          </div>
          {voiding ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (saving || readingRef.current) return
                if (!reason.trim()) return toast.error('写一下作废原因')
                if (await voidBatch(b.id, reason.trim())) {
                  toast.success(`${b.no} 已作废`)
                  onClose()
                }
              }}
            >
              <input autoFocus aria-label="作废原因" className={cn(inputCls, 'h-8 min-w-0 flex-1')} placeholder="作废原因，如金额算错了" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button type="button" size="sm" variant="ghost" className="h-8" disabled={saving || reading} onClick={() => { if (!saving && !readingRef.current) setVoiding(false) }}>
                取消
              </Button>
              <Button type="submit" size="sm" variant="destructive" className="h-8" disabled={saving || reading}>
                作废
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {canVoid && (
                <Button size="sm" variant="ghost" className="h-8 gap-1 text-danger hover:text-danger" disabled={saving || reading} onClick={() => { if (!saving && !readingRef.current) setVoiding(true) }}>
                  <Prohibit size={14} /> 作废
                </Button>
              )}
              {editable && onEdit && b.status === '草稿' && (
                <Button size="sm" variant="outline" className="h-8 gap-1" disabled={saving || reading} onClick={() => { if (!saving && !readingRef.current) onEdit(b) }}>
                  <PencilSimple size={14} /> 编辑
                </Button>
              )}
              {editable && b.status === '草稿' && (
                <Button size="sm" className="h-8 gap-1" disabled={saving || reading} onClick={() => { if (!saving && !readingRef.current) void confirmBatch(b.id).then((ok) => ok && toast.success(`${b.no} 已发放`)) }}>
                  <CheckCircle size={14} weight="fill" /> 确认已发放
                </Button>
              )}

            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 新建 / 编辑草稿：选收款人 → 列出没结清的单（默认填剩余应结，可改）→ 勾选 → 合计 → 保存或直接确认 */
function BatchEditor({ kind, batch, onClose, onSaved }: { kind: Kind; batch?: SettleBatch; onClose: () => void; onSaved: (id: string) => void }) {
  const { s, adminIds } = useSession()
  const [payee, setPayee] = useState(batch?.payeeId ?? '')
  const [rows, setRows] = useState<(Candidate & { on: boolean; amount: string; note: string; showNote: boolean })[] | null>(null)
  const [note, setNote] = useState(batch?.note ?? '')
  const [shots, setShots] = useState<string[]>(batch?.shots ?? [])
  const [reading, setReading] = useState(false)
  const readingRef = useRef(false)
  const onReading = (value: boolean) => { readingRef.current = value; setReading(value) }
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  // 写手工资按发放期列：默认只列到最近这个 15 日为止已经该发的（交了初稿的）；可以放宽到下一期或不限
  const periods = useMemo(() => {
    const now = paydayKey(new Date().toISOString())!
    const [y, m] = now.split('-').map(Number)
    return [now, iso(new Date(y, m, 15))]
  }, [])
  const [period, setPeriod] = useState<string>(kind === '写手工资' && !batch ? periods[0] : '')

  const people = useMemo(
    () =>
      s.users.filter((u) => (kind === '写手工资' ? !adminIds.has(u.id) && (u.canWrite || s.orders.some((o) => o.assignees.some((a) => a.userId === u.id))) : !adminIds.has(u.id) && u.isSales)).map((u) => ({ value: u.id, label: u.name, hint: u.active === false ? '已停用' : undefined, icon: <Avatar user={u} size={18} /> })),
    [s.users, s.orders, kind, adminIds],
  )

  useEffect(() => {
    if (!payee) return setRows(null)
    let live = true
    setRows(null); setLoadError('')
    void fetchCandidates(kind, payee, { except: batch?.id, period: period || undefined }).then((list) => {
      if (!live) return
      const mine = new Map(batch?.lines.map((l) => [l.orderId, l]))
      setRows(list.map((c) => ({ ...c, on: batch ? mine.has(c.orderId) : c.suggested, amount: String(mine.get(c.orderId)?.amount ?? c.remaining), note: mine.get(c.orderId)?.note ?? '', showNote: !!mine.get(c.orderId)?.note })))
    }).catch(e => { if (live) setLoadError(e instanceof Error ? e.message : '加载失败') })
    return () => {
      live = false
    }
  }, [payee, kind, batch, period, retry])

  const picked = (rows ?? []).filter((r) => r.on && Number(r.amount) > 0)
  const total = Math.round(picked.reduce((a, r) => a + Number(r.amount), 0) * 100) / 100
  const over = picked.filter((r) => Number(r.amount) > r.remaining)

  async function save(confirm: boolean) {
    if (submitting.current || readingRef.current) return
    if (!picked.length) return toast.error('至少勾选一单')
    if ((rows ?? []).some(r => r.on && (!Number.isFinite(Number(r.amount)) || Number(r.amount) <= 0))) return toast.error('请填写有效金额')
    submitting.current = true; setBusy(true)
    try {
      const r = await saveBatch({ id: batch?.id, kind, payeeId: payee, note, shots, lines: picked.map((x) => ({ orderId: x.orderId, amount: Number(x.amount), note: x.note })) })
      if (!r) return
      if (confirm && !(await confirmBatch(r.id))) return onSaved(r.id)
      toast.success(confirm ? '已发放' : '草稿已保存')
      onSaved(r.id)
    } finally {
      submitting.current = false; setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting.current && !readingRef.current && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[760px] flex flex-col gap-0 overflow-hidden p-0">
        <div className="border-b px-5 py-4">
          <DialogTitle className="text-base">{batch ? `编辑 ${batch.no}` : `新建${kind}结算单`}</DialogTitle>
          <DialogDescription className="mt-1 text-xs">填写本次发放金额</DialogDescription>
        </div>
        <div className="scroll-thin grid min-h-0 gap-3 overflow-y-auto px-4 py-3 sm:px-5">
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            收款人
            {batch ? (
              <Person user={s.users.find((u) => u.id === payee)} />
            ) : (
              <Combobox value={payee} onChange={setPayee} options={people} placeholder={kind === '写手工资' ? '选写手' : '选销售'} autoFocus />
            )}
          </label>
          {kind === '写手工资' && (
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              列出
              {[...periods, ''].map((p) => (
                <button key={p || 'all'} type="button" onClick={() => setPeriod(p)} className={cn('rounded-full border px-2 py-0.5', period === p ? 'border-primary bg-primary/10 text-primary' : 'border-dashed border-input hover:border-primary')}>
                  {p ? `${periodLabel(p)}及以前该发的` : '全部已交付未结清'}
                </button>
              ))}
            </div>
          )}
          {loadError && <div className="text-sm text-danger">{loadError}<button className="ml-2 text-primary" onClick={() => setRetry(x => x + 1)}>重试</button></div>}
          {payee && rows === null && !loadError && <div className="py-6 text-center text-sm text-muted-foreground">正在算每单还剩多少……</div>}
          {rows && rows.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">暂无可结算订单</div>}
          {rows && rows.length > 0 && (
            <div className="-mx-1 px-1">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span>所选每单</span>{[100, 200].map(n => <button type="button" key={n} className="rounded border px-2 py-1 hover:border-primary hover:text-primary" disabled={busy} onClick={() => setRows(rows.map(r => r.on ? { ...r, amount: String(Math.min(n, r.remaining)) } : r))}>{n} 元</button>)}<button type="button" className="ml-auto text-primary" disabled={busy} onClick={() => setRows(rows.map(r => r.on ? { ...r, amount: String(r.remaining) } : r))}>结清所选</button></div>
              <div className="mb-1 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Checkbox aria-label="全选" checked={rows.every((r) => r.on) ? true : rows.some((r) => r.on) ? 'indeterminate' : false} onCheckedChange={(v) => setRows(rows.map((r) => ({ ...r, on: !!v })))} />
                <span className="flex-1">订单</span>
                <span className="w-16 shrink-0 text-right sm:w-20">剩余应结</span>
                <span className="w-20 shrink-0 text-right sm:w-24">本次结算</span>
              </div>
              {rows.map((r, i) => (
                <div key={r.orderId} className="border-b py-2 last:border-b-0"><div className={cn('flex items-center gap-2 rounded-md px-1 text-sm', !r.on && 'opacity-60')}>
                  <Checkbox aria-label={`选 ${r.no}`} checked={r.on} onCheckedChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, on: !!v } : x)))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {r.status === '退单' && <StatusPill status={r.status} />}
                    </span>
                  </span>
                  <span className="num w-16 shrink-0 text-right text-muted-foreground sm:w-20">{money(r.remaining)}</span>
                  <input
                    aria-label={`${r.no} 本次结算金额`}
                    inputMode="decimal"
                    className={cn(inputCls, 'num h-8 w-20 shrink-0 text-right sm:w-24', Number(r.amount) > r.remaining && 'border-warn')}
                    value={r.amount}
                    onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, ''), on: true } : x)))}
                  />
                </div>
                {r.on && <div className="ml-7 mt-1 flex justify-between gap-2 text-xs text-muted-foreground"><button type="button" className="hover:text-primary" onClick={() => setRows(rows.map((x, k) => k === i ? { ...x, showNote: !x.showNote } : x))}>{r.note ? '单笔备注' : '+ 备注'}</button><span>本次后未结 <Money value={Math.max(0, Math.round((r.remaining - (Number(r.amount) || 0)) * 100) / 100)}/></span></div>}
                {r.on && r.showNote && <textarea aria-label={`${r.no} 单笔备注`} rows={2} maxLength={500} className={cn(inputCls, 'mt-2 h-auto resize-y py-2 text-sm')} placeholder="单笔备注（可选）" value={r.note} onChange={e => setRows(rows.map((x, k) => k === i ? { ...x, note: e.target.value } : x))}/>}
                </div>
              ))}
            </div>
          )}
          <SettlementNote note={note} shots={shots} onNote={setNote} onShots={setShots} disabled={busy} onReading={onReading}/>
          {reading && <span className="text-xs text-muted-foreground">正在读取截图…</span>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-5">
          <span className="text-sm">
            已选 <span className="num">{picked.length}</span> 单 · 合计 <Money value={total} className="font-medium" />
            {over.length > 0 && <span className="ml-2 text-xs text-warn">{over.length} 单超过剩余应结</span>}
          </span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" className="h-8" disabled={busy || reading} onClick={() => { if (!submitting.current && !readingRef.current) onClose() }}>
              取消
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={busy || reading || !picked.length} onClick={() => void save(false)}>
              保存草稿
            </Button>
            <Button size="sm" className="h-8" disabled={busy || reading || !picked.length} onClick={() => void save(true)}>
              保存并确认发放
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
