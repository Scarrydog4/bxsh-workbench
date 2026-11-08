import { fuzzyMatch } from '@/shared/search'
import type { ChannelLabel } from '@/shared/channel-access'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { animate, useReducedMotion, motion, AnimatePresence } from 'motion/react'
import { Camera, Check, ImageSquare, Plus, SpinnerGap, UploadSimple } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { imageFilesFromTransfer } from './image-input'
import { imageArrivalClass, useImageReceiveFeedback } from './useImageReceiveFeedback'
import { AvatarFrameDecoration, RankFrameDecoration } from './AvatarFrames'
import { RANKS, type Rank } from '@/shared/rank'

/** 显示一个人只需要这几项（服务端给的公开信息） */
export type Who = { id: string; name: string; hue: number; avatar?: string; frame?: string; rank?: Rank }
import { money } from '@/shared/format'

function AvatarImage({ src, fallback }: { src?: string; fallback: string }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  return <span className="relative inline-flex h-full w-full items-center justify-center">
    {loaded !== src && fallback}
    {src && <img src={src} loading="lazy" decoding="async" alt="" className={cn('absolute inset-0 h-full w-full object-cover', loaded !== src && 'opacity-0')} onLoad={() => setLoaded(src)} onError={() => setLoaded(null)} />}
  </span>
}

export function Avatar({ user, size = 22, className }: { user?: Who; size?: number; className?: string }) {
  if (!user) return null
  const ch = user.name.replace(/老师$/, '').slice(0, 1)
  const rank = user.rank && RANKS.find((r) => r.id === user.rank)
  return (
    <span
      className={cn('relative inline-flex shrink-0 select-none align-middle leading-none items-center justify-center overflow-visible rounded-full font-medium', className)}
      // 小头像上的虫子伸出右边，多留点位置，免得压到名字
      style={{ '--h': user.hue, width: size, height: size, fontSize: size * 0.48, ...(rank && size < 24 ? { marginRight: size * 0.4 } : {}) } as CSSProperties}
      title={rank ? `${user.name} · ${rank.name}（今日 ${rank.range}）` : user.name}
    >
      <span className="avatar inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full ring-2 ring-background">
        <AvatarImage src={user.avatar} fallback={ch}/>
      </span>
      {rank ? <RankFrameDecoration rank={rank.id} size={size}/> : <AvatarFrameDecoration frame={user.frame} size={size}/>}
    </span>
  )
}

function focusAvatarInput(event: React.MouseEvent<HTMLDivElement>) {
  event.stopPropagation()
  if (!(event.target as HTMLElement).closest('button, input')) {
    event.currentTarget.querySelector<HTMLElement>('[data-avatar-input]')?.focus({ preventScroll: true })
  }
}

function hueOf(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** 渠道是机构，用圆角方形和人区分开。 */
export function ChannelAvatar({ channel, size = 20, className }: { channel?: ChannelLabel; size?: number; className?: string }) {
  if (!channel) return null
  return (
    <span
      className={cn('avatar inline-flex shrink-0 select-none align-middle leading-none items-center justify-center overflow-hidden font-medium', className)}
      style={{ '--h': hueOf(channel.name), width: size, height: size, fontSize: size * 0.5, borderRadius: size * 0.28 } as CSSProperties}
      title={channel.name}
    >
      <AvatarImage src={channel.avatar} fallback={channel.name.slice(0, 1)}/>
    </span>
  )
}

export function ChannelName({ channel, size = 20, muted }: { channel?: ChannelLabel; size?: number; muted?: boolean }) {
  if (!channel) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle', muted && 'text-muted-foreground')}>
      <ChannelAvatar channel={channel} size={size} />
      <span className="truncate">{channel.name}</span>
    </span>
  )
}

