import { businessDate, businessDateTime, money } from '@/shared/format'
import { WorkspaceHeading, pageAction } from '../WorkspaceHeading'
import { useNav } from '../nav'
import { Segmented } from '../controls'
import { DataTable, type Col } from '../table-kit'
import { plainKey } from '../shortcuts'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUUpLeft, CaretRight, ChatCircleDots, CheckCircle, DownloadSimple, Eye, ImageSquare, Plus, Prohibit } from '@phosphor-icons/react'
import { AmountCell, KIND_TEXT, KindIcon } from './RewardBits'
import { toast } from 'sonner'
import { REVIEW_CATEGORIES, REVIEW_KIND, reviewStatus, type QualityReview, type ReviewKind } from '@/shared/work-materials'
import { fuzzyMatch } from '@/shared/search'
import { parseMoneyInput } from '@/shared/money-input'
import { SettlementNote } from '../SettlementNote'
import { useSession } from '../store'
import { ChannelName, Person } from '../ui'
import { PersonChoice } from '../PersonChoice'
import { ImageViewer, Thumbs } from '../ImageViewer'
import { PageLoading } from '../PageLoading'
import { Tip } from '../Tip'
import { Frame, button, field, primary } from './Forms'
import { request, useWorkData } from './data'

const pickerLimit = 50
const iconButton = 'inline-flex h-9 w-9 items-center justify-center rounded-md border bg-card text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50'

/** 发起奖惩：先选惩罚还是奖励，再选写手和订单（可不关联）；金额不填就是只复盘不扣钱 */
function CreateReview({ close, saved }: { close: () => void; saved: (id: string) => void }) {
  const { s, channel } = useSession()
  const [id] = useState(() => crypto.randomUUID())
  const writers = useMemo(() => s.users.filter(u => u.active !== false && u.canWrite && !u.isAdmin), [s.users])
  const [kind, setKind] = useState<ReviewKind>('penalty')
  const [writerId, setWriter] = useState(writers[0]?.id ?? '')
  const [query, search] = useState(''), [orderId, chooseOrder] = useState(''), [noOrder, setNoOrder] = useState(false)
  const [category, setCategory] = useState(''), [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [issue, setIssue] = useState(''), [shots, setShots] = useState<string[]>([])
  const options = s.orders.filter(o => o.assignees.some(a => a.userId === writerId) && fuzzyMatch([o.no, o.title, channel(o.channelId)?.name, o.wechatGroup], query))
  const order = s.orders.find(o => o.id === orderId)
  const value = amount.trim() ? parseMoneyInput(amount) : null
  function pickWriter(next: string) { setWriter(next); chooseOrder(''); search('') }
  function pick(next: string) { chooseOrder(next); search('') }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!writerId) { toast.error('请选择写手'); return }
    if (!order && !noOrder) { toast.error('请选择订单，或勾选不关联订单'); return }
    if (amount.trim() && (!value || value <= 0)) { toast.error('金额不对'); return }
    if (!issue.trim() && !shots.length) { toast.error('请写说明或添加截图'); return }
    setBusy(true)
    try {
      await request('/api/reviews', 'POST', { id, kind, writerId, orderId: noOrder ? null : order!.id, category: category.trim(), amount: value, issue, images: shots })
      saved(id); close()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  return <Frame title="发起奖惩" close={() => !busy && close()}><form className="grid gap-3" onSubmit={submit}>
    <Segmented label="惩罚还是奖励" value={kind} onChange={next => { setKind(next); setCategory('') }}
      items={(['penalty', 'reward'] as const).map(k => [k, <span key={k} className="inline-flex items-center gap-1"><KindIcon kind={k} size={14}/>{REVIEW_KIND[k]}</span>] as const)}/>
    <div className="grid gap-1.5 text-sm"><span>写手</span>
      {writers.length ? <PersonChoice label="选择写手" people={writers} value={writerId} onChange={pickWriter}/> : <p className="text-muted-foreground">还没有可当写手的账号</p>}
    </div>
    {order ? <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-semibold" title={order.title}>{order.title}</span>
      <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => pick('')}>换一单</button>
    </div> : <div className="grid gap-1.5">
      <div className="flex items-center justify-between text-sm"><span>关联订单</span>
        <label className="inline-flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" checked={noOrder} onChange={e => setNoOrder(e.target.checked)}/>不关联</label>
      </div>
      {!noOrder && <>
        <input className={field} placeholder="搜索订单" value={query} onChange={e => search(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (options[0]) pick(options[0].id) } }}/>
        <div className="max-h-48 overflow-auto rounded-md border">
          {options.slice(0, pickerLimit).map(o => <button key={o.id} type="button" onClick={() => pick(o.id)} className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" title={o.title}>
            <b className="font-semibold">{o.title}</b><span className="ml-2 text-muted-foreground">{channel(o.channelId)?.name}</span></button>)}
          {!options.length && <p className="p-3 text-center text-sm text-muted-foreground">没有匹配的订单</p>}
          {options.length > pickerLimit && <p className="p-2 text-center text-xs text-muted-foreground">还有 {options.length - pickerLimit} 单</p>}
        </div>
      </>}
    </div>}
    <div className="grid gap-1.5 text-sm"><span>分类</span>
      <div className="flex flex-wrap gap-1.5">{REVIEW_CATEGORIES[kind].map(name => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(category === name ? '' : name)}
        className={cn('rounded-md border px-2 py-1', category === name ? 'border-primary bg-primary/10 text-primary' : 'border-transparent bg-muted/40 hover:bg-accent')}>{name}</button>)}</div>
      <input className={field} maxLength={20} placeholder="自定义分类" value={category} onChange={e => setCategory(e.target.value)}/>
    </div>
    <label className="grid gap-1.5 text-sm"><span>{kind === 'reward' ? '奖励金额' : '罚款金额'}<span className="ml-1 text-muted-foreground">可不填</span></span>
      <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">¥</span>
        <input className={cn(field, 'pl-7')} inputMode="decimal" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}/></div>
    </label>
    <SettlementNote note={issue} shots={shots} onNote={setIssue} onShots={setShots} onReading={setReading} disabled={busy} label="说明" placeholder="可粘贴截图" maxImages={5} maxLength={8000}/>
    <button className={primary + ' justify-self-end'} disabled={busy || reading}>{busy ? '正在发起…' : '发起'}</button>
  </form></Frame>
}

