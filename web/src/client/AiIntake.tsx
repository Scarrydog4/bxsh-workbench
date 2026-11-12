import { SelectField } from './SelectField'
import { allocationPolicyForDate, fixedAllocation, isFixedAllocation } from '@/shared/allocation'
import { FinancialNote } from './FinancialNote'
import { IntakePayment, validPaidAmount, type IntakePaymentTag } from './IntakePayment'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Sparkle, Images, ArrowRight, X, CheckCircle, CaretDown, Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { confirmInput, type OrderDraft, type ConfirmBatch, type CreatedOrder } from '@/shared/assistant'
import type { SalesMode } from '@/shared/types'
import { iso, today } from '@/shared/format'
import { PersonChoice } from './PersonChoice'
import { ChannelAvatar, Combobox, inputCls } from './ui'
import { DatePicker } from './DatePicker'
import { useSession, refresh, uploadFiles, salesPeople, addPayment, deleteOrders } from './store'
import { useNav } from './nav'
import { thumb } from './files'
import { markFresh } from './fresh'

export class RequestError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}
export async function aiRequest<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api/assistant/' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new RequestError(data.error ?? '网络暂时不可用，请重试', r.status)
  return data
}

type Row = OrderDraft & { key: string; ownerId: string; newChannel: boolean; deposit: number | null; paidAmount: string; paymentNote: string; paymentProof?: string; paymentTag: IntakePaymentTag; open: boolean }
type Shot = { file: File; url: string }
type Missing = { row: number; field: string; label: string }

/** 模型提示里偶尔夹带字段名，换成人话。 */
const WORDS: [RegExp, string][] = [
  [/basePrice/g, '应收金额'], [/costPriceEvidence/g, '底价依据'], [/costPrice/g, '交老板底价'], [/writerPay/g, '写手工资'], [/dueDate/g, '截止日期'], [/orderDate/g, '下单日期'],
  [/channelName/g, '渠道'], [/writerName/g, '写手'], [/channelNo/g, '渠道单号'], [/\bnull\b/gi, '空'],
]
const human = (w: string) => WORDS.reduce((t, [re, r]) => t.replace(re, r), w)

/** 原文提到定金、已付时，建议顺手记一笔收款。 */
function findDeposit(text: string) {
  const m = text.match(/(?:定金|订金|预付|首付|已付|已收)[^\d]{0,4}(\d{2,6}(?:\.\d{1,2})?)/) ?? text.match(/(\d{2,6}(?:\.\d{1,2})?)\s*(?:元|块)?\s*(?:定金|订金)(?:已付|已收)?/)
  return m ? Number(m[1]) : null
}

function missingOf(rows: Row[], canAssign: boolean, canReceive: boolean, requireNote: boolean): Missing[] {
  const out: Missing[] = []
  rows.forEach((r, i) => {
    if (canReceive && !validPaidAmount(r.paidAmount)) out.push({ row: i, field: 'paid', label: '已付金额' })
    if (canReceive && requireNote && Number(r.paidAmount) > 0 && !r.paymentNote.trim() && !r.paymentProof) out.push({ row: i, field: 'paid', label: '收款备注' })
    if (!r.title.trim()) out.push({ row: i, field: 'title', label: '名称' })
    if (r.salesMode !== 'cost' && !r.channelId && !(r.newChannel && r.channelName.trim())) out.push({ row: i, field: 'channel', label: '渠道' })
    if (r.basePrice === null || !Number.isFinite(r.basePrice) || r.basePrice < 0) out.push({ row: i, field: 'price', label: r.salesMode === 'cost' ? '交老板底价' : '客户总价' })
    if (!r.orderDate) out.push({ row: i, field: 'orderDate', label: '下单日期' })
    if (canAssign && r.writerName && !r.writerId) out.push({ row: i, field: 'writer', label: '写手' })
  })
  return out
}

/** 边框流光：识别中转得快，等确认时慢慢呼吸，确认后收起。 */
export function AiGlow({ state, className, children }: { state: 'idle' | 'thinking' | 'review' | 'done'; className?: string; children: React.ReactNode }) {
  return (
    <div data-glow={state} className={cn('ai-glow', className)}>
      {children}
    </div>
  )
}