/** 头像统一在本机裁剪；失败不更换原头像。 */
export function cropAvatar(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const src = URL.createObjectURL(file)
    const finish = (value: string | null) => { URL.revokeObjectURL(src); resolve(value) }
    img.onload = () => {
      try {
        const side = Math.min(img.width, img.height)
        if (!side) return finish(null)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 160
        const context = canvas.getContext('2d')
        if (!context) return finish(null)
        context.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160)
        finish(canvas.toDataURL('image/jpeg', 0.86))
      } catch { finish(null) }
    }
    img.onerror = () => finish(null)
    img.src = src
  })
}

type ImagePick = (dataUrl: string) => unknown | Promise<unknown>

export function ImageDrop({ onImage, preview, compact, autoFocus, className, showCamera = true }: { onImage: ImagePick; preview?: string; compact?: boolean; autoFocus?: boolean; className?: string; showCamera?: boolean }) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(preview)
  const imageFeedback = useImageReceiveFeedback()
  const receiver = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const lock = useRef(false)
  useEffect(() => { setCurrent(preview) }, [preview])
  useEffect(() => {
    if (autoFocus && !compact) receiver.current?.focus()
  }, [autoFocus, compact])
  async function take(files: File[]) {
    if (lock.current) return
    if (!files.length) { toast.error('未收到图片，请点选图片或粘贴'); return }
    lock.current = true; setBusy(true); imageFeedback.acknowledge()
    try {
      const url = await cropAvatar(files[0])
      if (!url) { toast.error('图片无法读取，请重新选择'); return }
      if (await onImage(url) === false) return
      setCurrent(url); setOpen(false)
    } catch { toast.error('头像未保存，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  const events = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setOver(true) },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(false); const files = imageFilesFromTransfer(e.dataTransfer); if (!files.length && compact) setOpen(true); void take(files) },
    onPaste: (e: React.ClipboardEvent) => { const files = imageFilesFromTransfer(e.clipboardData); e.stopPropagation(); e.preventDefault(); void take(files) },
  }
  if (compact) return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" aria-label="添加头像" {...events} disabled={busy} className={cn('relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-xl border border-dashed bg-muted/30 text-primary transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring', over && 'border-primary bg-primary/10', imageFeedback.className, className)}>
      {current ? <img key={current} src={current} alt="当前头像" className={cn("h-full w-full rounded-xl object-cover", imageArrivalClass)}/> : <ImageSquare size={30} weight="duotone"/>}
      {(showCamera || busy) && <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border bg-primary text-primary-foreground shadow-sm">{busy ? <SpinnerGap size={13} className="animate-spin"/> : <Camera size={13}/>}</span>}
    </button></PopoverTrigger>
    <PopoverContent className="w-72 p-3" onClick={focusAvatarInput}><ImageDrop preview={current} autoFocus showCamera={showCamera} onImage={async url => { const result = await onImage(url); if (result !== false) {setCurrent(url); setOpen(false)} return result }}/></PopoverContent>
  </Popover>
  return <div ref={receiver} data-avatar-input role="group" aria-label="头像图片" aria-keyshortcuts="Meta+V Control+V" aria-busy={busy} tabIndex={0} {...events}
    onClick={event => { event.stopPropagation(); if (!(event.target as HTMLElement).closest('button, input')) event.currentTarget.focus({ preventScroll: true }) }}
    className={cn('group/avatar relative cursor-default rounded-xl border bg-background p-5 outline-none transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-primary focus-within:bg-primary/5 focus-within:ring-2 focus-within:ring-primary/20 focus-within:shadow-md', over && 'border-primary bg-primary/10 ring-2 ring-primary/20', imageFeedback.className, className)}>
    <span aria-hidden="true" className="pointer-events-none absolute left-3 top-3 grid h-5 w-5 scale-75 place-items-center rounded-full bg-primary text-primary-foreground opacity-0 transition-[opacity,transform] group-focus-within/avatar:scale-100 group-focus-within/avatar:opacity-100"><Check size={12} weight="bold"/></span>
    <button type="button" aria-label="选择头像图片" title="选择图片" disabled={busy}
      onClick={event => { event.stopPropagation(); pick.current?.click() }}
      className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><UploadSimple size={19}/></button>
    <div className="relative mx-auto my-3 grid h-24 w-24 place-items-center overflow-hidden rounded-xl border border-dashed bg-background text-primary transition-colors group-focus-within/avatar:border-primary/50">
      {current ? <img key={current} src={current} alt="当前头像" className={cn("h-full w-full rounded-xl object-cover", imageArrivalClass)}/> : <ImageSquare size={40} weight="duotone"/>}
      {busy && <span className="absolute inset-0 grid place-items-center rounded-xl bg-background/75"><SpinnerGap size={26} className="animate-spin"/></span>}
    </div>
    <div aria-hidden="true" className="pointer-events-none flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/60 transition-colors group-focus-within/avatar:text-primary">
      <kbd className="rounded border px-1.5 py-0.5 font-sans">⌘ / Ctrl</kbd><span>+</span><kbd className="rounded border px-1.5 py-0.5 font-sans">V</kbd>
    </div>
    <input ref={pick} type="file" accept="image/*" className="hidden" aria-label="头像图片文件" disabled={busy} onChange={e => {const files = Array.from(e.target.files ?? []); e.target.value = ''; if(files.length) void take(files)}}/>
    {over && <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/95 text-primary"><UploadSimple size={40}/></div>}
  </div>
}

export function AvatarButton({ children, onPick, disabled, label, preview, showCamera = true }: { children: ReactNode; onPick: ImagePick; disabled?: boolean; label: string; preview?: string; showCamera?: boolean }) {
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const imageFeedback = useImageReceiveFeedback()
  async function take(files: File[]) {
    if (!files.length) { setOpen(true); toast.error('未收到图片，请点选图片或粘贴'); return }
    if (lock.current) return
    lock.current = true; setBusy(true); imageFeedback.acknowledge()
    try {
      const url = await cropAvatar(files[0])
      if (!url) { toast.error('图片无法读取，请重新选择'); return }
      await onPick(url)
    } catch { toast.error('头像未保存，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  if (disabled) return <>{children}</>
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={label} title={label} disabled={busy}
        onClick={e => e.stopPropagation()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); void take(imageFilesFromTransfer(e.dataTransfer)) }}
        onPaste={e => { e.preventDefault(); e.stopPropagation(); void take(imageFilesFromTransfer(e.clipboardData)) }}
        className={cn('group/av relative inline-flex shrink-0 items-center justify-center rounded-full align-middle leading-none focus-visible:ring-2 focus-visible:ring-ring', over && 'scale-110 motion-reduce:scale-100 ring-2 ring-primary ring-offset-2 ring-offset-background', imageFeedback.className)}>
        {children}
        {/* 相机放左下角，右下角留给单量框的小虫子 */}
        {(showCamera || busy) && <span className="absolute -bottom-1 -left-1 grid h-3.5 w-3.5 place-items-center rounded-full border border-background bg-primary text-primary-foreground shadow-sm">{busy ? <SpinnerGap size={9} className="animate-spin"/> : <Camera size={9} weight="bold"/>}</span>}
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-72 p-3" onClick={focusAvatarInput}>
      <div className="mb-2 text-sm font-medium">{label}</div>
      <ImageDrop preview={preview} autoFocus showCamera={showCamera} onImage={async url => { const result = await onPick(url); if (result !== false) setOpen(false); return result }}/>
    </PopoverContent>
  </Popover>
}

export function Person({ user, size = 20, muted }: { user?: Who; size?: number; muted?: boolean }) {
  if (!user) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle', muted && 'text-muted-foreground')}>
      <Avatar user={user} size={size} />
      <span className="truncate">{user.name}</span>
    </span>
  )
}

export function AvatarStack({ users, max = 3 }: { users: (Who | undefined)[]; max?: number }) {
  const list = users.filter(Boolean) as Who[]
  // 没派写手：一个虚线空圈，表示这里还空着
  if (!list.length) return <span role="img" aria-label="未指定写手" title="未指定写手" className="inline-block size-5 rounded-full border border-dashed border-muted-foreground/50" />
  return (
    <span className="inline-flex items-center">
      {list.slice(0, max).map((u, i) => (
        <Avatar key={u.id} user={u} className={i ? '-ml-1.5' : ''} />
      ))}
      {list.length === 1 && <span className="ml-1.5 truncate">{list[0].name}</span>}
      {list.length > max && <span className="ml-1 text-xs text-muted-foreground">+{list.length - max}</span>}
    </span>
  )
}

export const STATUS_TONE: Record<string, string> = {
  未交付: 'var(--muted-foreground)',
  已发演示: 'var(--warn)',
  已交付: 'var(--ok)',
  退单: 'var(--danger)',
}
export type DotShape = 'ring' | 'half' | 'full' | 'slash'

export function Pill({ tone, children, className, shape }: { tone?: string; children: ReactNode; className?: string; shape?: DotShape }) {
  return (
    <span
      className={cn('tone inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium', className)}
      style={{ '--t': tone ?? 'var(--muted-foreground)' } as CSSProperties}
    >
      <span className={cn('tone-dot shrink-0 rounded-full', !shape && 'h-1.5 w-1.5')} data-shape={shape} />
      {children}
    </span>
  )
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'var(--muted-foreground)'}>{status}</Pill>
}

export function PayPill({ status }: { status?: string }) {
  if (!status) return null
  const tone = status === '已收齐' ? 'var(--ok)' : status === '部分收款' ? 'var(--gold)' : 'var(--muted-foreground)'
  return <Pill tone={tone}>{status}</Pill>
}

/** 收款两格：空心没收、一格定金、两格收齐；多收后面加红点，退单变灰。 */
export function PayCells({ stage, over, off, className }: { stage?: 'none' | 'deposit' | 'paidUp'; over?: boolean; off?: boolean; className?: string }) {
  if (!stage) return null
  const label = off ? '退单' : over ? '多收' : stage === 'paidUp' ? '已收齐' : stage === 'deposit' ? '定金已到' : '未收款'
  return (
    <span role="img" aria-label={label} title={label} className={cn('pay-cells', className)} data-off={off || undefined}>
      <i data-on={stage !== 'none' || over || undefined} />
      <i data-on={stage === 'paidUp' || over || undefined} />
      {over && !off && <b />}
    </span>
  )
}

/** 金额：¥ 和小数缩小变淡；负数写成 −¥ 并标红。out = 付出去的钱（常规字重），owed = 还没到手（虚线）。 */
export function MoneyText({ value, signed, out, owed, className }: { value: number; signed?: boolean; out?: boolean; owed?: boolean; className?: string }) {
  const [int, dec] = money(Math.abs(value)).slice(1).split('.')
  return (
    <span className={cn('num money', className)} data-out={out || undefined} data-owed={(owed && value > 0) || undefined} data-neg={value < 0 || undefined}>
      {value < 0 ? '−' : signed && value > 0 ? '+' : ''}
      <span className="money-unit">¥</span>{int}{dec && <span className="money-unit">.{dec}</span>}
    </span>
  )
}

/** undefined = 没权限看（—）；null = 还没定（未定） */
export function Money({ value, className, signed, pending, out, owed, plain }: { value?: number | null; className?: string; signed?: boolean; pending?: boolean; out?: boolean; owed?: boolean; plain?: boolean }) {
  if (value === undefined) return <span className="text-muted-foreground">—</span>
  if (value === null) return <span className="blank-box">未定</span>
  if (pending) return <span className="blank-box" title="写手工资还没定，定了再算">待定</span>
  if (plain) return <span className={cn('num', className)}>{signed && value > 0 ? '+' : ''}{money(value)}</span>
  return <MoneyText value={value} signed={signed} out={out} owed={owed} className={className} />
}

/** 金额在这次打开页面期间变大时，旁边浮出「+¥650」，1.8 秒后淡出。第一次加载、数字变小都不出现。 */
export function GainTag({ value, className }: { value: number | undefined; className?: string }) {
  const prev = useRef<number | undefined>(undefined)
  const [gain, setGain] = useState<{ id: number; n: number } | null>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (value === undefined) return
    if (prev.current !== undefined && Math.round(value) > Math.round(prev.current)) setGain({ id: Date.now(), n: value - prev.current })
    prev.current = value
  }, [value])
  useEffect(() => {
    if (!gain) return
    const timer = setTimeout(() => setGain(null), 1800)
    return () => clearTimeout(timer)
  }, [gain])
  return (
    <AnimatePresence>
      {gain && (
        <motion.span
          key={gain.id}
          aria-live="polite"
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -8 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          className={cn('pointer-events-none inline-flex h-5 items-center rounded-full bg-gold/[0.12] px-1.5 text-xs font-medium tabular-nums text-gold', className)}
        >
          +{money(Math.round(gain.n))}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

export function AnimatedNumber({ value, format = (n: number) => String(Math.round(n)), animateOnMount = true, animationKey }: { value: number | undefined; format?: (n: number) => string; animateOnMount?: boolean; animationKey?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef<number | undefined>(animateOnMount ? 0 : value)
  const scope = useRef(animationKey)
  const formatter = useRef(format)
  formatter.current = format
  const reduce = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const next = value !== undefined && Number.isFinite(value) ? value : undefined
    const from = prev.current
    const changedScope = scope.current !== animationKey
    scope.current = animationKey
    if (reduce || changedScope || next === undefined || from === undefined || from === next) {
      el.textContent = next === undefined ? '—' : formatter.current(next)
      prev.current = next
      return
    }
    const c = animate(from, next, {
      duration: 0.18,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (n) => { prev.current = n; el.textContent = formatter.current(n) },
      onComplete: () => { prev.current = next; el.textContent = formatter.current(next) },
    })
    return () => c.stop()
  }, [value, reduce, animationKey])
  return <span ref={ref} className="num">{value === undefined || !Number.isFinite(value) ? '—' : format(value)}</span>
}

export interface Option {
  value: string
  label: string
  hint?: string
  icon?: ReactNode
}

/**
 * 键盘优先的下拉：Tab 进来直接打字筛选，↑↓ 选，Enter 或 Tab 确认；没有匹配时可当场新建。
 */
export function Combobox({
  id,
  value,
  options,
  onChange,
  onCreate,
  placeholder,
  autoFocus,
  className,
  invalid,
  showSelectedIcon = false,
  inlineList = false,
}: {
  id?: string
  value: string
  options: Option[]
  onChange: (v: string) => void
  onCreate?: (label: string) => string | null | Promise<string | null>
  placeholder?: string
  autoFocus?: boolean
  className?: string
  invalid?: boolean
  showSelectedIcon?: boolean
  inlineList?: boolean
}) {
  const selected = options.find((o) => o.value === value)
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const selectedIcon = showSelectedIcon && query === null ? selected?.icon : null

  const q = (query ?? '').trim().toLowerCase()
  const filtered = useMemo(() => (q ? options.filter((o) => fuzzyMatch([o.label, o.hint], q)) : options), [q, options])
  const canCreate = !!onCreate && !!q && !options.some((o) => o.label.toLowerCase() === q)
  const total = filtered.length + (canCreate ? 1 : 0)

  useEffect(() => { setHi(q ? 0 : Math.max(0, options.findIndex(o => o.value === value))) }, [q, value, options, open])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hi])

  function choose(i: number) {
    if (i < filtered.length) { if(filtered[i].value !== value || inlineList) onChange(filtered[i].value) }
    else if (canCreate && onCreate) {
      void Promise.resolve(onCreate((query ?? '').trim())).then((v) => v && onChange(v))
    }
    setQuery(null)
    setOpen(false)
  }

  return (
    <div className={cn('relative', className)}>
      {selectedIcon && <span aria-hidden="true" className="pointer-events-none absolute left-3 top-[18px] flex -translate-y-1/2 items-center">{selectedIcon}</span>}
      <input
        id={id}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox" aria-expanded={open}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20',
          invalid && 'border-danger',
          selectedIcon && 'pl-10',
        )}
        placeholder={placeholder}
        value={query ?? selected?.label ?? ''}
        onFocus={(e) => {
          setOpen(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setOpen(false)
          setQuery(null)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHi((h) => Math.min(h + 1, total - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open && total > 0 && !(e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            choose(hi)
          } else if (e.key === 'Tab' && query !== null && q && total > 0) {
            choose(hi)
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
            setQuery(null)
          }
        }}
      />
      <AnimatePresence>{open && total > 0 && (
        <motion.div initial={{opacity:0,y:-4,scaleY:.96}} animate={{opacity:1,y:0,scaleY:1}} exit={{opacity:0,y:-4,scaleY:.96}} transition={{duration:.18}} style={{transformOrigin:'top'}}
          ref={listRef}
          className={cn('scroll-thin z-50 max-h-60 overflow-auto rounded-md bg-popover p-1', inlineList ? 'relative mt-2' : 'absolute left-0 right-0 top-[calc(100%+4px)] border shadow-lg shadow-black/5')}
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.map((o, i) => (
            <div
              key={o.value}
              data-i={i}
              onMouseEnter={() => setHi(i)}
              onClick={() => choose(i)}
              className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm', i === hi && 'bg-accent')}
            >
              {o.icon}
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              {o.value === value && <Check size={14} className={cn('shrink-0 text-primary', !o.hint && 'ml-auto')} />}
            </div>
          ))}
          {canCreate && (
            <div
              data-i={filtered.length}
              onMouseEnter={() => setHi(filtered.length)}
              onClick={() => choose(filtered.length)}
              className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-primary', hi === filtered.length && 'bg-accent')}
            >
              <Plus size={14} weight="bold" />
              新建「{query?.trim()}」
            </div>
          )}
        </motion.div>
      )}</AnimatePresence>
    </div>
  )
}

export function Field({ label, htmlFor, children, className, required }: { label: string; htmlFor?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
    </div>
  )
}

export const inputCls =
  'flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20'

/** 加载占位：几行闪动的灰条，形状接近真实列表，不再显示「加载中…」文字 */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return <div role="status" aria-label="加载中" className={cn('space-y-3 px-4 py-4', className)}>
    {Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-3" style={{ opacity: 1 - i * 0.12 }}>
      <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none"/>
      <span className="flex-1 space-y-1.5"><span className="block h-3.5 animate-pulse rounded bg-muted motion-reduce:animate-none" style={{ width: `${72 - (i % 3) * 14}%` }}/><span className="block h-3 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none"/></span>
      <span className="h-3.5 w-14 animate-pulse rounded bg-muted motion-reduce:animate-none"/>
    </div>)}
  </div>
}

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center lg:py-14">
      <div className="mb-1 grid h-11 w-11 place-items-center rounded-xl border bg-card text-muted-foreground">{icon}</div>
      <div className="font-medium">{title}</div>
      {hint && <div className="max-w-xs text-sm text-muted-foreground">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** 不在卡片里的页面标题，和 TablePageHeader 同一套字号；sub 是一句短说明，跟在标题后面 */
export function PageHeader({ title, sub, children, className }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 pb-4', className)}>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {sub && <span className="text-sm tabular-nums text-muted-foreground">{sub}</span>}
      {children && <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