type Status = keyof typeof reviewStatus
function updatedAt(r: QualityReview) {
  return Math.max(...[r.createdAt, r.repliedAt, r.confirmedAt, ...r.history.map(msg => msg.at)].filter((v): v is string => !!v).map(Date.parse))
}
const firstLine = (text: string) => text.split('\n').map(line => line.trim()).find(Boolean) ?? ''
const picturesOf = (r: QualityReview) => (r.images ?? (r.image ? [r.image] : [])).map((src, index) => ({ src, thumb: src, name: '奖惩截图' + (index + 1) + '.webp' }))
const monthDay = (iso: string) => businessDateTime(iso).slice(5, 10)
const stateLabel = (r: QualityReview) => r.revokedAt ? '已撤销' : r.kind === 'reward' ? '已记录' : reviewStatus[r.status]

/** 状态只用图标：待回复橙、待确认主色、已完成灰、撤销划掉 */
function StateIcon({ r }: { r: QualityReview }) {
  const label = r.revokedAt ? '已撤销' + (r.revokeReason ? '：' + r.revokeReason : '') : r.kind === 'reward' ? '已记录' : { pending: '待写手回复', waiting: '写手已回复，待你确认', done: '已完成' }[r.status]
  const icon = r.revokedAt ? <Prohibit size={17}/> : r.kind === 'penalty' && r.status === 'pending' ? <ChatCircleDots size={17}/> : r.kind === 'penalty' && r.status === 'waiting' ? <Eye size={17}/> : <CheckCircle size={17}/>
  const tone = r.revokedAt ? 'text-muted-foreground' : r.kind === 'penalty' && r.status === 'pending' ? 'text-warn' : r.kind === 'penalty' && r.status === 'waiting' ? 'text-primary' : 'text-muted-foreground'
  return <Tip label={label}><span role="img" aria-label={stateLabel(r)} className={cn('inline-flex', tone)}>{icon}</span></Tip>
}

