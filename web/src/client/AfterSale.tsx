import { isStagedWriterPay, writerGroupDone } from '@/shared/writer-stages'
import { PreviewButton } from './preview/PreviewButton'
import { DeliverButton } from './DeliverButton'
import { DateTimePicker } from './DatePicker'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Plus, Lifebuoy, CheckCircle, BellRinging, UploadSimple, FileText, X, Wrench, IdentificationCard, DownloadSimple, CalendarDots } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AfterSale, AfterSaleReason, OrderView } from '@/shared/types'
import { Avatar, ChannelName, ChannelAvatar, Empty, Money, inputCls } from './ui'
import { addAfterSaleFiles, createAfterSale, finishAfterSale, markDraft, nudgeAfterSale, setAfterSaleReason, updateAfterSale, useSession } from './store'
import { Thumbs, fileUrl } from './ImageViewer'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PHRASES, TONE_VAR, afterSaleState } from '@/shared/as-rules'
import { fileSize, hasFiles, thumb } from './files'
import { businessDate, payday, relTime } from '@/shared/format'
import { useNav } from './nav'
import { PersonChoice } from './PersonChoice'
import { ConfirmationPanel } from './TaskReply'
import { ImageInputActions } from './ImageInputActions'
import { IMAGE_INPUT_EMPTY_MESSAGE, imageFilesFromTransfer } from './image-input'

type AS = OrderView['afterSales'][number]

/** 截止时间统一按北京时间输入与显示。 */
const localInput = (ts: number) => new Date(ts + 8 * 3600_000).toISOString().slice(0, 16)
const inputTime = (value: string) => new Date(value + ':00+08:00').getTime()
function useClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer) }, [])
  return now
}

/** 本单写手里选负责这一轮的人；只有一个写手时只显示名字 */
function WriterPick({ v, value, onChange, allowUnassigned = false }: { v: OrderView; value: string; onChange: (id: string) => void; allowUnassigned?: boolean }) {
  const { s, can } = useSession()
  const people = s.users.filter(u => v.assignees.some(a => a.userId === u.id) || allowUnassigned && !v.assignees.length && can('order.edit') && u.active && u.canWrite)
  if (!people.length) return <span className="text-warn">未指定写手，请先在订单中分配</span>
  return <PersonChoice label="负责写手" people={people} value={value} onChange={onChange}/>

}

const REASON_TONE: Record<AfterSaleReason, string> = { 正常修改: 'var(--info)', 写手返工: 'var(--danger)', 新增需求: 'var(--warn)' }

export function openAfterSale(v: OrderView): AS | undefined {
  return v.afterSales.find((a) => !a.doneAt && !a.cancelledAt)
}

/** 排序用：进行中的按期限，越急越靠前；没有跟进的排最后。 */
export function afterSaleRank(v: OrderView) {
  const a = openAfterSale(v)
  return a ? a.confirmBy && !a.confirmedAt ? -new Date(a.start).getTime() : new Date(a.due).getTime() : v.afterSales.length ? 9e15 : 9.5e15
}

/** 表格里的「跟进」列 */
export function AfterSaleChip({ v }: { v: OrderView }) {
  const a = openAfterSale(v)
  if (!a) return v.afterSales.length ? <span className="text-xs text-muted-foreground">已改 {v.afterSales.length} 轮</span> : <span className="text-muted-foreground">—</span>
  const st = afterSaleState(a)
  // 一轮一个点：改完的灰色实心，这一轮按期限上色
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" style={{ '--t': TONE_VAR[st.tone] } as CSSProperties} title={`第 ${a.round} 轮 · ${st.label}`}>
      <span aria-label={`第 ${a.round} 轮`} role="img" className="inline-flex items-center gap-[3px]">
        {Array.from({ length: Math.min(a.round - 1, 5) }, (_, i) => <i key={i} className="size-1.5 rounded-full bg-muted-foreground/40" />)}
        <i className="size-2 rounded-full bg-[hsl(var(--t))]" />
      </span>
      <span className={cn('text-[hsl(var(--t))]', st.tone !== 'ok' && 'font-medium')}>{st.label}</span>
    </span>
  )
}

// ---------- 订单详情的「跟进」页签 ----------

