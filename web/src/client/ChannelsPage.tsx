import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { HeaderBar, PersonFilter } from './controls'
import { receiptTotals } from '@/shared/receipts'
import { migrateChannelDefaultColumns } from '@/shared/table-default-layouts'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash, CaretRight, DownloadSimple, DotsThree } from '@phosphor-icons/react'
import { ChannelExport } from './ChannelExport'
import { useNav } from './nav'
import { usePref } from './prefs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DataTable, TableFooter, TablePageHeader } from './table-kit'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import type { Channel } from '@/shared/types'
import { AvatarButton, ChannelAvatar, StatusPill, Combobox, ImageDrop, Money, Person, inputCls, Avatar } from './ui'
import { act, createChannel, deleteChannel, salesPeople, setChannelAvatar, updateChannel, useSession } from './store'
import { StatementDialog } from './Statement'
import { ChannelReceiptDialog, ChannelReceiptHistory } from './ChannelReceipts'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
import { receiptCandidate } from '@/shared/receipt-allocation'

export function ChannelsPage({initialId,focusToken=0}:{initialId?:string|null;focusToken?:number}) {
  const { s, views, can, user, me, role, adminIds } = useSession()
  const [columnOrder, setColumnOrder] = usePref<string[]>('cols-order:channels', [])
  useEffect(() => {
    const next = migrateChannelDefaultColumns(columnOrder)
    if (next !== columnOrder) setColumnOrder(next)
  }, [columnOrder, setColumnOrder])
  const manageChannels = role.locked && can('channel.manage')
  const canCreate = can('channel.manage') || can('order.create')
  const canChangeAvatar = (channel: Channel) => manageChannels || can('order.create') && channel.ownerId === me.id
  const { openOrder } = useNav()
  const [transfer, setTransfer] = useState<{ channel: Channel; ownerId: string; count: number; settled: number } | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [expanded, setExpanded] = useState<string[]>(initialId?[initialId]:[])
  const initialOwner = s.channels.find(c => c.id === initialId)?.ownerId
  const [selectedOwner, setSelectedOwner] = useState(initialOwner ?? me.id)
  useEffect(() => {
    if (!initialId || !initialOwner) return
    setExpanded(old => old.includes(initialId) ? old : [...old, initialId])
    setSelectedOwner(initialOwner)
    const frame = requestAnimationFrame(() => document.getElementById(`channel-${initialId}`)?.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  }, [initialId, initialOwner, focusToken])
  const owners = useMemo(() => s.users.filter(u => u.isSales && (u.active !== false || s.channels.some(c => c.ownerId === u.id))).sort((a,b) => Number(b.id === me.id) - Number(a.id === me.id)), [s.users, s.channels, me.id])
  const [exporting, setExporting] = useState<Channel | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [owner, setOwner] = useState(me.id)
  const [avatar, setAvatar] = useState<string>()
  const [removing, setRemoving] = useState<Channel | null>(null)
  const [targetId, setTargetId] = useState('')
  const [deleting, setDeleting] = useState(false)
  const relatedOrders = views.filter(v => v.channelId === removing?.id)
  const trashedOrders = s.trash.filter(v => v.channelId === removing?.id)
  const relatedCount = relatedOrders.length + trashedOrders.length
  const trashCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of s.trash) counts.set(o.channelId, (counts.get(o.channelId) ?? 0) + 1)
    return counts
  }, [s.trash])
  const [statement, setStatement] = useState<Channel | null>(null)
  const hasSales = views.some((v) => v.sales !== undefined)
  // 渠道收款入口已隐藏；已有记录仍可从订单详情查看。
  const canReceipt = false
  const [receiptChannel, setReceiptChannel] = useState<Channel | null>(null)
  const [receiptHistory, setReceiptHistory] = useState<{ channelId?: string; receiptId?: string } | null>(null)
  const [receiptSelection, setReceiptSelection] = useState<Record<string, string[]>>({})

  const stats = useMemo(() => {
    const m = new Map<string, { n: number; sales: number; unpaid: number; overpaid: number }>()
    for (const v of views) {
      const r = m.get(v.channelId) ?? { n: 0, sales: 0, unpaid: 0, overpaid: 0 }
      r.n++
      if (v.status !== '退单') {
        r.sales += v.sales ?? 0
        const receipt = receiptTotals([v])
        r.unpaid = Math.round((r.unpaid + receipt.unpaid) * 100) / 100
        r.overpaid = Math.round((r.overpaid + receipt.overpaid) * 100) / 100
      }
      m.set(v.channelId, r)
    }
    return m
  }, [views])

  const rows = useMemo(() => s.channels.filter(c => role.locked ? selectedOwner === 'all' || c.ownerId === selectedOwner : c.ownerId === me.id).sort((a, b) =>
    Number(b.ownerId === me.id) - Number(a.ownerId === me.id) || (stats.get(b.id)?.sales ?? 0) - (stats.get(a.id)?.sales ?? 0) || (stats.get(b.id)?.n ?? 0) - (stats.get(a.id)?.n ?? 0)
  ), [s.channels, stats, selectedOwner, me.id, role.locked])
  const channelOrders = useMemo(() => {
    const grouped = new Map<string, typeof views>()
    for (const channel of s.channels) grouped.set(channel.id, [])
    for (const order of views) grouped.get(order.channelId)?.push(order)
    for (const orders of grouped.values()) orders.sort((a, b) => b.no.localeCompare(a.no))
    return grouped
  }, [s.channels, views])

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <TablePageHeader title="渠道" summary={`${rows.length} 个渠道`}>
        {canCreate && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => { setOwner(role.locked && selectedOwner !== 'all' ? selectedOwner : me.id); setAdding(true) }}>
            <Plus size={14} weight="bold" /> 新建渠道
          </Button>
        )}
      </TablePageHeader>

      {role.locked && <HeaderBar><PersonFilter label="渠道归属" value={selectedOwner} onChange={setSelectedOwner} people={owners.map(u => ({ id: u.id, user: u }))} /></HeaderBar>}

      {adding && (
        <form
          className="flex shrink-0 flex-wrap items-end gap-2 border-b bg-card p-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!canCreate) return
            if (!name.trim()) return toast.error('填一下渠道名称')
            if (s.channels.some((c) => c.name === name.trim())) return toast.error('已经有同名渠道')
            const channelOwner = role.locked ? owner : me.id
            if (!(await createChannel(name, channelOwner, avatar))) return
            toast.success(`已新建渠道「${name.trim()}」`)
            setName('')
            setAvatar(undefined)
            setAdding(false)
            setSelectedOwner(channelOwner)
          }}
        >
          <ImageDrop compact preview={avatar} showCamera={!avatar} onImage={setAvatar} />
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted-foreground">
            渠道名称
            <input id="ch-name" autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="机构或代理的名字" />
          </label>
          {role.locked && <label className="grid w-48 gap-1 text-xs text-muted-foreground">
            归属销售
            <Combobox value={owner} onChange={setOwner} options={salesPeople(s).map((u) => ({ value: u.id, label: u.name, hint: adminIds.has(u.id) ? '自营' : '销售', icon: <Avatar user={u} size={18} /> }))} />
          </label>}
          <Button size="sm" type="submit" className="h-9">保存</Button>
          <Button size="sm" variant="ghost" type="button" className="h-9" onClick={() => setAdding(false)}>取消</Button>
        </form>
      )}

      <DataTable
        fill
        id="channels"
        defaultVisibility={{ owner: false }}
        searchPlaceholder="渠道名称、归属销售"
        preferredFilterFields={['n', 'unpaid', 'sales']}
        rows={rows}
        rowId={(c) => c.id}
        onRowClick={c => setExpanded(old => old.includes(c.id) ? old.filter(id => id !== c.id) : [...old, c.id])}
        expandedRow={c => {
          if (!expanded.includes(c.id)) return null
          const orders = channelOrders.get(c.id)!
          return <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 font-medium"><ChannelAvatar channel={c} size={18}/>{c.name} · {orders.length} 单</span><div className="flex items-center gap-2">{canReceipt && <Button size="sm" className="h-7" onClick={() => setReceiptChannel(c)}>记收款{(receiptSelection[c.id] ?? []).filter(id => orders.some(o => o.id === id && receiptCandidate(o))).length > 0 && ` · ${(receiptSelection[c.id] ?? []).filter(id => orders.some(o => o.id === id && receiptCandidate(o))).length} 单`}</Button>}{can('order.export') && <Button size="sm" variant="outline" className="h-7" onClick={()=>setExporting(c)}><DownloadSimple className="mr-1" size={14}/>导出订单</Button>}</div></div>
            <DataTable embedded id={`channel-orders:${c.id}`} rows={orders} rowId={v => v.id}
              defaultVisibility={{ received: false }} searchPlaceholder="订单名称" preferredFilterFields={['status', 'unpaid', 'sales']}
              onRowClick={v => openOrder(v.id, orders.map(o => o.id))}
              cols={[
                ...(canReceipt ? [{ id: 'receipt-select', header: '选择', size: 58, cell: (v: typeof orders[number]) => <span className="flex justify-center" onClick={e => e.stopPropagation()}><Checkbox aria-label={`选择收款 ${v.no}`} disabled={!receiptCandidate(v)} checked={receiptCandidate(v) && (receiptSelection[c.id] ?? []).includes(v.id)} onCheckedChange={on => setReceiptSelection(old => ({ ...old, [c.id]: on ? [...new Set([...(old[c.id] ?? []), v.id])] : (old[c.id] ?? []).filter(id => id !== v.id) }))}/></span> }] : []),
                { id: 'title', header: '订单名称', size: 240, sort: v => v.title, cell: v => <span className="block truncate" title={v.title}>{v.title}</span> },
                ...(hasSales ? [
                  { id: 'sales', header: '销售额', size: 100, align: 'right' as const, filterValue: (v: typeof orders[number]) => v.sales, cell: (v: typeof orders[number]) => <Money value={v.sales} plain className="text-gold"/> },
                  { id: 'unpaid', header: '未收', size: 100, align: 'right' as const, filterValue: (v: typeof orders[number]) => v.unpaid, cell: (v: typeof orders[number]) => <span>{(v.unpaid??0)<0?"多收 ":""}<Money value={Math.abs(v.unpaid??0)} plain className={(v.unpaid??0)<0 ? "text-danger" : "text-foreground"}/></span> },
                  { id: 'received', header: '已收', size: 100, align: 'right' as const, filterValue: (v: typeof orders[number]) => v.received, cell: (v: typeof orders[number]) => <Money value={v.received}/> },
                ] : []),
                { id: 'status', header: '状态', size: 108, sort: v => v.status, cell: v => <StatusPill status={v.status}/> },
              ]}
              empty={<p className="py-4 text-center text-muted-foreground">暂无订单</p>}
            />
          </div>
        }}
        cols={[
          {
            id: 'name',
            header: '渠道',
            size: 220,
            sort: (c) => c.name,
            cell: (c) => (
              <span id={`channel-${c.id}`} className="flex items-center gap-2.5 font-medium"><button aria-label={`${expanded.includes(c.id) ? '收起' : '展开'}渠道 ${c.name}`} aria-expanded={expanded.includes(c.id)}><CaretRight size={14} className={expanded.includes(c.id)?'rotate-90 transition-transform [transition-duration:180ms]':'transition-transform [transition-duration:180ms]'}/></button>
                <AvatarButton preview={c.avatar} showCamera={!c.avatar} label={`给「${c.name}」换头像`} disabled={!canChangeAvatar(c)} onPick={async url => { if (!canChangeAvatar(c)) return false; const ok = await setChannelAvatar(c.id, url); if (ok) toast.success(`已更新「${c.name}」的头像`); return ok }}>
                  <ChannelAvatar channel={c} size={22} />
                </AvatarButton>
                <span className="min-w-0 flex-1 break-words whitespace-normal sm:truncate">{c.name}</span>
                {c.note && <span className="shrink-0 text-xs font-normal text-muted-foreground">{c.note}</span>}
              </span>
            ),
          },
          ...(hasSales
            ? [
                { id: 'sales', header: '销售额', size: 120, align: 'right' as const, sort: (c: Channel) => stats.get(c.id)?.sales ?? 0, cell: (c: Channel) => <Money value={stats.get(c.id)?.sales ?? 0} plain className="text-gold" /> },
                {
                  id: 'unpaid',
                  header: '未收',
                  size: 110,
                  align: 'right' as const,
                  sort: (c: Channel) => stats.get(c.id)?.unpaid ?? 0,
                  cell: (c: Channel) => <div><Money value={stats.get(c.id)?.unpaid ?? 0} plain className="text-foreground" />{!!stats.get(c.id)?.overpaid && <span className="ml-2 text-xs text-muted-foreground">多收 <Money value={stats.get(c.id)?.overpaid}/></span>}</div>,
                },
              ]
            : []),
          { id: 'n', header: '单数', size: 130, align: 'right', sort: (c) => stats.get(c.id)?.n ?? 0, cell: (c) => <span className="whitespace-nowrap tabular-nums">{stats.get(c.id)?.n ?? 0}{!!trashCounts.get(c.id) && <Tooltip><TooltipTrigger asChild><span tabIndex={0} onClick={event => event.stopPropagation()} className="ml-2 cursor-help text-[12px] text-muted-foreground">回收站 {trashCounts.get(c.id)}</span></TooltipTrigger><TooltipContent>已删除的 {trashCounts.get(c.id)} 条订单，不计入当前单数与销售额；可在回收站恢复。</TooltipContent></Tooltip>}</span> },
          { id: 'owner', header: '归属销售', size: 140, sort: (c) => user(c.ownerId)?.name ?? '', cell: (c) => !manageChannels ? <Person user={user(c.ownerId)}/> : <div onClick={e=>e.stopPropagation()}><Select value={c.ownerId} disabled={!manageChannels || !can('order.assign')} onValueChange={async ownerId => { if (!manageChannels || !can('order.assign') || ownerId === c.ownerId) return; const preview = await act<{count:number;settled:number}>('channel.transferPreview',{id:c.id}); if(preview) setTransfer({channel:c,ownerId,...preview}) }}><SelectTrigger aria-label={`${c.name}的归属销售`} title="修改归属，同步该渠道所有订单" className="h-7 w-auto gap-1 border-transparent px-1 shadow-none hover:bg-accent [&>svg]:opacity-0 group-hover/tr:[&>svg]:opacity-60"><Person user={user(c.ownerId)} /></SelectTrigger><SelectContent>{salesPeople(s).map(u=><SelectItem key={u.id} value={u.id}><Person user={u} size={18}/></SelectItem>)}</SelectContent></Select></div> },
          ...(manageChannels || (hasSales && can('statement.view'))
            ? [{
                id: 'actions',
                header: '操作',
                size: 112,
                align: 'right' as const,
                cell: (c: Channel) => (
                  <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                    {hasSales && can('statement.view') && <Button size="sm" variant="outline" className="h-7 bg-card px-2 text-xs shadow-sm hover:border-primary/40 hover:bg-card hover:text-primary hover:shadow-md" onClick={() => setStatement(c)}>对账单</Button>}
                    {manageChannels && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" aria-label={`${c.name} 更多操作`}><DotsThree size={16} weight="bold" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end"><DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => { if (manageChannels) { setRemoving(c); setTargetId('') } }}><Trash size={13} />删除渠道</DropdownMenuItem></DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                ),
              }]
            : []),
        ]}
      />
      <TableFooter>{rows.length} 个渠道</TableFooter>
      <Dialog open={manageChannels && !!transfer} onOpenChange={open => { if (!open && !transferring) setTransfer(null) }}>
        <DialogContent className="max-w-md">
          <DialogTitle>更改归属销售</DialogTitle>
          <DialogDescription>将把 {transfer?.count} 单（其中 {transfer?.settled} 单已结算）的归属从 {user(transfer?.channel.ownerId ?? '')?.name} 改为 {user(transfer?.ownerId ?? '')?.name}，提成和自营判断随之变化。</DialogDescription>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={transferring} onClick={() => setTransfer(null)}>取消</Button><Button disabled={transferring} onClick={async () => {
            if (!manageChannels || !can('order.assign') || !transfer || transferring) return
            setTransferring(true)
            try { if (await updateChannel(transfer.channel.id, { ownerId: transfer.ownerId })) { toast.success('归属已同步'); setTransfer(null) } } finally { setTransferring(false) }
          }}>{transferring ? '同步中…' : '确认更改'}</Button></div>
        </DialogContent>
      </Dialog>
      {receiptChannel && <ChannelReceiptDialog channel={receiptChannel} orders={channelOrders.get(receiptChannel.id) ?? []} initialIds={receiptSelection[receiptChannel.id] ?? []} onClose={() => setReceiptChannel(null)} onDone={id => { setReceiptSelection(old => ({ ...old, [receiptChannel.id]: [] })); setReceiptChannel(null); setReceiptHistory({ receiptId: id }) }}/>}
      {receiptHistory && <ChannelReceiptHistory {...receiptHistory} onClose={() => setReceiptHistory(null)}/>}
      {exporting && <ChannelExport channel={exporting} onClose={()=>setExporting(null)}/>}
      <Dialog open={manageChannels && !!removing} onOpenChange={open => { if (!open && !deleting) setRemoving(null) }}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-md" onOpenAutoFocus={e => { e.preventDefault(); document.getElementById('cancel-channel-delete')?.focus() }}>
          <DialogTitle>删除渠道「{removing?.name}」</DialogTitle>
          <DialogDescription>{relatedCount ? `${relatedOrders.length} 条正常订单${trashedOrders.length ? ` · ${trashedOrders.length} 条在回收站` : ''}。转移后保留原收款和负责人。` : '无关联订单。如有收款记录，请选择接收渠道以保留记录。'}</DialogDescription>
          {relatedCount > 0 && <>
            <div className="scroll-thin max-h-36 overflow-y-auto rounded-md border text-xs">
              {[...relatedOrders.map(o => ({ ...o, inTrash: false })), ...trashedOrders.map(o => ({ ...o, inTrash: true }))].map(o => <div key={o.id} className="flex items-center gap-2 border-b px-3 py-2 last:border-0"><span className="min-w-0 flex-1 truncate" title={o.title}>{o.title}</span>{o.inTrash && <span className="shrink-0 text-muted-foreground">回收站</span>}</div>)}
            </div>
          </>}
            <label className="grid gap-1.5 text-sm">{relatedCount ? '订单和收款转到' : '接收渠道（有收款记录时必选）'}<Combobox value={targetId} onChange={setTargetId} placeholder="选择接收渠道" options={s.channels.filter(c => c.id !== removing?.id).map(c => ({ value: c.id, label: c.name, icon: <ChannelAvatar channel={c} size={18}/> }))} /></label>
          {targetId && <p className="text-sm">将「{removing?.name}」的全部订单转到「{s.channels.find(c => c.id === targetId)?.name}」，然后删除原渠道。</p>}
          <div className="flex justify-end gap-2"><Button id="cancel-channel-delete" variant="outline" disabled={deleting} onClick={() => setRemoving(null)}>取消</Button><Button variant="destructive" disabled={deleting || relatedCount > 0 && !targetId} onClick={async () => {
            if (!manageChannels || !removing || deleting) return
            setDeleting(true)
            try { const result = await deleteChannel(removing.id, targetId || undefined); if (result) { toast.success(result.moved ? `已合并 ${result.moved} 单，并删除「${removing.name}」` : `已删除「${removing.name}」`); setRemoving(null) } } finally { setDeleting(false) }
          }}>{deleting ? '处理中…' : targetId || relatedCount > 0 ? '合并并删除' : '删除空渠道'}</Button></div>
        </DialogContent>
      </Dialog>
      {statement && <StatementDialog channel={statement} onClose={() => setStatement(null)} />}
    </div>
  )
}