/** 截图多是聊天长图，裁成小方块只剩白边：表格里只写张数，点开直接看大图，左右键翻页 */
function ShotsCell({ pics }: { pics: ReturnType<typeof picturesOf> }) {
  const [index, setIndex] = useState<number | null>(null)
  if (!pics.length) return <span className="text-muted-foreground">—</span>
  return <span onClick={e => e.stopPropagation()}>
    <Tip label={`${pics.length} 张截图`}><button type="button" onClick={() => setIndex(0)} className="inline-flex items-center gap-1 text-primary" aria-label={`查看 ${pics.length} 张截图`}><ImageSquare size={16}/><span className="num text-xs">{pics.length}</span></button></Tip>
    <ImageViewer pics={pics} index={index} onIndex={setIndex}/>
  </span>
}
/** 展开后截图按原比例完整显示，不裁剪，聊天内容一眼能看到 */
const SHOT_BIG = 'h-48 w-auto max-w-[240px] object-contain bg-muted/30'
const SHOT_SMALL = 'h-28 w-auto max-w-[180px] object-contain bg-muted/30'

/** 展开后的内容：完整说明、大图、回复记录和操作，按时间一条条往下排；回复一行一条，头像姓名在前 */
function Detail({ r, reload }: { r: QualityReview; reload: () => void }) {
  const { me, role, user } = useSession()
  const [reply, setReply] = useState(''), [busy, setBusy] = useState(false)
  const [note, setNote] = useState(''), [revoking, setRevoking] = useState(false), [reason, setReason] = useState('')
  const [shots, setShots] = useState<string[]>([]), [reading, setReading] = useState(false)
  async function change(action: 'confirm' | 'reply' | 'supplement' | 'revoke', revoke = false) {
    if (action === 'revoke' && !reason.trim()) { toast.error('请写撤销原因'); return }
    setBusy(true)
    try {
      await request('/api/reviews/' + r.id, 'POST', action === 'revoke' ? { action, note: reason } : action === 'confirm' ? { action, revoke, version: r.history.length } : { action, reply, note, images: shots, version: r.history.length })
      setReply(''); setNote(''); setReason(''); setShots([]); setRevoking(false); reload(); window.dispatchEvent(new Event('bxsh:review-updated'))
    } catch (e) { toast.error((e as Error).message); reload() } finally { setBusy(false) }
  }
  const entries = [
    { key: 'start', label: REVIEW_KIND[r.kind] + (r.category ? ' · ' + r.category : ''), who: null, at: r.createdAt, text: r.issue, pics: picturesOf(r), tone: KIND_TEXT[r.kind], big: true },
    ...r.history.map((msg, i) => ({ key: String(i), label: '', who: user(msg.actorId) ?? { id: msg.actorId, name: msg.actorName, hue: 160 }, at: msg.at, text: msg.text,
      pics: (msg.images ?? []).map((hash, n) => { const src = '/api/reviews/' + r.id + '/image?v=' + hash; return { src, thumb: src, name: '奖惩回复' + (n + 1) + '.webp' } }), tone: '', big: false })),
  ]
  const fined = r.kind === 'penalty' && !!r.amount && !r.revokedAt
  const waiting = role.locked && r.status === 'waiting' && !r.revokedAt
  return <div className="flex min-w-0 flex-col gap-2 px-3 py-2 text-sm">
    <ol className="min-w-0 space-y-1">
      {entries.map(e => <li key={e.key} className="min-w-0">
        {e.who ? <div className="flex items-start gap-2 leading-5">
          <span className="max-w-[35%] shrink-0"><Person user={e.who} size={20}/></span>
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{e.text}</p>
          <time className="num shrink-0 whitespace-nowrap text-[11px] text-muted-foreground" dateTime={e.at} title={businessDateTime(e.at)}>{businessDateTime(e.at).slice(5)}</time>
        </div> : <>
          <div className="mb-0.5 flex flex-wrap items-center gap-x-2"><span className={'font-medium ' + e.tone}>{e.label}</span><time className="num text-xs text-muted-foreground" dateTime={e.at}>{businessDateTime(e.at)}</time></div>
          {e.text && <p className="whitespace-pre-wrap break-words leading-5">{e.text}</p>}
        </>}
        {!!e.pics.length && <Thumbs className="mt-1.5" imgClass={e.big ? SHOT_BIG : SHOT_SMALL} pics={e.pics}/>}
      </li>)}
      {r.revokedAt && <li className="py-1 text-muted-foreground">已撤销 <time className="num text-xs" dateTime={r.revokedAt}>{businessDateTime(r.revokedAt)}</time>{r.revokeReason && <span className="ml-2 text-foreground">{r.revokeReason}</span>}</li>}
      {!r.revokedAt && r.kind === 'penalty' && r.status === 'done' && r.confirmedAt && <li className="py-1 text-muted-foreground">已确认完成 <time className="num text-xs" dateTime={r.confirmedAt}>{businessDateTime(r.confirmedAt)}</time></li>}
      {r.writerId === me.id && r.status === 'pending' && !r.revokedAt && <li className="py-2"><form className="grid gap-2" onSubmit={e => { e.preventDefault(); void change('reply') }}>
        <SettlementNote note={reply} shots={shots} onNote={setReply} onShots={setShots} onReading={setReading} disabled={busy} compact label="回复" placeholder="回复…" maxImages={5} maxLength={8000}/>
        <button className={primary + ' justify-self-end'} disabled={busy || reading || (!reply.trim() && !shots.length)}>回复</button>
      </form></li>}
      {revoking && <li className="py-2"><form className="flex items-end gap-1.5" onSubmit={e => { e.preventDefault(); void change('revoke') }}>
        <input autoFocus className={cn(field, 'min-w-0 flex-1')} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="撤销原因…"/>
        <button type="button" className={button} disabled={busy} onClick={() => setRevoking(false)}>取消</button><button className={primary} disabled={busy}>撤销</button>
      </form></li>}
    </ol>
    {role.locked && !revoking && (waiting || (!r.revokedAt && !r.settledAt)) && <div className="flex flex-wrap items-end justify-end gap-1.5">
      {waiting && <>
        <form className="flex min-w-0 basis-full items-end gap-1.5 sm:basis-auto sm:flex-1" onSubmit={e => { e.preventDefault(); void change('supplement') }}>
          <div className="min-w-0 flex-1"><SettlementNote compact note={note} shots={shots} onNote={setNote} onShots={setShots} onReading={setReading} disabled={busy} label="补充要求" placeholder="输入补充要求…" maxImages={5} maxLength={8000}/></div>
          <button className={button} disabled={busy || reading || (!note.trim() && !shots.length)}>发送</button>
        </form>
        {fined && <button className={button} disabled={busy} onClick={() => void change('confirm', true)}>撤销罚款</button>}
        <button className={primary} disabled={busy} onClick={() => void change('confirm')}>{fined ? '维持罚款' : '确认完成'}</button>
      </>}
      {!r.revokedAt && !r.settledAt && <Tip label="撤销"><button className={iconButton} aria-label="撤销" disabled={busy} onClick={() => setRevoking(true)}><ArrowUUpLeft size={17}/></button></Tip>}
    </div>}
  </div>
}