export function IntakeFlow({ initialText = '', initialFiles, autoStart = false, onClose, onPendingChange }: { initialText?: string; initialFiles?: File[]; autoStart?: boolean; onClose?: () => void; onPendingChange?: (pending: boolean) => void }) {
  const { s, me, can, role } = useSession()
  const { openOrder, go, cards } = useNav()
  const canAssign = can('order.assign')
  // 销售能选写手，工资只有管理员填
  const canPick = can('order.edit')
  const allocationPolicy = allocationPolicyForDate(iso(today()))
  const isFixed = (row: Row) => isFixedAllocation({ allocationPolicy, salesMode: row.salesMode })
  const writerPay = (row: Row) => isFixed(row) ? row.basePrice === null ? null : fixedAllocation(row.basePrice).writer : row.writerPay
  const [text, setText] = useState(initialText)
  const [shots, setShots] = useState<Shot[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedOrder[]>([]), [done, setDone] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [tried, setTried] = useState(false)
  const [readingPayment, setReadingPayment] = useState(false)
  const lock = useRef(false), input = useRef<HTMLInputElement>(null), tableRef = useRef<HTMLDivElement>(null)
  const batch = useRef<ConfirmBatch | null>(null)
  const saved = useRef<CreatedOrder[]>([])
  const remaining = useRef<{ orderId: string; file: File }[] | null>(null)
  const deposits = useRef<{ orderId: string; payment: Parameters<typeof addPayment>[1] }[] | null>(null)
  useEffect(() => { onPendingChange?.(!!busy || (frozen && !done)) }, [busy, frozen, done, onPendingChange])
  const thinking = !!busy && !rows.length && !done

  useEffect(() => {
    const stop = (e: BeforeUnloadEvent) => {
      if (((rows.length || text.trim() || shots.length) && !done) || busy) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', stop)
    return () => window.removeEventListener('beforeunload', stop)
  }, [rows.length, text, shots.length, done, busy])

  async function work(label: string, fn: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理失败，请重试')
    } finally {
      lock.current = false
      setBusy('')
    }
  }
  async function readShots(files: File[]) {
    const images = files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type))
    if (!images.length) throw new Error('请选择 PNG、JPG 或 WebP 图片')
    if (shots.length + images.length > 6) throw new Error('一次最多 6 张截图，请分批识别')
    const added: Shot[] = []
    for (const file of images) {
      const url = await thumb(file, 2400)
      if (!url || url.length > 6_000_000) throw new Error('截图过大或无法读取，请换一张')
      added.push({ file, url })
    }
    return added
  }
  async function addImages(files: File[]) {
    if (lock.current || rows.length || frozen) return
    await work('正在读取截图…', async () => {
      const added = await readShots(files)
      setShots((old) => [...old, ...added])
    })
  }
  function edit(index: number, patch: Partial<Row>) {
    setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }
  function changeMode(index: number, salesMode: SalesMode) {
    setRows(all => all.map((row, i) => i !== index || (row.salesMode ?? 'commission') === salesMode ? row : {
      ...row, salesMode, basePrice: null, paidAmount: '', paymentNote: '', paymentProof: undefined, deposit: null,
      warnings: [...row.warnings.filter(warning => !/^(交老板底价未明确，请填写|请填写交老板底价|请填写客户总价)$/.test(warning)), salesMode === 'cost' ? '请填写交老板底价' : '请填写客户总价'],
    }))
  }
  async function recognize(src = text, pics = shots) {
    if (!src.trim() && !pics.length) return
    await work('识别中', async () => {
      const result = await aiRequest<{ orders: OrderDraft[]; message: string }>('parse', { text: src, images: pics.map((x) => x.url) })
      setRows(
        result.orders.map((r, i) => {
          const ownerId = canAssign ? (s.channels.find((ch) => ch.id === r.channelId)?.ownerId ?? me.id) : me.id
          const salesMode = r.salesMode ?? s.users.find(user => user.id === ownerId)?.salesMode ?? 'commission'
          const deposit = salesMode === 'cost' ? null : findDeposit(`${r.note} ${r.warnings.join(' ')}`)
          return { ...r, salesMode, basePrice: !r.salesMode && salesMode === 'cost' ? null : r.basePrice, warnings: r.warnings.map(human), key: `${Date.now()}-${i}`, newChannel: false, ownerId, deposit, paidAmount: '', paymentNote: '', paymentTag: '定金', open: false }
        }),
      )
      setTried(false)
      setMessage(result.orders.length ? '' : result.message || '没有识别到订单，补上名称、渠道和价格再试。')
    })
  }
  // 从全局粘贴打开时直接开始识别
  useEffect(() => {
    if (!autoStart) return
    void (async () => {
      let pics: Shot[] = []
      if (initialFiles?.length) {
        try {
          pics = await readShots(initialFiles)
          setShots(pics)
        } catch (e) {
          setError(e instanceof Error ? e.message : '截图读取失败')
          return
        }
      }
      await recognize(initialText, pics)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pointTo(m: Missing) {
    if (['writer', 'orderDate'].includes(m.field) && !rows[m.row].open) flushSync(() => edit(m.row, { open: true }))
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${m.row}-${m.field}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('cell-shake')
    void el.offsetWidth
    el.classList.add('cell-shake')
    el.querySelector<HTMLElement>('input,button')?.focus({ preventScroll: true })
  }

  /** 确认后每行飞向左侧「订单」，图标跳一下。 */
  async function flyAway() {
    const target = document.querySelector<HTMLElement>('[data-nav="orders"]')
    const els = Array.from(tableRef.current?.querySelectorAll<HTMLElement>('[data-draft-row]') ?? [])
    if (!target || !els.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const to = target.getBoundingClientRect()
    const runs = els.map((el, i) => {
      const r = el.getBoundingClientRect()
      const dx = to.left + to.width / 2 - (r.left + r.width / 2)
      const dy = to.top + to.height / 2 - (r.top + r.height / 2)
      return el.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${dx * 0.15}px, ${dy * 0.15}px) scale(.96)`, opacity: 1, offset: 0.25 },
          { transform: `translate(${dx}px, ${dy}px) scale(.08)`, opacity: 0 },
        ],
        { duration: 560, delay: i * 70, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' },
      ).finished
    })
    await Promise.all(runs).catch(() => {})
    target.classList.remove('nav-bump')
    void target.offsetWidth
    target.classList.add('nav-bump')
  }

  async function confirm() {
    if (readingPayment) return
    const miss = missingOf(rows, canPick, can('payment.create'), !role.locked)
    setTried(true)
    if (miss.length && !batch.current) {
      pointTo(miss[0])
      return
    }
    await work(saved.current.length ? '正在补存…' : '正在入库…', async () => {
      if (!batch.current) {
        const parsed = confirmInput.safeParse({
          batchId: crypto.randomUUID(),
          orders: rows.map((r) => ({
            title: r.title, channelId: r.channelId, newChannelName: r.newChannel ? r.channelName : '', ownerId: r.ownerId,
            type: r.type, salesMode: r.salesMode ?? 'commission', basePrice: r.basePrice, orderDate: r.orderDate, dueDate: r.dueDate, channelNo: r.channelNo, note: r.note,
            assignees: canPick && r.writerId ? [{ userId: r.writerId, pay: canAssign ? writerPay(r) : null }] : [],
          })),
        })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '请补齐必填字段')
        batch.current = parsed.data
        setFrozen(true)
      }
      if (!saved.current.length) {
        try {
          saved.current = (await aiRequest<{ orders: CreatedOrder[] }>('confirm', batch.current)).orders
        } catch (e) {
          // 服务端明确拒绝时可改表重交；网络结果不明时保留批次号，防止重复录单。
          if (e instanceof RequestError && (e.status === 400 || e.status === 403)) {
            batch.current = null
            setFrozen(false)
            await refresh()
          }
          throw e
        }
        setCreated(saved.current)
        markFresh(saved.current.map((o) => o.id))
        await refresh()
      }
      deposits.current ??= rows.flatMap((r, i) => can('payment.create') && Number(r.paidAmount) > 0 && saved.current[i] ? [{ orderId: saved.current[i].id, payment: { amount: Number(r.paidAmount), date: iso(today()), tag: r.paymentTag, note: r.paymentNote.trim(), proof: r.paymentProof } }] : [])
      while (deposits.current.length) {
        const current = deposits.current[0]
        if (!(await addPayment(current.orderId, current.payment))) throw new Error('订单已保存，收款还没保存成功。点「继续保存」重试。')
        deposits.current.shift()
      }
      remaining.current ??= rows.flatMap((r, i) => r.imageIndexes.map((index) => ({ orderId: saved.current[i].id, file: shots[index].file })))
      while (remaining.current.length) {
        const current = remaining.current[0]
        if (!(await uploadFiles([current.file], { orderId: current.orderId }))) throw new Error('订单已保存，部分截图还没传上。点「继续保存」，不会重复录单。')
        remaining.current.shift()
      }
      await flyAway()
      const ids = saved.current.map((o) => o.id)
      // 保存后顺手给订单卡，点不点都行
      toast.success(`已录入 ${ids.length} 单`, {
        duration: 8000,
        action: { label: '订单卡', onClick: () => cards(ids) },
        cancel: { label: '撤销', onClick: () => void deleteOrders(ids, { reason: '撤销刚录入的订单' }).then((ok) => ok && toast('已撤销，订单在回收站里')) },
      })
      // 弹窗里录的单，确认后直接关掉回到订单；助手页保留结果方便接着录
      setDone(true)
      onClose?.()
    })
  }
  function reset() {
    setRows([]); setShots([]); setText(''); setCreated([]); setDone(false); setFrozen(false); setMessage(''); setError(''); setTried(false)
    batch.current = null; saved.current = []; remaining.current = null; deposits.current = null
  }

  const miss = missingOf(rows, canPick, can('payment.create'), !role.locked)
  const bad = (row: number, field: string) => tried && miss.some((m) => m.row === row && m.field === field)
  const locked = !!busy || frozen || readingPayment
  const channelOptions = s.channels.filter((ch) => ch.active).map((ch) => ({ value: ch.id, label: ch.name, icon: <ChannelAvatar channel={ch} size={18} /> }))
  const writers = s.users.filter((u) => u.canWrite && u.active !== false)
  const cell = 'h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-colors hover:bg-accent focus:border-ring focus:bg-card'

  if (done)
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 font-medium text-ok">
          <CheckCircle size={22} weight="fill" />
          已录入 {created.length} 单
        </div>
        <div className="grid gap-1">
          {created.map((o, i) => (
            <button key={o.id} onClick={() => { onClose?.(); openOrder(o.id) }} className="group flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-accent">
              <span className="min-w-0 flex-1 truncate">{rows[i]?.title}</span>
              <ArrowRight size={14} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={reset}>继续录下一批</Button>
          {onClose ? <Button variant="ghost" onClick={onClose}>关闭</Button> : <Button variant="ghost" onClick={() => go('orders')}>去订单</Button>}
        </div>
      </motion.div>
    )

  return (
    <div
      className="grid gap-4"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files)
        if (files.length && !rows.length) {
          e.preventDefault()
          e.stopPropagation()
          void addImages(files)
        }
      }}
    >
      {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {!rows.length && (
        <AiGlow state={thinking ? 'thinking' : 'idle'}>
          <div className="grid gap-3 rounded-[13px] bg-card p-4" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addImages(Array.from(e.dataTransfer.files)) }}>
            <textarea
              id="ai-source"
              aria-label="渠道消息"
              aria-describedby="ai-source-hint"
              value={text}
              disabled={!!busy}
              autoFocus={!autoStart}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void recognize() } }}
              maxLength={16000}
              rows={6}
              className="w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground/70"
              placeholder={me.salesMode === 'cost' ? '粘贴订单消息或截图，一次可以多单。\n例如：开题报告，交老板底价 500，10 月 12 日交。' : '把渠道发来的消息或截图粘贴到这里，一次可以多单。\n例如：启明老师，两单：开题报告客户总价 500，10 月 12 日交；答辩 PPT 客户总价 300，10 月 15 日交。'}
            />
            <div id="ai-source-hint" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <CheckCircle size={13} className="text-primary" />
              <span>先生成草稿，核对确认后才入库</span>
              {text && <span className="num ml-auto">{text.length.toLocaleString()} / 16,000</span>}
            </div>
            {shots.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {shots.map((shot, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.url} alt={`截图 ${i + 1}`} className="h-16 w-16 rounded-lg border object-cover" />
                    <button disabled={!!busy} onClick={() => setShots(shots.filter((_, n) => n !== i))} aria-label={`移除截图 ${i + 1}`} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border bg-background text-muted-foreground hover:text-foreground">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => input.current?.click()} className="text-muted-foreground">
                <Images size={16} />
                截图
              </Button>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">{message}</span>
              <Button className="ml-auto gap-1.5" disabled={!!busy || (!text.trim() && !shots.length)} onClick={() => void recognize()}>
                <Sparkle size={15} weight="fill" className={cn(thinking && 'animate-spin [animation-duration:2s]')} />
                {thinking ? '识别中…' : busy || '识别'}
                {!busy && <span className="kbd border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground/80">⌘↵</span>}
              </Button>
            </div>
          </div>
        </AiGlow>
      )}

      <AnimatePresence>
        {rows.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}>
            <AiGlow state={busy && frozen ? 'thinking' : 'review'}>
              <div ref={tableRef} className="rounded-[13px] bg-card">
                <div className="flex items-center gap-2 border-b px-4 py-3">
                  <Sparkle size={15} weight="fill" className="text-primary" />
                  <span className="text-sm font-medium">AI 草稿 · {rows.length} 单</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{created.length ? '订单已保存' : '未入库'}</span>
                  <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" disabled={locked} onClick={() => { setRows([]); setTried(false) }}>
                    丢弃
                  </Button>
                </div>
                <fieldset disabled={locked} className="min-w-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="w-8 py-2 pl-4 font-normal">#</th>
                          <th className="py-2 pl-2 font-normal">订单名称</th>
                          <th className="w-40 py-2 pl-2 font-normal">渠道</th>
                          <th className="w-28 py-2 pl-2 font-normal">类型</th>
                          <th className="w-28 py-2 pl-2 font-normal">结算方式</th>
                          <th className="w-28 py-2 pr-2 text-right font-normal">应收金额</th>
                          <th className="w-28 py-2 pl-2 font-normal">截止</th>
                          <th className="w-16 py-2 pr-3 font-normal" />
                        </tr>
                      </thead>
                      {rows.map((r, i) => (
                        <tbody key={r.key} data-draft-row className="border-t first:border-t-0">
                          <tr className="align-middle">
                            <td className="num py-1.5 pl-4 text-xs text-muted-foreground">{i + 1}</td>
                            <td className="py-1.5 pl-1" data-cell={`${i}-title`}>
                              <input aria-label={`第${i + 1}单名称`} value={r.title} onChange={(e) => edit(i, { title: e.target.value })} className={cn(cell, 'font-medium', bad(i, 'title') && 'cell-bad')} placeholder="订单名称" />
                            </td>
                            <td className="py-1.5 pl-1" data-cell={`${i}-channel`}>
                              <Combobox
                                value={r.channelId}
                                invalid={bad(i, 'channel')}
                                placeholder={r.channelName ? `新渠道：${r.channelName}` : r.salesMode === 'cost' ? '可不填渠道' : '选择渠道'}
                                options={r.salesMode === 'cost' ? [{ value: '', label: '不填渠道' }, ...channelOptions] : channelOptions}
                                className="h-9 border-transparent bg-transparent hover:bg-accent"
                                onChange={(id) => edit(i, { channelId: id, newChannel: false, ...(canAssign && id ? { ownerId: s.channels.find((ch) => ch.id === id)?.ownerId ?? r.ownerId } : {}) })}
                              />
                            </td>
                            <td className="py-1.5 pl-1">
                              <input aria-label={`第${i + 1}单类型`} list="ai-types" value={r.type} onChange={(e) => edit(i, { type: e.target.value })} className={cn(cell, r.type && !s.types.includes(r.type) && 'text-warn')} title={r.type && !s.types.includes(r.type) ? '新类型，确认后会加入选项' : undefined} placeholder="—" />
                            </td>
                            <td className="py-1.5 pl-1">
                              <SelectField disabled={!role.locked && allocationPolicy !== 'legacy'} aria-label={`第${i + 1}单结算方式`} value={r.salesMode ?? 'commission'} onChange={e => changeMode(i, e.target.value as SalesMode)} className={cell}><option value="commission">提成分成</option><option value="cost">底价结算</option></SelectField>
                            </td>
                            <td className="py-1.5 pr-1" data-cell={`${i}-price`}>
                              <span className="block pr-2 text-right text-[10px] text-muted-foreground">{r.salesMode === 'cost' ? '交老板底价' : '客户总价'}</span>
                              <input aria-label={`第${i + 1}单${r.salesMode === 'cost' ? '交老板底价' : '客户总价'}`} inputMode="decimal" value={r.basePrice ?? ''} onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, ''); edit(i, { basePrice: t === '' ? null : Number(t) }) }} className={cn(cell, 'num text-right', bad(i, 'price') && 'cell-bad')} placeholder="待填" />
                            </td>
                            <td className="py-1.5 pl-1">
                              <div className="px-2">
                                <DatePicker plain value={r.dueDate} label={`第${i + 1}单截止日期`} onChange={(d) => edit(i, { dueDate: d || null })} />
                              </div>
                            </td>
                            <td className="py-1.5 pr-3">
                              <div className="flex items-center justify-end gap-0.5">
                                <button type="button" title={r.open ? '收起' : '更多字段'} aria-label={r.open ? '收起' : '更多字段'} onClick={() => edit(i, { open: !r.open })} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                                  <CaretDown size={13} className={cn('transition-transform', r.open && 'rotate-180')} />
                                </button>
                                <button type="button" title="去掉这单" aria-label="去掉这单" onClick={() => setRows(rows.filter((_, n) => n !== i))} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-danger">
                                  <X size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {!r.channelId && r.channelName && (
                            <tr>
                              <td />
                              <td colSpan={7} className="pb-2 pl-3 text-xs">
                                <label className="inline-flex items-center gap-1.5 text-warn">
                                  <input type="checkbox" checked={r.newChannel} onChange={(e) => edit(i, { newChannel: e.target.checked })} />
                                  库里没有「{r.channelName}」，确认时新建这个渠道
                                </label>
                              </td>
                            </tr>
                          )}
                          {(can('payment.create') || r.warnings.length > 0) && (
                            <tr>
                              <td />
                              <td colSpan={7} className="pb-2 pl-3 pr-3" data-cell={`${i}-paid`}>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                                  {can('payment.create') && <>
                                    {r.salesMode === 'cost' && <span className="text-muted-foreground">老板收款</span>}
                                    <IntakePayment id={`ai-paid-${r.key}`} label={`第${i + 1}单${r.salesMode === 'cost' ? '老板已收金额' : '已付金额'}`} amount={r.paidAmount} tag={r.paymentTag} total={r.basePrice} invalid={bad(i, 'paid')} onChange={(paidAmount, paymentTag) => edit(i, { paidAmount, paymentTag })} />
                                    {r.salesMode !== 'cost' && !!r.deposit && !r.paidAmount && <button type="button" className="text-primary hover:underline" onClick={() => edit(i, { paidAmount: String(r.deposit), paymentTag: '定金' })}>填入识别金额 ¥{r.deposit}</button>}
                                  </>}
                                  {can('payment.create') && Number(r.paidAmount) > 0 && <div className="w-full"><FinancialNote note={r.paymentNote} proof={r.paymentProof} onNote={paymentNote => edit(i, { paymentNote })} onProof={paymentProof => edit(i, { paymentProof })} onReading={setReadingPayment} disabled={locked} required={!role.locked} /></div>}
                                  {r.warnings.length > 0 && <WarningList list={r.warnings} />}
                                </div>
                              </td>
                            </tr>
                          )}
                          {r.open && (
                            <tr>
                              <td />
                              <td colSpan={7} className="pb-3 pl-2 pr-4">
                                <div className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-2">
                                  <label className="grid gap-1 text-xs text-muted-foreground" data-cell={`${i}-orderDate`}>
                                    下单日期
                                    <span className={cn('rounded-md bg-card px-2', bad(i, 'orderDate') && 'cell-bad')}>
                                      <DatePicker plain value={r.orderDate} label={`第${i + 1}单下单日期`} onChange={(d) => edit(i, { orderDate: d || null })} />
                                    </span>
                                  </label>
                                  <label className="grid gap-1 text-xs text-muted-foreground">
                                    渠道单号
                                    <input value={r.channelNo} onChange={(e) => edit(i, { channelNo: e.target.value })} className={cn(inputCls, 'h-8')} />
                                  </label>
                                  {canAssign && (
                                      <div className="grid gap-1 text-xs text-muted-foreground">
                                        归属销售
                                        <PersonChoice label={`第${i + 1}单归属销售`} people={salesPeople(s)} value={r.ownerId} onChange={(id) => edit(i, { ownerId: id })} />
                                      </div>
                                  )}
                                  {canPick && (
                                      <div className="grid gap-1 text-xs text-muted-foreground" data-cell={`${i}-writer`}>
                                        <span className="flex items-center gap-2">{canAssign ? '写手与工资' : '写手'}</span>
                                        <div className={cn('flex flex-wrap items-center gap-2 rounded-md', bad(i, 'writer') && 'cell-bad')}>
                                          <PersonChoice label={`第${i + 1}单写手`} people={writers} value={r.writerId} onChange={(id) => edit(i, { writerId: id, writerName: s.users.find((u) => u.id === id)?.name ?? '', writerPay: s.users.find((u) => u.id === id)?.isAdmin ? 0 : id === r.writerId ? r.writerPay : null })} />
                                          {canAssign && <input readOnly={isFixed(r)} aria-label="写手工资" inputMode="decimal" placeholder="未定" value={writerPay(r) ?? ''} onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, ''); edit(i, { writerPay: t === '' ? null : Number(t) }) }} className={cn(inputCls, 'num h-8 w-24 text-right')} />}
                                        </div>
                                      </div>
                                  )}
                                  <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
                                    备注
                                    <textarea rows={2} value={r.note} onChange={(e) => edit(i, { note: e.target.value })} className={cn(inputCls, 'h-auto py-2 text-sm text-foreground')} />
                                  </label>
                                  {shots.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground sm:col-span-2">
                                      存为附件：
                                      {shots.map((_, index) => (
                                        <label key={index} className="inline-flex items-center gap-1 text-foreground">
                                          <input type="checkbox" checked={r.imageIndexes.includes(index)} onChange={(e) => edit(i, { imageIndexes: e.target.checked ? [...r.imageIndexes, index] : r.imageIndexes.filter((n) => n !== index) })} />
                                          截图 {index + 1}
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                  {can('role.manage') && r.writerName && !r.writerId && (
                                    <button type="button" className="w-fit text-xs text-primary underline sm:col-span-2" onClick={() => go('roles')}>
                                      到角色与账号新增写手
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      ))}
                    </table>
                  </div>
                </fieldset>
                <datalist id="ai-types">{s.types.map((t) => <option key={t} value={t} />)}</datalist>
                <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
                  {tried && miss.length > 0 ? (
                    <button type="button" onClick={() => pointTo(miss[0])} className="inline-flex items-center gap-1.5 text-sm text-danger hover:underline">
                      <Warning size={14} />
                      还差 {miss.length} 项：第 {miss[0].row + 1} 单{miss[0].label}
                    </button>
                  ) : (
                    <span className="text-sm text-muted-foreground">{busy ? busy : created.length ? '订单已保存，继续补存剩余内容' : '核对一下金额和日期，确认后才进订单'}</span>
                  )}
                  <Button className="ml-auto gap-1.5" disabled={!!busy || readingPayment} onClick={() => void confirm()}>
                    {busy || (created.length ? '继续保存' : frozen ? '重试确认' : `确认入库 ${rows.length} 单`)}
                  </Button>
                </div>
              </div>
            </AiGlow>
          </motion.div>
        )}
      </AnimatePresence>
      {rows.length > 0 && (text || shots.length > 0) && (
        <details className="rounded-lg px-1 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">看原消息</summary>
          {text && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-muted-foreground">{text}</p>}
          {shots.length > 0 && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {shots.map((shot, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={shot.url} alt={`原截图 ${i + 1}`} className="w-full rounded-lg border" />
              ))}
            </div>
          )}
        </details>
      )}
    </div>
  )
}

/** 模型的提示折成一行：默认只露第一条，点开看全部。 */
function WarningList({ list }: { list: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <button type="button" onClick={() => setOpen(!open)} className="inline-flex min-w-0 max-w-full items-start gap-1 text-left text-warn hover:underline" title={open ? undefined : list.join('\n')}>
      <Warning size={12} className="mt-0.5 shrink-0" />
      {open ? (
        <span className="grid gap-0.5">{list.map((w, i) => <span key={i}>{w}</span>)}</span>
      ) : (
        <span className="truncate">
          {list[0]}
          {list.length > 1 && <span className="ml-1 text-muted-foreground">+{list.length - 1}</span>}
        </span>
      )}
    </button>
  )
}
