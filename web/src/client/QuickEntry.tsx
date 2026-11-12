import { SelectField } from './SelectField'
import { allocationPolicyForDate } from '@/shared/allocation'
import { writerPayAtRate } from '@/shared/writer-rates'
import { FinancialNote } from './FinancialNote'
import { IntakePayment, validPaidAmount, type IntakePaymentTag } from './IntakePayment'
import { markFresh } from './fresh'
import type { SalesMode } from '@/shared/types'
import { parseMoneyInput } from '@/shared/money-input'
import { PersonChoice } from './PersonChoice'
import { WriterSelect } from './WriterSelect'
import { DateField } from './DatePicker'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { CaretDown, CheckCircle, CircleNotch, ImageSquare, Lightning, Star, UserSwitch, WarningCircle, X } from '@phosphor-icons/react'
import { Tip } from './Tip'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader, useAppDialogDismiss } from '@/components/ui/app-dialog'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Avatar, ChannelAvatar, Combobox, Field, inputCls, type Option } from './ui'
import { addPayment, createChannel, createOrder, salesPeople, setOrderImportance, uploadFiles, useSession } from './store'
import { Thumbs } from './ImageViewer'
import { IMAGE_INPUT_EMPTY_MESSAGE, imageFilesFromTransfer } from './image-input'
import type { ActionResult } from './operation-feedback'
import { imageArrivalClass, useImageReceiveFeedback } from './useImageReceiveFeedback'
import { CopyOrderName } from './CopyOrderName'
import { orderShareName, orderShareText } from '@/shared/order-share-text'
import { ORDER_LEVELS, withOrderLevel, type OrderLevel } from '@/shared/order-level'

async function dataUrlToFile(src: string, base: string) {
  const b = await (await fetch(src)).blob()
  const ext = b.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  return new File([b], `${base}.${ext}`, { type: b.type })
}
import { deadlineFrom, iso, today } from '@/shared/format'
import { type Prefill } from '@/shared/parse'
import { usePref } from './prefs'

type EntryFeedback = { status: 'idle' | 'saving' | 'uploading' | 'success' | 'error' | 'uncertain'; message: string }
type NumberSuggestion = { number: string | null; prefix: string | null; sequence: number | null; ownerId: string; date: string }
type SavedEntry = { id: string; actorId: string; text: string }
const startsWithNumber = (title: string, number: string) => title === number || title.startsWith(`${number} `)
const hasOrderNumber = (title: string) => /^[a-z]{1,12}\d{6,}/i.test(title.trim().replace(/^待定\s*/, ''))

/**
 * 回车依次走过这些位置：层次 → 订单名称 → 渠道 → 销售额 → 已收 → 截止 → 保存按钮。
 * 停在保存按钮上再按一次回车才保存；⇧回车回到上一项；⌘/Ctrl+回车随时直接保存。
 * 写手工资、渠道单号这类不在这条路上的输入框，回车跳到它后面最近的一站。
 */