/** 导出当前筛选结果为 CSV（带 BOM，Excel 直接打开不乱码） */
function exportReviews(list: QualityReview[], groupOf: (r: QualityReview) => string, channelOf: (r: QualityReview) => string) {
  const head = ['类型', '状态', '金额', '分类', '结算', '订单', '单号', '群名', '渠道', '销售', '写手', '说明', '截图张数', '回复数', '发起时间', '最后更新']
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  const lines = [head, ...list.map(r => [REVIEW_KIND[r.kind], stateLabel(r), r.amount ? (r.kind === 'reward' ? '' : '-') + r.amount : '', r.category, r.settledAt ? '已结清' : r.amount && !r.revokedAt ? '未结' : '', r.orderTitle ?? '', r.orderNo ?? '', groupOf(r), channelOf(r), r.ownerName ?? '', r.writerName, r.issue, picturesOf(r).length, r.history.length, businessDateTime(r.createdAt), businessDateTime(new Date(updatedAt(r)))])]
  const blob = new Blob(['﻿' + lines.map(row => row.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `奖惩-${businessDate(new Date())}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** 进行中 = 待确认 + 待回复；已完成默认不显示，点「已完成」才看 */
type Filter = 'open' | Status | 'reward' | 'all'
const isOpen = (r: QualityReview) => r.status !== 'done' && !r.revokedAt
export function Reviews() {
  const { me, role, s, views, can, user, channel } = useSession()
  const { openOrder } = useNav()
  const { data, error, reload } = useWorkData<QualityReview[]>('/api/reviews', me.id, s.version)
  const [creating, create] = useState(false)
  const priority = (role.locked ? ['waiting', 'pending', 'done'] : ['pending', 'waiting', 'done']) as Status[]
  const [filter, setFilter] = useState<Filter>('open')
  const orderOf = useMemo(() => new Map(can('order.view') ? views.map(v => [v.id, v]) : []), [views, can])
  const groupOf = (r: QualityReview) => (r.orderId && orderOf.get(r.orderId)?.wechatGroup) || ''
  const channelOf = (r: QualityReview) => { const o = r.orderId ? orderOf.get(r.orderId) : undefined; return (o && channel(o.channelId)?.name) ?? '' }
  // 搜索和「筛选」交给系统表格的工具栏；这里只按上面的状态切换先分一层
  const matched = data ?? []
  const match = (r: QualityReview, f: Filter) => f === 'all' || (f === 'open' ? isOpen(r) : f === 'reward' ? r.kind === 'reward' : r.kind === 'penalty' && r.status === f)
  const count = (f: Filter) => matched.filter(r => match(r, f)).length
  const rows = matched.filter(r => match(r, filter))
    .sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status) || updatedAt(b) - updatedAt(a))
  // 进页面先展开第一条要自己处理的：老板是待确认，写手是待回复；之后由用户点开收起
  const mine: Status = role.locked ? 'waiting' : 'pending'
  const [opened, setOpened] = useState<string | null | undefined>(undefined)
  const openId = opened === undefined ? rows.find(r => r.status === mine && !r.revokedAt)?.id ?? null : opened
  const [sel, setSel] = useState<string | null>(null)
  const toggle = (id: string) => { setSel(id); setOpened(openId === id ? null : id) }
  const rowsRef = useRef(rows); rowsRef.current = rows
  const stateRef = useRef({ sel, openId }); stateRef.current = { sel, openId }
  useEffect(() => {
    // J/K 上下选行，回车或空格展开、收起
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e)) return
      const list = rowsRef.current, { sel, openId } = stateRef.current
      const i = list.findIndex(r => r.id === (sel ?? openId))
      const k = e.key.toLowerCase()
      if (k === 'j' || k === 'k') {
        if (!list.length) return
        e.preventDefault()
        const next = list[i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + (k === 'j' ? 1 : -1)))]
        setSel(next.id)
        document.querySelector(`[data-review-row="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })
      } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0 && !(e.target as HTMLElement)?.closest?.('button, a')) {
        e.preventDefault()
        const id = list[i].id
        setSel(id); setOpened(openId === id ? null : id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cols: Col<QualityReview>[] = [
    { id: 'kind', header: '类型', size: 64, minSize: 56, hideable: false, filterValue: r => REVIEW_KIND[r.kind], filterOptions: 'all', cell: r => <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <CaretRight size={11} weight="bold" className={cn('shrink-0 text-muted-foreground transition-transform', openId === r.id && 'rotate-90')}/>
      <Tip label={REVIEW_KIND[r.kind]}><span role="img" aria-label={REVIEW_KIND[r.kind]} className={cn('inline-flex', r.revokedAt ? 'text-muted-foreground' : KIND_TEXT[r.kind])}><KindIcon kind={r.kind}/></span></Tip></span> },
    { id: 'status', header: '状态', size: 56, minSize: 52, filterValue: stateLabel, filterOptions: 'all', cell: r => <StateIcon r={r}/> },
    { id: 'writer', header: '写手', size: 104, minSize: 72, filterValue: r => r.writerName, filterOptions: 'all', cell: r => <Person user={user(r.writerId) ?? { id: r.writerId, name: r.writerName, hue: 150 }} size={18}/> },
    { id: 'amount', header: '金额', size: 88, minSize: 72, align: 'right', sort: r => r.amount ?? 0, filterType: 'number', filterValue: r => r.amount, cell: r => <AmountCell r={r}/> },
    { id: 'category', header: '分类', size: 100, minSize: 64, filterValue: r => r.category, filterOptions: 'all', cell: r => r.category ? <span className="block truncate" title={r.category}>{r.category}</span> : <span className="text-muted-foreground">—</span> },
    { id: 'issue', header: '说明', size: 220, minSize: 120, grow: true, filterValue: r => r.issue, cell: r => firstLine(r.issue) ? <span className="block truncate" title={r.issue}>{firstLine(r.issue)}</span> : <ImageSquare size={15} className="text-muted-foreground" aria-label="只有截图"/> },
    { id: 'order', header: '订单', size: 170, minSize: 100, grow: true, filterValue: r => `${r.orderTitle ?? ''} ${r.orderNo ?? ''}`, cell: r => !r.orderId ? <span className="text-muted-foreground">—</span> : orderOf.has(r.orderId)
      ? <a className="block truncate font-medium hover:underline" title={r.orderTitle ?? ''} href={'/?o=' + encodeURIComponent(r.orderNo ?? '')} onClick={e => { e.stopPropagation(); if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); openOrder(r.orderId!) } }}>{r.orderTitle}</a>
      : <span className="block truncate font-medium" title={r.orderTitle ?? ''}>{r.orderTitle}</span> },
    { id: 'group', header: '群名', size: 170, minSize: 100, grow: true, filterValue: groupOf, cell: r => { const g = groupOf(r); return g ? <span className="block truncate" title={g}>{g}</span> : <span className="text-muted-foreground">—</span> } },
    { id: 'channel', header: '渠道', size: 120, minSize: 80, filterValue: channelOf, filterOptions: 'all', cell: r => { const o = r.orderId ? orderOf.get(r.orderId) : undefined, ch = o && channel(o.channelId); return ch ? <ChannelName channel={ch} size={16}/> : <span className="text-muted-foreground">—</span> } },
    { id: 'owner', header: '销售', size: 72, minSize: 56, filterValue: r => r.ownerName ?? '', filterOptions: 'all', cell: r => <span className="block truncate">{r.ownerName ?? '—'}</span> },
    { id: 'shots', header: '截图', size: 64, minSize: 56, cell: r => <ShotsCell pics={picturesOf(r)}/> },
    { id: 'replies', header: '回复', size: 60, minSize: 52, sort: r => r.history.length, filterType: 'number', cell: r => <span className="num text-muted-foreground">{r.history.length || '—'}</span> },
    { id: 'created', header: '发起', size: 72, minSize: 64, sort: r => r.createdAt, filterValue: r => businessDate(r.createdAt), filterType: 'date', cell: r => <time className="num whitespace-nowrap text-muted-foreground" dateTime={r.createdAt} title={businessDateTime(r.createdAt)}>{monthDay(r.createdAt)}</time> },
  ]
  const tabs: [Filter, string][] = [['open', '进行中'], ...priority.map(k => [k, reviewStatus[k]] as [Filter, string]), ['reward', '奖励'], ['all', '全部']]
  return <section className="mx-auto w-full max-w-[1600px] space-y-3"><WorkspaceHeading title="奖惩">{role.locked && <button className={pageAction} onClick={() => create(true)}><Plus/>发起奖惩</button>}</WorkspaceHeading>
    {!data ? <PageLoading page="reviews" error={!!error} onRetry={reload}/> : <div className="overflow-hidden rounded-xl border bg-card">
      <DataTable id="reviews" freeze={0} maxHeight="calc(100vh - 230px)" rows={rows} rowId={r => r.id} cols={cols}
        searchPlaceholder="订单、写手、分类、说明" preferredFilterFields={['kind', 'status', 'writer', 'category', 'channel', 'created']}
        toolbarExtras={<Segmented label="奖惩状态" size="sm" value={filter} onChange={setFilter} items={tabs.map(([k, label]) => [k, <>{label}<span className="num ml-1 text-muted-foreground">{count(k)}</span></>] as const)}/>}
        toolbarActions={table => can('order.export') && <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => exportReviews(table.getRowModel().rows.map(row => row.original), groupOf, channelOf)}>
          <DownloadSimple size={15}/><span className="hidden sm:inline">导出</span></Button>}
        onRowClick={r => toggle(r.id)}
        rowAttrs={r => ({ 'data-review-row': r.id, 'data-selected': sel === r.id })}
        rowClassName={r => cn(sel === r.id && '[&>td]:bg-accent', openId === r.id && '[&>td]:bg-muted/40')}
        expandedRow={r => openId === r.id ? <Detail key={r.id} r={r} reload={reload}/> : null}
        empty={<p className="p-10 text-center text-muted-foreground">{filter !== 'open' ? '当前筛选下没有记录' : '没有进行中的奖惩'}</p>}/>
    </div>}
    {creating && <CreateReview close={() => create(false)} saved={id => { setFilter('all'); setOpened(id); setSel(id); reload() }}/>}
  </section>
}