export function AfterSaleTab({ v }: { v: OrderView }) {
  const { can } = useSession()
  const [composing, setComposing] = useState(false)
  const list = [...v.afterSales].reverse()
  const open = openAfterSale(v)
  return (
    <div className="grid gap-3">
      {can('aftersale.create') && !composing && (
        <Button size="sm" variant="outline" className="h-8 w-fit gap-1.5" onClick={() => setComposing(true)} disabled={!!open} title={open ? '上一轮还没改完' : undefined}>
          <Plus size={14} weight="bold" /> 开第 {v.afterSales.length + 1} 轮修改
          {open && <span className="text-xs text-muted-foreground">（第 {open.round} 轮还没改完）</span>}
        </Button>
      )}
      <AnimatePresence>{composing && <Composer v={v} onDone={() => setComposing(false)} />}</AnimatePresence>
      {list.length === 0 && !composing ? (
        <Empty icon={<Lifebuoy size={20} />} title="还没有跟进" />
      ) : (
        list.map((a) => <Round key={a.id} v={v} a={a} />)
      )}
    </div>
  )
}

export function Composer({ v, onDone, embedded = false, onPublishClose, onDirtyChange, onBusyChange }: { v: OrderView; onDone: () => void; embedded?: boolean; onPublishClose?: () => void; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const { s, can, me } = useSession()
  const [writerId, setWriterId] = useState(() => (v.assignees.some((a) => a.userId === me.id) ? me.id : (v.assignees[0]?.userId ?? '')))
  useEffect(() => {
    if (!v.assignees.length) return
    setWriterId(current => v.assignees.some(a => a.userId === current) ? current : v.assignees.some(a => a.userId === me.id) ? me.id : v.assignees[0].userId)
  }, [v.assignees, me.id])
  const [req, setReq] = useState('')
  const reqRef=useRef(''), [parsing,setParsing]=useState(false)
  const changeReq=(value:string)=>{reqRef.current=value;setReq(value)}
  async function parsePasted(text:string) {
    changeReq(text);setParsing(true)
    try{const r=await fetch('/api/aftersales/parse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});if(r.ok){const data=await r.json();if(reqRef.current===text)changeReq(data.items.join('\n'));if(data.warning)toast(data.warning)}}catch{toast.error('整理失败，原文已保留，可直接编辑发布')}finally{setParsing(false)}
  }
  const [reason, setReason] = useState<AfterSaleReason>('正常修改')
  const [shots, setShots] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const writer = s.users.find((u) => u.id === writerId)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const pasteTarget = useRef<HTMLTextAreaElement>(null), reading = useRef(false), inputReading = useRef(false)
  const [readingShots, setReadingShots] = useState(false)
  useEffect(() => { onDirtyChange?.(!!(req.trim() || shots.length || extra)) }, [req, shots.length, extra, onDirtyChange])
  useEffect(() => { onBusyChange?.(busy || readingShots || parsing) }, [busy, readingShots, parsing, onBusyChange])
  const onImageReading = (value: boolean) => { inputReading.current = value; setReadingShots(value) }
  async function addShots(files: File[]) {
    if (reading.current || submitting.current) return
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) { toast.error(IMAGE_INPUT_EMPTY_MESSAGE); return }
    if (shots.length + images.length > 9) { toast.error('最多添加 9 张截图'); return }
    reading.current = true; setReadingShots(true)
    try {
      const urls = await Promise.all(images.map((f) => thumb(f, 1600)))
      if (urls.some((url) => !url || url.length > 1_500_000)) { toast.error('图片过大或无法读取，请换一张截图'); return }
      setShots((old) => [...old, ...urls as string[]].slice(0, 9))
    } catch { toast.error('截图读取失败，请重新选择') }
    finally { reading.current = false; setReadingShots(false) }
  }

  async function submit(close = false) {
    if (submitting.current || reading.current || inputReading.current) return
    if (!writerId) return toast.error('请选择负责写手')
    const items = req.trim().split('\n').map((x) => x.trim()).filter(Boolean)
    if (!items.length && !shots.length) return toast.error('粘贴要求或截图，至少有一样')
    submitting.current = true; setBusy(true)
    try {
      const a = await createAfterSale(v.id, { reason, req: items, shots, extra: reason === '新增需求' ? Number(extra) || 0 : 0, writerId })
      if (a) { toast.success(`已登记第 ${a.round} 轮修改，${writer?.name ?? '写手'}须在 1 小时内确认时间`); if(close&&onPublishClose)onPublishClose();else onDone() }
    } finally { submitting.current = false; setBusy(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={cn('grid gap-3', !embedded && 'rounded-xl border p-3')}
      onClick={e => { if (!(e.target as HTMLElement).closest('button, input, textarea, select, a, summary')) pasteTarget.current?.focus({ preventScroll: true }) }}
      onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !readingShots && !busy) { e.preventDefault(); void submit() } }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation() } }}
      onDrop={(e) => { const files = imageFilesFromTransfer(e.dataTransfer); if (hasFiles(e) || files.length) { e.preventDefault(); e.stopPropagation(); void addShots(files) } }}
      onPaste={(e) => {
        const imgs = imageFilesFromTransfer(e.clipboardData)
        if (imgs.length) {
          e.preventDefault()
          e.stopPropagation(); void addShots(imgs)
        }
      }}
    >
      {!embedded && <div className="flex items-center justify-between text-sm font-medium">
        开第 {v.afterSales.length + 1} 轮修改
        <button onClick={onDone} aria-label="取消" className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>}
      <div className="relative rounded-lg border bg-background p-2 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground"><textarea ref={pasteTarget} autoFocus aria-label="修改要求" rows={5} className={cn(inputCls, 'h-auto resize-y border-0 bg-transparent py-2 pr-9 text-sm font-normal text-foreground shadow-none focus-visible:ring-0')} placeholder="输入修改意见" value={req} onChange={(e) => changeReq(e.target.value)} onPaste={e=>{if(imageFilesFromTransfer(e.clipboardData).length)return;const text=e.clipboardData.getData('text/plain');if(text.trim()&&!req.trim()){e.preventDefault();void parsePasted(text)}}} /></label>
        <ImageInputActions pickerOnly pickLabel="上传截图" onFiles={addShots} disabled={busy || readingShots} compact pasteTargetRef={pasteTarget} onReading={onImageReading} className="absolute right-2 top-2"/>
      </div>
      {parsing&&<span className="text-xs text-muted-foreground">整理中…</span>}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">常用修改要求</summary><div className="mt-2 flex flex-wrap gap-1">
        {PHRASES.map((p) => (
          <button key={p} type="button" onClick={() => changeReq((req.trim() ? req.trim() + '\n' : '') + p)} className="rounded-full border border-dashed border-input px-2 py-0.5 text-[12px] text-muted-foreground hover:border-primary hover:text-primary">
            {p}
          </button>
        ))}
      </div></details>
      {shots.length > 0 && (
        <div className="flex items-center gap-2">
          <Thumbs pics={shots.map((src, i) => ({ src, name: `截图${i + 1}.jpg` }))} />
          <button type="button" className="text-xs text-muted-foreground hover:text-danger" onClick={() => setShots([])}>
            清空截图
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {can('aftersale.reason') ? (
          <div className="flex rounded-md border p-0.5">
            {(['正常修改', '写手返工', '新增需求'] as AfterSaleReason[]).map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn('rounded px-2 py-1 text-xs', reason === r ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground')}>
                {r}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">正常修改</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">1 小时内确认时间 · 未确认默认 24 小时交付</p>
      </div>
      {reason === '新增需求' && can('order.assign') && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          写手追加工资 ¥
          <input className={cn(inputCls, 'num h-7 w-24 text-right')} inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value.replace(/[^\d.]/g, ''))} />
          <span>按今天归期（{payday(new Date().toISOString())}发）</span>
        </label>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          负责 <WriterPick v={v} value={writerId} onChange={setWriterId} allowUnassigned />
        </div>
        <div className="flex gap-2">{embedded&&onPublishClose&&<Button size="sm" variant="outline" disabled={busy||readingShots||!writerId} onClick={()=>void submit(true)}>发布</Button>}<Button size="sm" disabled={busy || readingShots || !writerId} onClick={()=>void submit()}>
          {busy ? '发布中…' : embedded ? <>发布并整理下一条 <kbd className="hidden sm:inline">⌘↵</kbd></> : '发布修改任务'}
        </Button></div>
      </div>
    </motion.div>
  )
}

function Round({ v, a }: { v: OrderView; a: AS }) {
  const { me, role, can, user } = useSession()
  const { cards } = useNav()
  const [over, setOver] = useState(false)
  const [ask, setAsk] = useState(false)
  const [pricing, setPricing] = useState(false)
  const [editing, setEditing] = useState(false)
  const now = useClock()
  const st = afterSaleState(a, now)
  const mine = a.writerId === me.id || role.locked
  const live = !a.doneAt && !a.cancelledAt

  async function take(list: FileList) {
    const files = Array.from(list)
    if (await addAfterSaleFiles(v.id, a.id, files)) {
      if (live && mine) setAsk(true)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        if (!hasFiles(e) || !mine) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e) || !mine) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        take(e.dataTransfer.files)
      }}
      className={cn('grid gap-2.5 rounded-xl border p-3 transition-colors', live ? 'bg-card' : 'bg-muted/30', over && 'border-primary bg-primary/[0.06]')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">第 {a.round} 轮</span>
        {can('aftersale.reason') ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="tone rounded-full px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ '--t': REASON_TONE[a.reason] } as CSSProperties} title="改原因（影响工资）">
              {a.reason} ▾
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(['正常修改', '写手返工', '新增需求'] as AfterSaleReason[]).map((r) => (
                <DropdownMenuItem
                  key={r}
                  onSelect={() =>
                    // 新增需求要同时定追加工资、给订单加价，先弹出填写；其他直接改
                    r === '新增需求' ? setPricing(true) : void setAfterSaleReason(v.id, a.id, r).then((ok) => ok && toast.success(`第 ${a.round} 轮改为「${r}」`))
                  }
                >
                  {r}
                  {r === '新增需求' && a.reason === '新增需求' && <span className="ml-2 text-xs text-muted-foreground">改金额…</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="tone rounded-full px-2 py-0.5 text-xs" style={{ '--t': REASON_TONE[a.reason] } as CSSProperties}>
            {a.reason}
          </span>
        )}
        {a.extra !== undefined && a.extra > 0 && <span className="text-xs">追加工资 <Money value={a.extra} signed /></span>}
        <span className="tone ml-auto rounded-full px-2 py-0.5 text-xs font-medium" style={{ '--t': TONE_VAR[st.tone] } as CSSProperties}>
          {a.doneAt ? `已改完 · ${st.label}` : st.label}
        </span>
      </div>
      {a.confirmBy && !a.doneAt && <ConfirmationPanel orderId={v.id} a={a} now={now} />}
      <ol className="grid gap-1 text-sm">
        {(a.req.length ? a.req : ['见截图']).map((r, i) => (
          <li key={i} className="grid grid-cols-[18px_1fr] gap-1.5">
            <span className="num mt-0.5 grid h-[18px] place-items-center rounded bg-primary/10 text-[12px] text-primary">{i + 1}</span>
            <span className="break-words">{r}</span>
          </li>
        ))}
      </ol>
      {a.shots.length > 0 && <Thumbs pics={a.shots.map((src, i) => ({ src, name: `${v.no}-第${a.round}轮-截图${i + 1}.jpg` }))} imgClass="h-16 w-12" />}
      {a.files.length > 0 && (
        <div className="grid gap-1">
          {a.files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs">
              <FileText size={15} className="shrink-0 text-info" />
              <a href={fileUrl(f.id)} download={f.name} title={`下载 ${f.name}`} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">{f.name}</a>
              <span className="num text-muted-foreground">{fileSize(f.size)}</span>
              <PreviewButton id={f.id} name={f.name} size={f.size} className="h-6 w-6" />
              <a href={fileUrl(f.id)} download={f.name} aria-label={`下载 ${f.name}`} className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"><DownloadSimple size={14} /></a>
            </div>
          ))}
        </div>
      )}
      <AnimatePresence>
        {pricing && <PriceEditor v={v} a={a} onDone={() => setPricing(false)} />}
        {editing && <RoundEditor v={v} a={a} onDone={() => setEditing(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {ask && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/[0.06] px-3 py-2 text-sm">
              <span className="flex-1">稿件已上传。交付时还要附一张截图</span>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setAsk(false)}>
                先不
              </Button>
              <DeliverButton kind="aftersale" orderId={v.id} asId={a.id} no={v.no} label="去交付" variant="default" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
        <Avatar user={user(a.by)} size={16} /> {user(a.by)?.name} 发起 · {relTime(a.start)}
        <span>→</span>
        <Avatar user={user(a.writerId)} size={16} /> {user(a.writerId)?.name}
        {a.nudges > 0 && <span className="text-warn">已催 {a.nudges} 次</span>}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => cards([v.id], 'aftersale')} title="生成这张跟进卡的图片，发微信">
            <IdentificationCard size={13} /> 卡片
          </Button>
          {live && can('aftersale.create') && !editing && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setEditing(true)} title={a.confirmBy ? "更换负责的写手" : "改期限或负责的写手"}>
              <CalendarDots size={13} /> {a.confirmBy ? '换负责人' : '改期限 / 负责人'}
            </Button>
          )}
          {live && can('aftersale.create') && !(a.writerId === me.id) && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void nudgeAfterSale(v.id, a.id).then((ok) => ok && toast.success('已提醒写手'))}>
              <BellRinging size={13} /> 催一下
            </Button>
          )}
          {live && mine && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.multiple = true
                  input.onchange = () => input.files?.length && take(input.files)
                  input.click()
                }}
                title="也可以把修改稿直接拖到这张卡上"
              >
                <UploadSimple size={13} /> 交修改稿
              </Button>
              <DeliverButton kind="aftersale" orderId={v.id} asId={a.id} no={v.no} label="交付本次跟进" variant="default" />
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/** 定为新增需求：同时定写手追加工资、给这单加价。0 也要管理员自己确认。 */
export function PriceEditor({ v, a, onDone }: { v: Pick<OrderView, 'id'>; a: AS; onDone: () => void }) {
  const { can } = useSession()
  const [extra, setExtra] = useState(a.reason === '新增需求' && a.extra !== undefined ? String(a.extra) : '')
  const [charge, setCharge] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const requestId = useRef<string | null>(null)
  const canPay = can('order.assign')
  const canPrice = can('order.price')
  async function save() {
    if (submitting.current) return
    if (canPay && extra === '') return toast.error('写手追加工资要填，没有就填 0')
    const x = canPay ? Number(extra) : undefined
    const ch = Number(charge) || 0
    submitting.current = true
    setBusy(true)
    requestId.current ??= crypto.randomUUID()
    try {
      if (await setAfterSaleReason(v.id, a.id, '新增需求', { extra: x, charge: ch || undefined, requestId: requestId.current })) {
        toast.success([`第 ${a.round} 轮定为新增需求`, x !== undefined && `写手追加 ¥${x}`, ch && `订单加价 ¥${ch}`].filter(Boolean).join(' · '))
        onDone()
      }
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <form className="grid gap-2 rounded-lg border border-warn/40 bg-warn/[0.06] p-3 text-xs" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <fieldset disabled={busy} className="contents">
          <div className="text-sm font-medium">定为新增需求</div>
          {canPay && (
            <label className="flex flex-wrap items-center gap-2 text-muted-foreground">
              写手追加工资 ¥
              <input autoFocus className={cn(inputCls, 'num h-7 w-24 text-right')} inputMode="decimal" placeholder="必填" value={extra} onChange={(e) => setExtra(e.target.value.replace(/[^\d.]/g, ''))} />
              <span>按这一轮开始的日期归期（{payday(a.start)}发）</span>
            </label>
          )}
          {canPrice && (
            <label className="flex flex-wrap items-center gap-2 text-muted-foreground">
              订单加价 ¥
              <input className={cn(inputCls, 'num h-7 w-24 text-right')} inputMode="decimal" placeholder="客户没加钱就空着" value={charge} onChange={(e) => setCharge(e.target.value.replace(/[^\d.]/g, ''))} />
              <span>记一笔追加，进这单的销售额</span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onDone}>
              取消
            </Button>
            <Button type="submit" size="sm" className="h-7" disabled={busy}>
              {busy ? '保存中…' : '确定'}
            </Button>
          </div>
        </fieldset>
      </form>
    </motion.div>
  )
}

/** 改期限、换负责的写手（只能是本单写手），都会记进动态 */
function RoundEditor({ v, a, onDone }: { v: OrderView; a: AS; onDone: () => void }) {
  const { can } = useSession()
  const [due, setDue] = useState(localInput(new Date(a.due).getTime()))
  const [writerId, setWriterId] = useState(a.writerId)
  async function save() {
    const ts = inputTime(due)
    if (!due || isNaN(ts)) return toast.error('选一个截止时间')
    if (await updateAfterSale(v.id, a.id, { due: a.confirmBy ? undefined : new Date(ts).toISOString(), writerId: writerId !== a.writerId ? writerId : undefined })) {
      toast.success(`第 ${a.round} 轮已更新`)
      onDone()
    }
  }
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/[0.04] p-3 text-xs text-muted-foreground">
        {!a.confirmBy && <>截止
        <DateTimePicker label="截止时间" value={due} onChange={setDue}/>
        {[12, 24].map((h) => (
          <button key={h} type="button" className="rounded-full border border-dashed border-input px-2 py-0.5 hover:border-primary" onClick={() => setDue(localInput(inputTime(due) + h * 3600_000))}>
            延 {h} 小时
          </button>
        ))}
        </>}
        <span className="ml-2">负责</span>
        <WriterPick v={v} value={writerId} onChange={setWriterId} />
        {!can('order.assign') && <span className="text-xs">有追加工资的轮次需管理员换负责人</span>}
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" className="h-7" onClick={onDone}>
            取消
          </Button>
          <Button size="sm" className="h-7" onClick={save}>
            保存
          </Button>
        </span>
      </div>
    </motion.div>
  )
}

// ---------- 首页「我的待办」：初稿 + 跟进，一张清单按期限排 ----------

interface Todo {
  key: string
  orderId: string
  kind: '初稿' | '发群' | '跟进'
  title: string
  no: string
  due: number
  label: string
  tone: keyof typeof TONE_VAR
  as?: AfterSale | AS
}

export function useTodos(scope: 'mine' | 'all') {
  const { views, me } = useSession()
  const now = useClock()
  return useMemo(() => {
    const out: Todo[] = []
    for (const v of views) {
      if (v.status === '退单') continue
      const mineOrder = v.assignees.some((a) => a.userId === me.id)
      const a = openAfterSale(v)
      if (a && (scope === 'all' || a.writerId === me.id)) {
        const st = afterSaleState(a, now)
        out.push({ key: a.id, orderId: v.id, kind: '跟进', title: v.title, no: v.no, due: a.confirmBy && !a.confirmedAt ? -1e15 + new Date(a.start).getTime() : new Date(a.due).getTime(), label: `第 ${a.round} 轮 · ${st.label}`, tone: st.tone, as: a })
      }
      if (scope === 'mine' && mineOrder && v.status !== '已发演示' && !writerGroupDone(v, me.id) && (isStagedWriterPay(v) || v.status === '未交付')) {
        // 没定截止日期的单也要列出来，排在最后
        if (!v.dueDate) {
          out.push({ key: v.id, orderId: v.id, kind: '初稿', title: v.title, no: v.no, due: Number.MAX_SAFE_INTEGER - new Date(v.orderDate).getTime(), label: '没定截止', tone: 'ok' })
          continue
        }
        const due = new Date(v.dueDate + 'T23:59:00+08:00').getTime()
        const left = due - now
        const days = Math.ceil(left / 86400000)
        out.push({
          key: v.id,
          orderId: v.id,
          kind: '初稿',
          title: v.title,
          no: v.no,
          due,
          label: left < 0 ? `逾期 ${Math.ceil(-left / 86400000)} 天` : days <= 1 ? '今天截止' : `还有 ${days} 天`,
          tone: left < 0 ? 'late' : days <= 2 ? 'soon' : 'ok',
        })
      }
    }
    return out.sort((x, y) => x.due - y.due)
  }, [views, me.id, scope, now])
}

export function TodoList({ scope }: { scope: 'mine' | 'all' }) {
  const todos = useTodos(scope)
  const { openOrder } = useNav()
  const { views, me, channel, user } = useSession()
  const now = useClock()
  const [filter, setFilter] = useState('全部')
  const list = todos.filter((t) => filter === '全部' || filter === '待回复' && !!t.as?.confirmBy && !t.as.confirmedAt || t.kind === filter)
  const waiting = todos.filter((t) => t.as?.confirmBy && !t.as.confirmedAt).length
  const completed = views.filter((v) => v.status !== '退单').flatMap((v) => v.afterSales).filter((a) => a.doneAt && businessDate(a.doneAt) === businessDate(new Date(now)) && (scope === 'all' || a.writerId === me.id)).length
  return <>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">{scope === 'mine' ? '每日待办' : '修改任务跟进'}</h2><p className="mt-1 text-xs text-muted-foreground">待处理 {todos.length} 项 · 待回复 {waiting} 项 · 今日已改完 {completed} 项</p></div>
      <div className="flex flex-wrap gap-1 text-xs">{(scope === 'mine' ? ['全部', '待回复', '跟进', '初稿', '发群'] : ['全部', '待回复']).map((f) => <button key={f} onClick={() => setFilter(f)} className={cn('rounded-md px-2.5 py-1.5', filter === f ? 'bg-accent font-medium' : 'text-muted-foreground')}>{f}</button>)}</div>
    </div>
    {!list.length ? <p className="py-6 text-center text-sm text-muted-foreground">{filter === '待回复' ? '没有等待回复的任务' : '当前没有待处理任务'}</p> : <div>
      {list.map((t) => {
        const v = views.find((o) => o.id === t.orderId)!
        return <details key={t.key} className="group/task border-b last:border-b-0 open:rounded-lg open:bg-muted/20">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-2 py-2 [&::-webkit-details-marker]:hidden">
            <ChannelAvatar channel={channel(v.channelId)} size={30}/>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="text-sm font-medium">{t.title}</span></div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{t.kind}</span><span>{channel(v.channelId)?.name}</span><span className="inline-flex items-center gap-1"><Avatar user={user(t.as?.writerId ?? (scope === 'mine' ? me.id : v.assignees[0]?.userId))} size={16}/>{user(t.as?.writerId ?? (scope === 'mine' ? me.id : v.assignees[0]?.userId))?.name}</span><span className="min-w-0 flex-1 truncate">{t.as?.req[0]}{t.as?.shots.length ? ` · ${t.as.shots.length} 张截图` : ''}</span></div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1"><span className="tone rounded px-1.5 py-0.5 text-[12px]" style={{ '--t': TONE_VAR[t.tone] } as CSSProperties}>{t.label}</span><span className="text-[12px] text-primary">{scope === 'mine' && t.as?.confirmBy && !t.as.confirmedAt ? '确认时间' : '展开处理'} ↓</span></div>
          </summary>
          <div className="space-y-3 border-t px-3 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"><ChannelName channel={channel(v.channelId)} /><span className="inline-flex items-center gap-1.5 text-muted-foreground">销售 <Avatar user={user(v.ownerId)} size={18} />{user(v.ownerId)?.name}</span>{t.as && <span className="inline-flex items-center gap-1.5 text-muted-foreground">写手 <Avatar user={user(t.as.writerId)} size={18} />{user(t.as.writerId)?.name}</span>}</div>
            {t.as && <>
              <ul className="space-y-1 text-sm leading-6">{t.as.req.map((r, i) => <li key={i} className="break-words">{i + 1}. {r}</li>)}</ul>
              {!!t.as.shots.length && <Thumbs pics={t.as.shots.map((src, i) => ({ src, name: `修改截图${i + 1}` }))} imgClass="h-20 w-20" />}
              <ConfirmationPanel orderId={t.orderId} a={t.as} now={now} />
            </>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => openOrder(t.orderId, list.map((x) => x.orderId), t.as ? 'aftersale' : 'overview')}>查看详情</Button>
              {scope === 'mine' && (t.as ? <DeliverButton kind="aftersale" orderId={t.orderId} asId={t.as.id} label="交付本次跟进" variant="default" /> : <DeliverButton kind="draft" orderId={t.orderId} label="交付初稿" variant="default" />)}
              {scope === 'all' && t.as && t.as.writerId !== me.id && <Button size="sm" variant="outline" onClick={() => void nudgeAfterSale(t.orderId, t.as!.id).then((ok) => ok && toast.success('已提醒写手'))}>催一下</Button>}
            </div>
          </div>
        </details>
      })}
    </div>}
  </>
}