const ENTER_STOPS = ['q-level', 'q-title', 'q-channel', 'q-price', 'q-paid', 'q-due', 'q-save']
function enterStops() {
  return ENTER_STOPS.map(id => document.getElementById(id)).filter((el): el is HTMLElement => !!el && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0)
}
function focusPrice() {
  if (typeof document === 'undefined') return
  const price = document.getElementById('q-price') as HTMLInputElement | null
  price?.focus()
  price?.select()
}
function focusStep(from: HTMLElement, dir: 1 | -1) {
  const list = enterStops()
  const at = list.indexOf(from)
  const next = at >= 0 ? list[at + dir]
    : dir > 0 ? list.find(el => from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      : [...list].reverse().find(el => from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
  if (!next) return
  next.focus()
  if (next instanceof HTMLInputElement) next.select()
}

interface Row {
  userId: string
  rate?: string | null
  pay: string
}

function blank(ownerId: string, writerId: string, salesMode: SalesMode = 'commission') {
  return {
    title: '',
    level: '' as OrderLevel,
    suggestedNumber: undefined as string | undefined,
    numberOwnerId: undefined as string | undefined,
    numberDate: undefined as string | undefined,
    urgent: false,
    urgencyNote: '',
    important: false,
    importanceNote: '',
    channelId: '',
    ownerId,
    salesMode,
    type: '',
    basePrice: '',
    paidAmount: '',
    paidNote: '',
    paidProof: undefined as string | undefined,
    paymentTag: '定金' as IntakePaymentTag,
    orderDate: iso(today()),
    dueDate: deadlineFrom(iso(today())),
    channelNo: '',
    note: '',
    rows: (writerId ? [{ userId: writerId, pay: '' }] : []) as Row[],
  }
}

function Chip({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button type="button" tabIndex={-1} title={title} onClick={onClick} className="num rounded-full border border-dashed border-input px-2 py-0.5 text-[12px] text-muted-foreground transition-colors hover:border-primary hover:text-primary">
      {children}
    </button>
  )
}

export function QuickEntry({ open, onOpenChange, prefill }: { open: boolean; onOpenChange: (v: boolean) => void; prefill?: Prefill | null }) {
  const [inquiryId,setInquiryId] = useState<string>()
  const { s, me, can, adminIds, views, role } = useSession()
  const admin = role.locked
  const pickWriter = can('order.edit')
  // 默认写手：系统设置里指定的（目前是肖森凯）
  const defaultWriter = s.defaultWriterId ?? ''
  const [f, updateF] = useState(() => blank(me.id, defaultWriter, me.salesMode ?? 'commission'))
  const allocationPolicy = allocationPolicyForDate(iso(today()))
  const writerPool = f.rows.reduce((sum, row) => sum + Math.round((Number(row.pay) || 0) * 100), 0) / 100
  const setF = (next: ReturnType<typeof blank> | ((current: ReturnType<typeof blank>) => ReturnType<typeof blank>)) => updateF(current => {
    const incoming = typeof next === 'function' ? next(current) : next
    const value = incoming.suggestedNumber && !startsWithNumber(incoming.title, incoming.suggestedNumber)
      ? { ...incoming, suggestedNumber: undefined, numberOwnerId: undefined, numberDate: undefined } : incoming
    const price = parseMoneyInput(value.basePrice)
    return { ...value, rows: value.rows.map(row => {
      const rate = row.rate === undefined ? String((s.users.find(u => u.id === row.userId)?.writerRate ?? .2) * 100) : row.rate
      const percent = rate === null ? null : parseMoneyInput(rate, 100)
      return { ...row, rate, pay: percent != null && price != null ? String(writerPayAtRate(price, percent / 100)) : row.pay }
    }) }
  })
  const [more, setMore] = useState(false)
  const [keepGoing, setKeepGoing] = usePref('quick-continue', true)
  const [tried, setTried] = useState(false)
  const [count, setCount] = useState(0)
  const [shots, setShots] = useState<string[]>([])
  const imageFeedback = useImageReceiveFeedback()
  const [filled, setFilled] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ id: string; no: string; title?: string } | null>(null)
  const [readingPayment, setReadingPayment] = useState(false)
  const [readingShots, setReadingShots] = useState(false)
  const shotsReading = useRef(false)
  const noteImages = useRef<HTMLInputElement>(null)
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [channelOpen, setChannelOpen] = useState(false)
  const submitting = useRef(false)
  const createdRef = useRef<{ id: string; no: string; title?: string } | null>(null)
  const remainingFiles = useRef<File[] | null>(null)
  const pendingPayment = useRef<Parameters<typeof addPayment>[1][] | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const levelRef = useRef<HTMLDivElement>(null)
  /** 选完渠道后焦点直接去销售额，按 Esc 关掉选择框时不跳 */
  const advanceAfterChannel = useRef(false)
  const saveWhenReady = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [feedback, setFeedback] = useState<EntryFeedback>({ status: 'idle', message: '' })
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusFrame = useRef<number | null>(null)
  const mounted = useRef(true)
  const reduceMotion = useReducedMotion()
  const [numberHintStatus, setNumberHintStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [lastSavedEntry, setLastSavedEntry] = useState<SavedEntry | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const receiptVisible = useRef(false)
  const hasManualNumber = !f.suggestedNumber && hasOrderNumber(f.title)
  const numberRefreshing = (!!f.suggestedNumber && (f.numberOwnerId !== f.ownerId || f.numberDate !== f.orderDate)) || (numberHintStatus === 'loading' && !hasManualNumber)
  useEffect(() => { if (!open) saveWhenReady.current = false }, [open])
  // 取号期间按了保存：单号一到就接着保存（save 在下面定义，调用时已就绪）
  useEffect(() => {
    if (numberRefreshing || !saveWhenReady.current) return
    saveWhenReady.current = false
    void save()
  }, [numberRefreshing]) // eslint-disable-line react-hooks/exhaustive-deps
  const levelTitle = withOrderLevel(f.title, f.level)
  const suggestedName = orderShareName({ title: levelTitle, type: f.type, pending: f.salesMode !== 'cost' && can('payment.create') && !(Number(f.paidAmount) > 0) })
  const savedEntry = lastSavedEntry?.actorId === me.id ? lastSavedEntry : null
  function clearTimers() {
    if (successTimer.current !== null) clearTimeout(successTimer.current)
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current)
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    successTimer.current = scrollTimer.current = null
    focusFrame.current = null
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimers() } }, [])
  useEffect(() => {
    if (!more || !shots.length) return
    const frame = requestAnimationFrame(() => formRef.current?.querySelector('#q-shots')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }))
    return () => cancelAnimationFrame(frame)
  }, [more, shots.length, reduceMotion])

  /** 把识别结果合进表单；只覆盖识别到的字段。 */
  function apply(p: Prefill) {
    setF((x) => {
      const next = { ...x }
      for (const k of ['title', 'channelId', 'type', 'basePrice', 'dueDate', 'channelNo', 'note'] as const) if (p[k]) next[k] = p[k]!
      if (admin && p.ownerId) next.ownerId = p.ownerId
      next.salesMode = p.salesMode ?? (next.ownerId !== x.ownerId ? s.users.find(u => u.id === next.ownerId)?.salesMode ?? 'commission' : x.salesMode)
      if (allocationPolicy !== 'legacy' && !role.locked) {
        const accountMode = s.users.find(u => u.id === next.ownerId)?.salesMode ?? me.salesMode ?? 'commission'
        if (next.salesMode !== accountMode) {
          next.basePrice = ''; next.paidAmount = ''; next.paidNote = ''; next.paidProof = undefined
        }
        next.salesMode = accountMode
      }
      // 普通消息里的报价是客户总价，不能拿来当销售应付底价。
      if (next.salesMode === 'cost' && p.salesMode !== 'cost') next.basePrice = next.salesMode === x.salesMode ? x.basePrice : ''
      if (next.salesMode !== x.salesMode) { next.paidAmount = ''; next.paidNote = ''; next.paidProof = undefined }
      return next
    })
    if (p.shots?.length) setShots((x) => [...x, ...p.shots!])
    const got = [p.title && '名称', p.channelId && '渠道', p.type && '类型', p.basePrice && '原价', p.dueDate && '截止', p.channelNo && '渠道单号'].filter(Boolean)
    if (p.source) setFilled(got.length ? `${p.source}：已填 ${got.join('、')}，核对后保存` : p.shots?.length ? '截图已附加，请填写订单信息' : `${p.source}：没认出字段，先放进备注`)
  }

  useEffect(() => {
    clearTimers()
    if (open) {
      setReceiptOpen(false)
      receiptVisible.current = false
      setFeedback({ status: 'idle', message: '' })
      setBusy(false)
      submitting.current = false
      setF(blank(me.id, defaultWriter, me.salesMode ?? 'commission'))
      setMore(false)
      setOwnerOpen(false)
      setChannelOpen(false)
      setTried(false)
      setCount(0)
      setShots([])
      setFilled('')
      setCreated(null)
      createdRef.current = null
      remainingFiles.current = null
      pendingPayment.current = null
      setInquiryId(prefill?.inquiryId)
      if (prefill) apply(prefill)
      scrollTimer.current = setTimeout(() => { scrollTimer.current = null; formRef.current?.scrollTo(0, 0) }, 60)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, me.id])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let active = true
    const ownerId = f.ownerId, date = f.orderDate
    setNumberHintStatus('loading')
    const clearAutomaticNumber = () => setF(current => {
      if (current.ownerId !== ownerId || current.orderDate !== date || !current.suggestedNumber) return current
      const title = startsWithNumber(current.title, current.suggestedNumber) ? current.title.slice(current.suggestedNumber.length).trimStart() : current.title
      return { ...current, title, suggestedNumber: undefined, numberOwnerId: undefined, numberDate: undefined }
    })
    void fetch(`/api/orders/number-suggestion?${new URLSearchParams({ ownerId, date })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('单号暂未获取')
        const suggestion = await response.json() as NumberSuggestion
        if (suggestion.ownerId !== ownerId || suggestion.date !== date) throw new Error('单号已变化')
        if (!active || createdRef.current) return
        setNumberHintStatus('idle')
        if (!suggestion.number) { clearAutomaticNumber(); return }
        setF(current => {
          if (current.ownerId !== ownerId || current.orderDate !== date) return current
          // Only replace a prefix still owned by the form. Manual numbers and
          // names typed while the request was in flight remain intact.
          const automatic = current.suggestedNumber && startsWithNumber(current.title, current.suggestedNumber)
          if (!automatic && hasOrderNumber(current.title)) return current
          const suffix = automatic ? current.title.slice(current.suggestedNumber!.length) : ` ${current.title.trim()}`
          return { ...current, title: suggestion.number! + suffix, suggestedNumber: suggestion.number!, numberOwnerId: ownerId, numberDate: date }
        })
      })
      .catch(() => {
        if (!active || createdRef.current) return
        setNumberHintStatus('error')
        clearAutomaticNumber()
      })
    return () => { active = false; controller.abort() }
    // 只在录单人、日期或下一单变化时取号；输入名称不触发请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, f.ownerId, f.orderDate, count, me.id])

  async function addShots(files: File[]) {
    if (submitting.current || createdRef.current) return
    if (shotsReading.current) { toast('图片读取中，请稍候'); return }
    if (!files.length) { toast.error(IMAGE_INPUT_EMPTY_MESSAGE); return }
    shotsReading.current = true
    setReadingShots(true)
    setMore(true)
    try {
      const next = await Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败，请重试'))
        reader.onerror = reader.onabort = () => reject(new Error('图片读取失败，请重试'))
        reader.readAsDataURL(file)
      })))
      setShots(old => [...old, ...next])
      imageFeedback.acknowledge()
    } catch (error) { toast.error(error instanceof Error ? error.message : '图片读取失败，请重试') }
    finally { shotsReading.current = false; setReadingShots(false) }
  }

  // 文字直接粘进当前输入框，截图附到这单，不擅自覆盖手填字段。
  function onPaste(e: React.ClipboardEvent) {
    const imgs = imageFilesFromTransfer(e.clipboardData)
    if (!imgs.length) return
    e.preventDefault(); e.stopPropagation()
    void addShots(imgs)
  }

  // 历史价格：同渠道同类型最常见的几个价，没有就看同类型
  const priceHints = useMemo(() => {
    if (!f.type) return []
    const pick = (list: typeof views) => {
      const m = new Map<number, number>()
      list.forEach((o) => o.basePrice !== undefined && m.set(o.basePrice, (m.get(o.basePrice) ?? 0) + 1))
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p)
    }
    const candidates = views.filter(o => (o.salesMode ?? 'commission') === f.salesMode && o.type === f.type)
    const same = candidates.filter(o => !f.channelId || o.channelId === f.channelId)
    return pick(same.length ? same : candidates)
  }, [views, f.type, f.channelId, f.salesMode])



  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF((x) => ({ ...x, [k]: v }))

  // 代录：销售替暂停接单（头像变灰）的同事录单，用那个人的渠道，代录费按实收 5% 从他提成里扣给自己
  const proxyTargets = admin ? [] : s.users.filter(u => u.isSales && !u.isAdmin && u.active !== false && !!u.pausedAt && u.id !== me.id)
  const proxying = !admin && f.ownerId !== me.id
  const channelPool = useMemo(() => proxying ? (s.proxyChannels ?? []).filter(c => c.ownerId === f.ownerId) : s.channels, [proxying, s.proxyChannels, s.channels, f.ownerId])
  const channelOpts: Option[] = useMemo(
    () =>
      channelPool.map((c) => ({ value: c.id, label: c.name, hint: s.users.find((u) => u.id === c.ownerId)?.name, icon: <ChannelAvatar channel={c} size={18} /> })),
    [channelPool, s.users],
  )
  const typeOpts: Option[] = s.types.map((t) => ({ value: t, label: t }))
  const selectedChannel = channelPool.find(c => c.id === f.channelId)
  const owner = s.users.find(u => u.id === f.ownerId) ?? me
  function chooseProxy(ownerId: string) {
    setF(x => {
      if (ownerId === x.ownerId) return x
      const salesMode = s.users.find(u => u.id === ownerId)?.salesMode ?? 'commission'
      return { ...x, ownerId, channelId: '', salesMode, ...(salesMode !== x.salesMode ? { basePrice: '', paidAmount: '', paidNote: '', paidProof: undefined } : {}) }
    })
    setOwnerOpen(false)
  }
  // A generated prefix is a starting point, not an entered order name. A
  // manually supplied number has no suggestedNumber and keeps its old meaning.
  const enteredTitle = f.suggestedNumber && startsWithNumber(f.title, f.suggestedNumber)
    ? f.title.slice(f.suggestedNumber.length).trim() : f.title.trim()

  const missing = {
    title: !enteredTitle,
    channelId: f.salesMode !== 'cost' && !f.channelId,
    basePrice: parseMoneyInput(f.basePrice) == null,
  }
  const invalid = Object.values(missing).some(Boolean)

  async function save() {
    if(readingPayment || shotsReading.current)return
    if (submitting.current) return
    // 选完渠道、改了归属或日期会重新拿单号：这时按保存先记下，单号回来自动保存，回车不会被吞掉
    if (numberRefreshing) { saveWhenReady.current = true; setFeedback({ status: 'saving', message: '正在获取单号，拿到后自动保存' }); return }
    setTried(true)
    if (invalid) {
      toast.error(f.salesMode === 'cost' ? '请填写订单名称和销售应付底价' : '请填写订单名称、渠道和销售额')
      return
    }
    // 销售只选人，工资留给管理员定（新制度由服务端自动分）
    const writers = f.rows.filter(r => r.userId).map(r => {
      const percent = r.rate === undefined ? (s.users.find(u => u.id === r.userId)?.writerRate ?? .2) * 100 : r.rate === null ? null : parseMoneyInput(r.rate, 100)
      return { userId: r.userId, pay: !admin ? null : parseMoneyInput(r.pay, 1_000_000), ...(admin ? { rate: percent === undefined ? undefined : percent === null ? null : percent / 100 } : {}) }
    })
    if (admin && f.rows.some(r => r.rate !== null && r.rate !== undefined && parseMoneyInput(r.rate, 100) == null)) { toast.error('写手比例请填写 0–100，最多两位小数'); return }
    const invalidWriter = writers.find(r => r.pay === undefined)
    if (invalidWriter) {
      toast.error(`${s.users.find(u => u.id === invalidWriter.userId)?.name ?? '写手'}的工资格式不正确，最多两位小数`)
      return
    }
    if (can('payment.create') && !validPaidAmount(f.paidAmount)) {
      toast.error('请填写有效的已付金额，最多两位小数')
      return
    }
    if (can('payment.create') && Number(f.paidAmount) > 0 && !role.locked && !f.paidNote.trim() && !f.paidProof) {
      toast.error('请填写收款备注或粘贴截图'); return
    }
    submitting.current = true
    setBusy(true)
    const outcome: { result?: ActionResult } = {}
    const options = { silent: true, onResult: (result: ActionResult) => { outcome.result = result } }
    let stage: 'create' | 'payment' | 'prepare' | 'upload' = createdRef.current ? 'payment' : 'create'
    function failed(message: string, uncertainMessage: string) {
      const uncertain = outcome.result?.status !== 'error'
      setFeedback({ status: uncertain ? 'uncertain' : 'error', message: uncertain ? uncertainMessage : message })
    }
    try {
      if (!createdRef.current) setFeedback({ status: 'saving', message: '正在创建订单' })
      const o = createdRef.current ?? await createOrder({
        title: levelTitle,
        inquiryId,
        ...(f.suggestedNumber ? { suggestedNumber: f.suggestedNumber } : {}),
        urgent: f.urgent,
        urgencyNote: f.urgencyNote,
        orderDate: f.orderDate,
        dueDate: f.dueDate || deadlineFrom(f.orderDate),
        ownerId: f.ownerId,
        ...(proxying ? { proxy: true } : {}),
        channelId: f.salesMode === 'cost' ? '' : f.channelId,
        salesMode: f.salesMode,
        channelNo: f.channelNo,
        type: f.type,
        basePrice: parseMoneyInput(f.basePrice)!,
        assignees: writers as { userId: string; pay: number | null; rate?: number | null }[],
        note: f.note,
      }, undefined, options)
      if (!mounted.current) return
      if (!o) {
        failed(`订单创建失败${outcome.result?.message ? `：${outcome.result.message}` : ''}，填写内容已保留`, '创建结果待确认，填写内容已保留；请先在订单列表核对，再手动重试')
        return
      }
      createdRef.current = o
      if(inquiryId) window.dispatchEvent(new CustomEvent('bxsh:inquiry-converted',{detail:{id:inquiryId,orderId:o.id}}))
      setInquiryId(undefined)
      setCreated(o)
      if (o.title) setF(current => ({ ...current, title: o.title!, suggestedNumber: undefined, numberOwnerId: undefined, numberDate: undefined }))
      // 建单接口不带「重要」，建好后沿用订单里星标的同一个操作（会通知写手）；重复保存时同样的说明不会重复记录
      if (f.important) {
        const marked = await setOrderImportance(o.id, true, f.importanceNote.trim())
        if (!mounted.current) return
        if (!marked) toast.error('订单已保存，但「重要」没标上，请在订单里点一下星标')
      }
      pendingPayment.current ??= can('payment.create') && Number(f.paidAmount) > 0
        ? [{ amount: Number(f.paidAmount), date: iso(today()), tag: f.paymentTag, note: f.paidNote.trim(), proof: f.paidProof }] : []
      if (pendingPayment.current.length) {
        stage = 'payment'
        outcome.result = undefined
        setFeedback({ status: 'saving', message: '正在保存收款' })
        const saved = await addPayment(o.id, pendingPayment.current[0], options)
        if (!mounted.current) return
        if (!saved) {
          failed('订单已创建，收款保存失败；内容已保留，请继续保存', '订单已创建，收款结果待确认；请继续保存核对同一笔收款')
          return
        }
        pendingPayment.current.shift()
      }
      // 重试始终复用已创建的订单、同一笔收款和尚未成功的文件对象。
      stage = 'prepare'
      if (shots.length && !remainingFiles.current) setFeedback({ status: 'saving', message: '正在准备截图' })
      remainingFiles.current ??= await Promise.all(shots.map((src, i) => dataUrlToFile(src, `录单截图${i + 1}`)))
      if (!mounted.current) return
      while (remainingFiles.current.length) {
        stage = 'upload'
        outcome.result = undefined
        const position = shots.length - remainingFiles.current.length + 1
        setFeedback({ status: 'uploading', message: `正在上传第 ${position}/${shots.length} 张截图` })
        const uploaded = await uploadFiles([remainingFiles.current[0]], { orderId: o.id }, options)
        if (!mounted.current) return
        if (!uploaded) {
          failed(`订单已创建，第 ${position}/${shots.length} 张截图上传失败；请继续保存`, `订单已创建，第 ${position}/${shots.length} 张截图结果待确认；请继续保存核对剩余截图`)
          return
        }
        remainingFiles.current.shift()
      }
      setFeedback({ status: 'success', message: '已完成，订单及填写的收款、截图均已保存' })
      markFresh([o.id])
      const shareText = orderShareText({ title: o.title ?? levelTitle, type: f.type, total: parseMoneyInput(f.basePrice) ?? null, paid: can('payment.create') ? Number(f.paidAmount) || 0 : null, paymentTag: f.paymentTag, salesMode: f.salesMode })
      setLastSavedEntry({ id: o.id, actorId: me.id, text: shareText })
      receiptVisible.current = true
      setReceiptOpen(true)
      successTimer.current = setTimeout(() => {
        successTimer.current = null
        submitting.current = false
        setBusy(false)
        if (keepGoing) {
          setF((x) => ({ ...blank(me.id, defaultWriter, me.salesMode ?? 'commission'), orderDate: x.orderDate, dueDate: deadlineFrom(x.orderDate), channelId: x.channelId, ownerId: x.ownerId, salesMode: x.salesMode, type: x.type }))
          setShots([])
          setMore(false)
          setFilled('')
          setCreated(null)
          createdRef.current = null
          remainingFiles.current = null
          pendingPayment.current = null
          setTried(false)
          setCount((c) => c + 1)
          setFeedback({ status: 'idle', message: '' })
          if (!receiptVisible.current) focusFrame.current = requestAnimationFrame(() => { focusFrame.current = null; levelRef.current?.focus() })
        } else onOpenChange(false)
      }, 800)
    } catch {
      if (!mounted.current) return
      if (stage === 'prepare') setFeedback({ status: 'error', message: '订单已创建，截图读取失败；图片已保留，请继续保存' })
      else failed('保存失败，填写内容已保留，请继续保存', createdRef.current ? '订单已创建，剩余收款或截图结果待确认；请继续保存核对' : '创建结果待确认，填写内容已保留；请先在订单列表核对，再手动重试')
    } finally {
      if (mounted.current && successTimer.current === null) {
        submitting.current = false
        setBusy(false)
      }
    }
  }

  const shotOccurrences = new Map<string, number>()
  const shotKeys = shots.map(src => { const occurrence = shotOccurrences.get(src) ?? 0; shotOccurrences.set(src, occurrence + 1); return `${src}:${occurrence}` })

  const dismiss = useAppDialogDismiss({ dirty: false, blocked: busy || readingShots || readingPayment || !!pendingPayment.current?.length, onOpenChange: next => {
    if (!submitting.current && !shotsReading.current && !pendingPayment.current?.length) onOpenChange(next)
  } })
  return (
    <>
    <Dialog open={open} onOpenChange={dismiss.requestOpenChange}>
      <AppDialogContent size="md" data-quick-entry-dialog
        onCloseAutoFocus={event => { if (receiptVisible.current) event.preventDefault() }}
        onPaste={onPaste}
        onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); void addShots(imageFilesFromTransfer(e.dataTransfer)) }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.altKey || e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            save()
            return
          }
          const el = e.target as HTMLElement
          // 多行备注换行；渠道、日期等弹出的选择框自己处理回车；停在保存按钮上的回车就是点保存
          if (el.tagName === 'TEXTAREA' || el.closest('[data-radix-popper-content-wrapper]') || el.id === 'q-save') return
          // 还没选渠道时，回车打开渠道选择
          if (el.id === 'q-channel' && !f.channelId && !e.shiftKey) return
          // 其他按钮（加急、常用价、更多信息）保持原来的点击
          if (el.tagName === 'BUTTON' && !ENTER_STOPS.includes(el.id)) return
          if (el.tagName !== 'INPUT' && !ENTER_STOPS.includes(el.id)) return
          e.preventDefault()
          focusStep(el, e.shiftKey ? -1 : 1)
        }}
      >
        <AppDialogHeader className="flex items-center justify-between py-3.5">
          <div>
            <DialogTitle className="text-base">录单</DialogTitle>
            <DialogDescription className="sr-only">新增订单</DialogDescription>
          </div>
          <div className="mr-6 flex items-center gap-3">
          <AnimatePresence>
            {count > 0 && (
              <motion.span initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                本次已录 <span className="num">{count}</span> 单
              </motion.span>
            )}
          </AnimatePresence>
          {/* 归属销售默认就是录单人，很少改：放在标题栏边上，不占表单位置、不进回车顺序 */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>归属</span>
            {admin ? <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
              <PopoverTrigger asChild><button id="q-owner" type="button" tabIndex={-1} aria-label={`归属销售：${owner.name}，点击更换`} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent hover:text-foreground data-[state=open]:bg-accent">
                <Avatar user={owner} size={18} />{owner.name}<CaretDown size={10}/>
              </button></PopoverTrigger>
              <PopoverContent align="end" className="w-[min(320px,calc(100vw-48px))] p-3">
                <PersonChoice showSalesMode label="选择归属销售" people={salesPeople(s)} value={f.ownerId} onChange={ownerId => {
                  setF(x => {
                    if (ownerId === x.ownerId) return x
                    const salesMode = s.users.find(u => u.id === ownerId)?.salesMode ?? 'commission'
                    return { ...x, ownerId, salesMode, ...(salesMode !== x.salesMode ? { basePrice: '', paidAmount: '', paidNote: '', paidProof: undefined } : {}) }
                  })
                  setOwnerOpen(false)
                }}/>
              </PopoverContent>
            </Popover> : <span className="inline-flex items-center gap-1 px-1.5 py-1"><Avatar user={owner} size={18} />{owner.name}</span>}
            {/* 代录：替暂停接单（头像变灰）的同事录，用他的渠道，代录费按实收 5% 从他提成里分给自己 */}
            {proxying && <Tip label="代录：按实收 5% 从他提成里分给你"><span className="rounded bg-primary/10 px-1.5 leading-5 text-primary">代录</span></Tip>}
            {!admin && (proxying
              ? <Tip label="不代录"><button type="button" tabIndex={-1} aria-label="不代录" className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground" onClick={() => chooseProxy(me.id)}><X size={13}/></button></Tip>
              : !!proxyTargets.length && <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
                <Tip label="替暂停的同事代录"><PopoverTrigger asChild><button type="button" tabIndex={-1} aria-label="替暂停的同事代录" className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"><UserSwitch size={16}/></button></PopoverTrigger></Tip>
                <PopoverContent align="end" className="w-[min(320px,calc(100vw-48px))] p-3">
                  <PersonChoice label="选择暂停的销售" people={proxyTargets} value={f.ownerId} onChange={chooseProxy}/>
                </PopoverContent>
              </Popover>)}
          </div>
          </div>
        </AppDialogHeader>

        {created && <div className="border-b bg-primary/[0.06] px-5 py-2 text-xs text-primary">{f.title.trim() || '这一单'} 的订单信息已保存。</div>}
        <AppDialogBody asChild className="scroll-thin grid touch-pan-y grid-cols-2 content-start gap-x-3 gap-y-3.5 px-4 py-4 sm:px-5">
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <fieldset className="contents" disabled={busy || readingPayment || readingShots || !!created}>
          <AnimatePresence>
            {filled && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="col-span-2 overflow-hidden">
                <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2 text-xs text-primary">
                  <span className="min-w-0 flex-1">{filled}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="col-span-2 flex flex-wrap items-center gap-2">
            <span id="q-level-label" className="text-xs font-medium text-muted-foreground">层次</span>
            {/* 先选层次：按 Z 专科、B 本科、N 不标，选完自动跳到订单名称；回车保持当前选择 */}
            <div id="q-level" ref={levelRef} role="radiogroup" aria-labelledby="q-level-label" tabIndex={0} autoFocus
              onKeyDown={(e) => {
                const k = e.key.toLowerCase()
                const hit = ORDER_LEVELS.find(l => l.keys.includes(k))
                const at = ORDER_LEVELS.findIndex(l => l.value === f.level)
                if (hit && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); set('level', hit.value); titleRef.current?.focus(); return }
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); set('level', ORDER_LEVELS[(at + (e.key === 'ArrowRight' ? 1 : ORDER_LEVELS.length - 1)) % ORDER_LEVELS.length].value) }
              }}
              className="inline-flex rounded-lg border p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {ORDER_LEVELS.map(l => (
                <button key={l.label} type="button" role="radio" aria-checked={f.level === l.value} tabIndex={-1}
                  onClick={() => { set('level', l.value); titleRef.current?.focus() }}
                  className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors', f.level === l.value ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  {l.label}<span className="kbd hidden sm:inline">{l.keys[0].toUpperCase()}</span>
                </button>
              ))}
            </div>
            {f.level && <span className="text-xs text-muted-foreground">订单名会加上「{f.level}」</span>}
          </div>
          <Field label="订单名称" htmlFor="q-title" required className="col-span-2">
            <div className="relative">
            <input
              id="q-title"
              ref={titleRef}
              className={cn(inputCls, 'pr-12 text-base', tried && missing.title && 'border-danger')}
              placeholder="例如：乡村振兴背景下县域电商发展路径"
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
            />
            <div className="absolute inset-y-0 right-1 flex items-center">
              {numberRefreshing ? <span role="status" aria-label="正在获取单号" className="grid h-9 w-9 place-items-center text-muted-foreground"><CircleNotch size={16} className={reduceMotion ? '' : 'animate-spin'}/></span>
                : f.title.trim() && <CopyOrderName title={suggestedName} className="h-9 w-9 text-primary"/>}
            </div>
            </div>
            {numberHintStatus === 'error' && <p className="mt-1 text-xs text-muted-foreground">暂未获取到单号，可手动填写名称</p>}
            {levelTitle && levelTitle !== f.title.trim() && <p className="mt-1 truncate text-xs text-muted-foreground" title={levelTitle}>保存为：<span className="text-foreground">{levelTitle}</span></p>}
          </Field>
          {f.salesMode !== 'cost' && <Field label="渠道" htmlFor="q-channel" required className="col-span-2">
            <Popover open={channelOpen} onOpenChange={setChannelOpen}>
              <PopoverTrigger asChild><button id="q-channel" type="button" aria-label={selectedChannel ? `更换渠道：${selectedChannel.name}` : '选择渠道'} aria-invalid={tried && missing.channelId}
                className={cn('flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40', tried && missing.channelId && 'ring-1 ring-danger')}>
                {selectedChannel ? <><ChannelAvatar channel={selectedChannel} size={24}/><span className="min-w-0 truncate">{selectedChannel.name}</span></> : <span className="text-muted-foreground">选择渠道</span>}
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground">{selectedChannel && '更换'}<CaretDown size={12}/></span>
              </button></PopoverTrigger>
              <PopoverContent align="start" className="w-[min(320px,calc(100vw-48px))] p-3"
                onCloseAutoFocus={e => { if (!advanceAfterChannel.current) return; advanceAfterChannel.current = false; e.preventDefault(); if (document.activeElement?.id !== 'q-price') focusPrice() }}>
                <Combobox autoFocus inlineList id="q-channel-search" value={f.channelId} options={channelOpts} placeholder="搜索或新建渠道"
                  // 选中当下就把焦点交给销售额：不等选择框收起动画，免得接着输的金额落进渠道搜索、回车又新建出一个渠道
                  onChange={channelId => { set('channelId', channelId); advanceAfterChannel.current = true; setChannelOpen(false); focusPrice() }}
                  onCreate={proxying ? undefined : async label => (await createChannel(label, admin ? f.ownerId : me.id))?.id ?? null}/>
              </PopoverContent>
            </Popover>
          </Field>}
          <div className="col-span-2 grid grid-cols-2 items-start gap-x-3 gap-y-2">
          <Field label={f.salesMode === 'cost' ? '销售应付底价' : '销售额'} htmlFor="q-price" required className="col-span-1">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">¥</span>
              <input
                id="q-price"
                inputMode="decimal"
                className={cn(inputCls, 'num pl-7 text-right', tried && missing.basePrice && 'border-danger')}
                placeholder="0"
                value={f.basePrice}
                onChange={(e) => set('basePrice', e.target.value)}
              />
            </div>
            {priceHints.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[12px] text-muted-foreground">常用价</span>
                {priceHints.map((p) => (
                  <Chip key={p} onClick={() => set('basePrice', String(p))}>
                    ¥{p}
                  </Chip>
                ))}
              </div>
            )}
          </Field>

          {can('payment.create') && <div className="col-span-1 min-w-0">
            <IntakePayment stacked quickPercentages label={f.salesMode === 'cost' ? '销售已付' : f.paymentTag === '全款' ? '已收全款' : '已收定金'} id="q-paid" amount={f.paidAmount} tag={f.paymentTag} total={f.basePrice === '' ? null : Number(f.basePrice)} invalid={tried && !validPaidAmount(f.paidAmount)} onChange={(paidAmount, paymentTag) => setF(x => ({ ...x, paidAmount, paymentTag }))} />
          </div>}
          {/* 销售记收款必须附备注或截图，留在原位；管理员可空，收进「更多信息」 */}
          {can('payment.create') && !role.locked && Number(f.paidAmount) > 0 && <div className="col-span-2"><FinancialNote note={f.paidNote} proof={f.paidProof} onNote={paidNote => set('paidNote', paidNote)} onProof={paidProof => set('paidProof', paidProof)} onReading={setReadingPayment} disabled={busy || readingPayment || !!created} required={!role.locked} /></div>}
          </div>

          {pickWriter && (
            <div className="col-span-2 grid gap-1.5">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span>{admin ? '写手与工资' : '写手'}</span>{admin && f.basePrice && <span aria-label="写手工资合计" className="ml-auto tabular-nums text-primary">合计 ¥{writerPool}</span>}</div>
              <WriterSelect
                people={s.users.filter(u => u.canWrite && u.active !== false)}
                selected={s.users.filter(u => f.rows.some(row => row.userId === u.id))}
                disabled={busy || readingPayment || readingShots || !!created}
                onToggle={id => setF(current => ({ ...current, rows: current.rows.some(row => row.userId === id)
                  ? current.rows.filter(row => row.userId !== id)
                  : [...current.rows, { userId: id, pay: adminIds.has(id) ? '0' : '' }] }))}
                renderPay={person => admin && <div className="flex items-center gap-1.5">
                  <div className="relative w-20">
                    <input aria-label={`${person.name}的写手比例`} inputMode="decimal" className={cn(inputCls, 'num h-8 pr-6 text-right')} placeholder="按金额"
                      value={f.rows.find(row => row.userId === person.id)?.rate ?? (f.rows.find(row => row.userId === person.id)?.rate === null ? '' : String((s.users.find(u => u.id === person.id)?.writerRate ?? .2) * 100))}
                      onChange={event => { const rate = event.target.value; setF(current => ({ ...current, rows: current.rows.map(row => row.userId === person.id ? { ...row, rate: rate === '' ? null : rate } : row) })) }}/>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                  <div className="relative w-24">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">¥</span>
                    <input aria-label={`${person.name}的写手工资`} aria-invalid={tried && parseMoneyInput(f.rows.find(row => row.userId === person.id)?.pay ?? '', 1_000_000) === undefined} inputMode="decimal" className={cn(inputCls, 'num h-8 pl-5 text-right')} placeholder="未定"
                      value={f.rows.find(row => row.userId === person.id)?.pay ?? ''}
                      onChange={event => { const pay = event.target.value; setF(current => ({ ...current, rows: current.rows.map(row => row.userId === person.id ? { ...row, rate: null, pay } : row) })) }}/>
                  </div>
                </div>}

              />


            </div>
          )}

          {!pickWriter && (
            <div className="col-span-2 flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              写手默认 <Avatar user={s.users.find((u) => u.id === defaultWriter)} size={18} /> {s.users.find((u) => u.id === defaultWriter)?.name}
            </div>
          )}
          <div className="col-span-2 grid gap-2 rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><label htmlFor="q-due" className="text-xs font-medium">截止日期</label><button type="button" aria-pressed={f.urgent} onClick={() => set('urgent', !f.urgent)} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', f.urgent ? 'border-warn/40 bg-warn/10 font-medium text-warn' : 'border-transparent text-muted-foreground hover:bg-accent')}><Lightning size={12} weight={f.urgent ? 'fill' : 'regular'}/>加急</button><button type="button" aria-pressed={f.important} onClick={() => set('important', !f.important)} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', f.important ? 'border-warn/40 bg-warn/10 font-medium text-warn' : 'border-transparent text-muted-foreground hover:bg-accent')}><Star size={12} weight={f.important ? 'fill' : 'regular'}/>重要</button></div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <label htmlFor="q-date">下单</label>
                <DateField aria-label="下单日期" required id="q-date" className="num h-7 w-auto border-transparent bg-transparent px-1.5 text-xs text-muted-foreground shadow-none hover:bg-accent" value={f.orderDate} onChange={(e) => { const orderDate = e.target.value; if (orderDate) setF(x => ({ ...x, orderDate, dueDate: deadlineFrom(orderDate) })) }} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DateField aria-label="截止日期" required id="q-due" className={cn(inputCls, 'num min-w-40 flex-1 border-primary/30')} value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
              <div className="flex flex-wrap gap-1">
                {[1, 7, 15, 30].map((n) => (
                  <Chip key={n} onClick={() => set('dueDate', deadlineFrom(f.orderDate, n))}>
                    {n} 天
                  </Chip>
                ))}
              </div>
            </div>
          </div>

          {f.urgent && <input aria-label="加急说明" maxLength={500} value={f.urgencyNote} onChange={e => set('urgencyNote', e.target.value)} className={cn(inputCls, 'col-span-2 border-warn/30')} placeholder="加急说明（可选）"/>}
          {f.important && <input aria-label="重要说明" maxLength={500} value={f.importanceNote} onChange={e => set('importanceNote', e.target.value)} className={cn(inputCls, 'col-span-2 border-warn/30')} placeholder="重要说明（可选），会通知写手"/>}
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} aria-controls="q-more" className="col-span-2 flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <CaretDown size={12} className={cn('transition-transform', more && 'rotate-180')} /> 更多信息
          </button>
          <AnimatePresence initial={false}>
            {more && (
              <motion.div id="q-more" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} onAnimationComplete={(d) => { if ((d as { height?: string }).height === 'auto') formRef.current?.querySelector(shots.length ? '#q-shots' : '#q-note')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }) }} className="col-span-2 grid grid-cols-2 gap-3 overflow-hidden p-0.5">
                {can('payment.create') && role.locked && Number(f.paidAmount) > 0 && <div className="col-span-2"><FinancialNote note={f.paidNote} proof={f.paidProof} onNote={paidNote => set('paidNote', paidNote)} onProof={paidProof => set('paidProof', paidProof)} onReading={setReadingPayment} disabled={busy || readingPayment || !!created} /></div>}
                <Field label="备注 / 补充要求" htmlFor="q-note" className="col-span-2">
                  <div className="relative">
                    <textarea id="q-note" rows={3} className={cn(inputCls, 'h-auto resize-y py-2 pr-10', imageFeedback.className)} placeholder="补充要求，或直接粘贴截图" value={f.note} onChange={(e) => set('note', e.target.value)} />
                    <button type="button" aria-label="上传补充截图" title="上传截图" disabled={busy || readingShots || !!created} onClick={() => noteImages.current?.click()} className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-40"><ImageSquare size={18}/></button>
                    <input ref={noteImages} type="file" multiple accept="image/*" aria-label="补充截图文件" className="sr-only" disabled={busy || readingShots || !!created} onChange={event => { const files = imageFilesFromTransfer({ files: event.target.files! } as DataTransfer); event.target.value = ''; if (files.length) void addShots(files) }}/>
                  </div>
                  {readingShots && <span role="status" className="text-xs text-muted-foreground">正在读取截图…</span>}
                  {!!shots.length && <div id="q-shots" className="flex min-w-0 flex-wrap gap-2 py-1">{shots.map((src, i) => <div key={shotKeys[i]} className={cn("relative", imageArrivalClass)}>
                    <Thumbs pics={[{ src, name: `录单截图${i + 1}` }]} imgClass="h-16 w-16" />
                    <button type="button" aria-label={`移除录单截图 ${i + 1}`} disabled={busy || readingShots || !!created} className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border bg-card text-muted-foreground hover:text-danger disabled:opacity-40"
                      onClick={() => { if (submitting.current || shotsReading.current || createdRef.current) return; setShots(old => old.filter((_, index) => index !== i)) }}><X size={12}/></button>
                  </div>)}</div>}
                </Field>
                <Field label="渠道单号" htmlFor="q-cno" className="col-span-2 sm:col-span-1">
                  <input id="q-cno" className={cn(inputCls, 'num')} value={f.channelNo} onChange={(e) => set('channelNo', e.target.value)} />
                </Field>
                <Field label="订单类型" htmlFor="q-type" className="col-span-2 sm:col-span-1">
                  <Combobox id="q-type" value={f.type} options={typeOpts} placeholder="选择或输入新类型" onChange={(v) => set('type', v)} onCreate={(l) => l} />
                </Field>
                <Field label="本单结算方式" htmlFor="q-mode" className="col-span-2">
                  <SelectField id="q-mode" disabled={!role.locked && allocationPolicy !== 'legacy'} className={inputCls} value={f.salesMode} onChange={e => setF(x => x.salesMode === e.target.value ? x : { ...x, salesMode: e.target.value as SalesMode, basePrice: '', paidAmount: '', paidNote: '', paidProof: undefined })}>
                    <option value="commission">提成订单</option><option value="cost">底价订单</option>
                  </SelectField>
                </Field>
              </motion.div>
            )}
          </AnimatePresence>
          <button type="submit" className="hidden" />
          </fieldset>
        </form>
        </AppDialogBody>

        <AppDialogFooter className="block bg-muted/40 px-4 sm:px-5">
          <div id="q-save-feedback" role={feedback.status === 'error' ? 'alert' : 'status'} aria-live={feedback.status === 'error' ? 'assertive' : 'polite'} aria-atomic="true"
            className={cn('mb-2 flex min-h-4 items-start gap-1.5 text-xs', feedback.status === 'error' ? 'text-danger' : feedback.status === 'uncertain' ? 'text-warn' : feedback.status === 'success' ? 'text-primary' : 'text-muted-foreground')}>
            {feedback.status === 'success' ? <CheckCircle aria-hidden size={15} weight="fill" className="shrink-0" />
              : feedback.status === 'error' || feedback.status === 'uncertain' ? <WarningCircle aria-hidden size={15} className="shrink-0" />
                : feedback.status !== 'idle' ? <CircleNotch aria-hidden size={15} className={cn('shrink-0', !reduceMotion && 'animate-spin')} /> : null}
            <span>{feedback.message}</span>
          </div>
          <div className="flex items-center justify-between gap-2 sm:flex-wrap sm:gap-3">
          <span className="hidden text-xs text-muted-foreground lg:inline" aria-hidden><span className="kbd">↵</span> 下一项 · <span className="kbd">⇧↵</span> 上一项 · 停在保存上再按 <span className="kbd">↵</span> 录入</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox id="q-keep" disabled={busy} checked={keepGoing} onCheckedChange={(v) => setKeepGoing(!!v)} />
            <span className="sm:hidden">连续录单</span><span className="hidden sm:inline">保存后继续录下一单</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="h-10 sm:h-8" disabled={busy || readingShots || !!pendingPayment.current?.length} onClick={() => dismiss.requestOpenChange(false)}>
              {created ? '关闭（订单已保存）' : '取消'}
            </Button>
            <Button id="q-save" size="sm" onClick={save} disabled={busy || readingPayment || readingShots} aria-busy={busy && feedback.status !== 'success'} aria-describedby="q-save-feedback" className="h-10 gap-2 px-5 sm:h-8 sm:px-3">
              {feedback.status === 'success' ? '已完成' : busy ? '保存中…' : created ? '继续保存' : feedback.status === 'uncertain' ? '核对后重试' : '保存'} <span className="num hidden text-xs opacity-70 sm:inline">⌘↵</span>
            </Button>
          </div>
          </div>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
    {savedEntry && <Dialog open={receiptOpen} onOpenChange={next => { receiptVisible.current = next; setReceiptOpen(next) }}>
      <AppDialogContent size="sm" id="q-share-receipt" className="bottom-auto top-1/2 w-[calc(100vw-32px)] -translate-y-1/2 rounded-xl pb-0 sm:w-[min(560px,calc(100vw-48px))]"
        // 连续录单：弹出时焦点在「继续录单」，回车进下一单；⌘C / Ctrl+C 直接复制整段发群文案
        onOpenAutoFocus={event => { event.preventDefault(); document.getElementById('q-receipt-next')?.focus() }}
        onKeyDown={event => {
          if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c' || window.getSelection()?.toString()) return
          // 先选中整段文案，再让浏览器自己复制（不依赖剪贴板权限，Safari 和内网 IP 也能用）
          const text = document.getElementById('q-receipt-text')
          const selection = window.getSelection()
          if (!text || !selection) return
          const range = document.createRange()
          range.selectNodeContents(text)
          selection.removeAllRanges()
          selection.addRange(range)
          setTimeout(() => { if (selection.toString().trim()) toast.success('已复制发群文案') })
        }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (open && keepGoing) levelRef.current?.focus()
        }}>
        <DialogTitle className="sr-only">订单已保存</DialogTitle>
        <DialogDescription className="sr-only">发群文案，可复制或直接选取文字</DialogDescription>
        <AppDialogBody className="px-5 pb-3 pt-12 sm:px-6">
          <div className="flex items-start gap-3">
            <CheckCircle aria-hidden size={25} weight="fill" className="mt-0.5 shrink-0 text-primary"/>
            <p id="q-receipt-text" className="min-w-0 flex-1 select-text break-words text-base leading-7">{savedEntry.text}</p>
            <CopyOrderName title={savedEntry.text} textLabel="发群文案" className="h-10 w-10 text-primary"/>
          </div>
        </AppDialogBody>
        <AppDialogFooter className="justify-end border-t-0 pt-0">
          <span className="mr-auto hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex" aria-hidden><span className="kbd">⌘C</span> 复制文案 · <span className="kbd">↵</span> {keepGoing ? '继续录单' : '完成'}</span>
          <Button id="q-receipt-next" size="sm" className="h-10 sm:h-8" onClick={() => { receiptVisible.current = false; setReceiptOpen(false) }}>{keepGoing ? '继续录单' : '完成'}</Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>}
    </>
  )
}
