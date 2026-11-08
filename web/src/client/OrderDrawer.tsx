import { useDeleteOrders } from './useDeleteOrders'
import { fixedAllocation, isFixedAllocation } from '@/shared/allocation'
import { useCopyFeedback } from './copy-feedback'
import { PreviewButton } from './preview/PreviewButton'
import { PercentInput } from './PercentInput'
import { UploadState, type UploadPhase } from './UploadState'
import { OperationStatus, useOperationFeedback, type ActionResult } from './operation-feedback'
import { ChannelReceiptLink } from './ChannelReceipts'
import { isInitialDeliveryPending, needsDeadline } from '@/shared/order-deadline'
import { OrderUrgency, OrderImportance } from './OrderUrgency'
import { parseMoneyInput } from '@/shared/money-input'
import { OrderPayLines } from './OrderPayLines'
import { ImageInputActions } from './ImageInputActions'
import { imageFilesFromTransfer } from './image-input'
import { OrderCosts } from './OrderCosts'
import { OrderCustomer } from './OrderCustomer'
import { FinancialNote, FinancialNoteView } from './FinancialNote'
import { DeliverButton } from './DeliverButton'
import { PersonChoice } from './PersonChoice'
import { WriterSelect } from './WriterSelect'
import { OrderProgress } from './OrderProgress'
import { OrderDeadline } from './OrderDeadline'
import { DatePicker, DateField } from './DatePicker'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { CaretUp, CaretDown, CaretRight, X, PencilSimple, Plus, Lock, Receipt, ClockCounterClockwise, Info, CopySimple, Check, Paperclip, FileText, FilePdf, FileZip, FileDoc, FileXls, FilePpt, UploadSimple, DownloadSimple, ArrowCounterClockwise, Image as ImageIcon, DotsThree } from '@phosphor-icons/react'
import { useNav } from './nav'
import { openAfterSale } from './AfterSale'
import { NodesTab, ReceivablesSection, ReqCardTab } from './OrderTabs'
import { fileSize, hasFiles, parsePaymentText, readFiles, thumb } from './files'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OrderView, SalesMode } from '@/shared/types'
import { AnimatedNumber, Avatar, ChannelAvatar, ChannelName, Combobox, Empty, Money, MoneyText, Person, Pill, StatusPill, inputCls, type Option, SkeletonRows } from './ui'
import { getConfirmedOrder, revokeAdjustment, revokePayment, clearReview, addAdjustment, addAttachments, addPayment, createChannel, markDraft, removeAttachment, salesPeople, setAssignees, updateOrder, useSession, type UploadOptions } from './store'
import { sumMoney } from '@/shared/calc'
import { businessDate, daysUntil, iso, money, relTime, shortDate, today } from '@/shared/format'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ImageViewer, Thumbs, fileUrl, isImageName, thumbnailSource } from './ImageViewer'
import { useTaskClock } from './after-sale-data'
import { isUrgent } from './TaskCard'
import { afterSaleState, TONE_VAR } from '@/shared/as-rules'

/** 旧入口按页签跳转，现在详情是一页，换成滚到对应区块。 */
const TAB_FIELD: Record<string, string> = { payments: '收款', aftersale: '售后', files: '附件', nodes: '进度', comments: '讨论', customer: '客户消息' }
/** 这些字段收在「更多」里，跳过去时先展开。 */
const MORE_FIELDS = ['渠道单号', '录单人', '提成比例', '附件', '需求', '结算', '修改记录', '进度', '讨论']

/** 把注意力引到某一块：外扩一圈高亮，1.6 秒后淡出。 */
function flash(el: HTMLElement) {
  el.classList.remove('field-flash')
  void el.offsetWidth
  el.classList.add('field-flash')
  window.setTimeout(() => el.classList.remove('field-flash'), 1700)
}

export function OrderDrawer({
  state,
  onClose,
  onMove,
  onViewed,
}: {
  state: { id: string; list: string[]; tab?: string; field?: string } | null
  onClose: () => void
  onMove: (id: string) => void
  onViewed: (id: string, no: string) => void
}) {
  const { can, order } = useSession()
  const deletion = useDeleteOrders()
  const reduce = useReducedMotion()
  const reducedMotion = useRef(reduce)
  reducedMotion.current = reduce
  const { cards, newOrder } = useNav()
  const v = state ? order(state.id) : undefined
  const idx = state ? state.list.indexOf(state.id) : -1
  const prev = state && idx > 0 ? state.list[idx - 1] : undefined
  const next = state && idx >= 0 && idx < state.list.length - 1 ? state.list[idx + 1] : undefined
  const contentRef = useRef<HTMLDivElement>(null)
  const target = state?.field ?? (state?.tab ? TAB_FIELD[state.tab] : undefined)
  const [payForm, setPayForm] = useState(false)
  const [more, setMore] = useState(false)
  const [history, setHistory] = useState(false)
  const [dropping, setDropping] = useState(false)

  const reveal = useCallback((field: string, delay = 0, focus?: string) => {
    window.setTimeout(() => {
      const el = contentRef.current?.querySelector<HTMLElement>(`[data-order-field="${field}"]`)
      if (!el) return
      if (field === '客户消息') window.dispatchEvent(new CustomEvent('bxsh:customer-open', { detail: state?.id }))
      el.scrollIntoView({ block: 'center', behavior: reducedMotion.current ? 'auto' : 'smooth' })
      flash(el)
      if (focus) el.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true })
    }, delay)
  }, [state?.id])

  useEffect(() => {
    setPayForm(state?.tab === 'payments')
    setMore(!!target && MORE_FIELDS.includes(target))
    setHistory(target === '修改记录')
    if (target) reveal(target, 320, state?.tab === 'payments' ? 'input[aria-label="金额"]' : undefined)
  }, [state?.id, state?.tab, state?.field, target, reveal])

  async function dropFiles(list: FileList | File[], opts?: UploadOptions) {
    if (!v) return false
    const saved = await addAttachments(v.id, Array.isArray(list) ? list : Array.from(list), opts)
    if (saved) {
      setMore(true)
      reveal('附件', 120)
    }
    return saved
  }

  const lastViewed = useRef<string | null>(null)
  useEffect(() => {
    if (v && lastViewed.current !== v.id) {
      lastViewed.current = v.id
      onViewed(v.id, v.no)
    }
    if (!state) lastViewed.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id, state])

  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (document.querySelector('[role="menu"]')) return
      if (e.key === 'ArrowDown' && next) {
        e.preventDefault()
        onMove(next)
      } else if (e.key === 'ArrowUp' && prev) {
        e.preventDefault()
        onMove(prev)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, next, prev, onMove])

  return (
    <Sheet open={!!state && !!v} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showClose={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (e.defaultPrevented) { setDropping(false); return }
          if (!hasFiles(e)) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDropping(false)
          dropFiles(e.dataTransfer.files)
        }}
        onDropCapture={() => setDropping(false)}
        className="flex w-full flex-col gap-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] max-sm:top-[var(--workbench-top,0px)] max-sm:bottom-auto max-sm:h-[var(--workbench-height,100dvh)] sm:max-w-[680px]"
      >
        {v && (
          <>
            <AnimatePresence>
              {dropping && (
                <motion.div
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.18 }}
                  className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/90 text-primary"
                >
                  <div className="grid justify-items-center gap-2 text-sm">
                    <UploadSimple size={28} />
                    松开，存进这单的附件
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex h-12 shrink-0 items-center gap-1 border-b px-4 sm:px-6">
              <div className="ml-auto flex items-center gap-0.5">
                <span className="num mr-1 hidden text-xs text-muted-foreground sm:inline">
                  {idx + 1} / {state!.list.length}
                </span>
                <IconBtn label="上一单（↑）" disabled={!prev} onClick={() => prev && onMove(prev)}>
                  <CaretUp size={15} />
                </IconBtn>
                <IconBtn label="下一单（↓）" disabled={!next} onClick={() => next && onMove(next)}>
                  <CaretDown size={15} />
                </IconBtn>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label="更多操作" title="更多操作" className="grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent sm:h-8 sm:w-8">
                      <DotsThree size={18} weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={() => cards([v.id], 'order')}>订单卡</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => reveal('客户消息', 80)}>客户催单与要求</DropdownMenuItem>
                    {v.afterSales.length > 0 && <DropdownMenuItem onSelect={() => cards([v.id], 'aftersale')}>跟进卡</DropdownMenuItem>}
                    {can('order.create') && (
                      <DropdownMenuItem onSelect={() => newOrder({ title: v.title, channelId: v.channelId, ownerId: v.ownerId, salesMode: v.salesMode, type: v.type, basePrice: v.basePrice !== undefined ? String(v.basePrice) : undefined, source: `照「${v.title}」再录一单` })}>
                        照这单再录一单
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => { setMore(true); setHistory(true); reveal('修改记录', 160) }}>查看修改记录</DropdownMenuItem>
                    {can('order.delete') && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-danger focus:text-danger"
                          disabled={deletion.busy}
                          onSelect={() => void deletion.remove([v.id], onClose)}
                        >
                          删除订单
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <IconBtn label="关闭（Esc）" onClick={onClose}>
                  <X size={15} />
                </IconBtn>
              </div>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={v.id}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -4, transition: { duration: reduce ? 0 : 0.15 } }}
                transition={{ duration: reduce ? 0 : 0.18 }}
                ref={contentRef}
                className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-4 pb-8 sm:px-6 sm:pb-12 [&_.grid>*]:min-w-0"
              >
                <Header v={v} onDue={() => reveal('截止日期')} onDraft={() => reveal('初稿', 80, 'button')} />
                <div className="grid gap-4 sm:gap-6">
                  {v.reviewFlag && <ReviewNote v={v} />}
                  <MoneyHero v={v} />
                  <FinanceActions v={v} payOpen={payForm} onPay={() => { setPayForm(!payForm); if (!payForm) reveal('收款', 100, 'input[aria-label="金额"]') }}/>
                  {v.payments && <Payments key={`payments:${v.id}`} v={v} compact formOpen={payForm} onFormOpen={setPayForm} />}
                  <OrderPayLines v={v} />
                  <Actions v={v} />
                  <AfterSaleSummary v={v} onGo={onClose} />
                  <OrderCustomer key={v.id} orderId={v.id}/>
                  <Overview v={v} />
                  <More v={v} target={target} open={more} onOpen={setMore} history={history} onHistory={setHistory} onFiles={dropFiles} />
                </div>
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function IconBtn({ label, children, onClick, disabled, className }: { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label} className={cn('grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent sm:h-8 sm:w-8', className)}>
      {children}
    </button>
  )
}

/** Copy confirmation shares the same lifetime and Safari gesture handling as order names. */
function CopyText({ text, label, className, children }: { text: string; label: string; className?: string; children?: ReactNode }) {
  const feedback = useCopyFeedback(text)
  const done = feedback.state === 'copied'
  return <button type="button" title={done ? '已复制' : label} aria-label={done ? '已复制' : label} aria-busy={feedback.state === 'copying'}
    onClick={async () => { const copied = await feedback.copy(() => navigator.clipboard.writeText(text)); if (copied === false) toast('浏览器拦住了复制，请手动选中') }}
    className={cn('group inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 hover:bg-accent hover:text-foreground', className)}>
    {children ?? text}
    {done ? <Check size={13} weight="bold" className="text-ok"/> : <CopySimple size={13} className="opacity-60 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"/>}
  </button>
}

function Header({ v, onDue, onDraft }: { v: OrderView; onDue: () => void; onDraft: () => void }) {
  const { can, s } = useSession()
  const feedback = useOperationFeedback()
  return (
    <SheetTitle asChild>
      <div className="grid gap-2 pb-5 pt-5">
        <InlineText value={v.title} editable={can('order.edit')} onSave={(t, report) => updateOrder(v.id, { title: t }, undefined, { silent: true, onResult: report })} className="text-lg font-semibold leading-snug" />
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {can('order.status') ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" title="改状态">
                  <StatusPill status={v.status} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {s.statuses.map((st) => (
                    <DropdownMenuItem key={st} onSelect={() => { if (st === v.status) return; if (!v.draftAt && st !== '未交付' && st !== '退单') { toast('请先附截图交付'); onDraft(); return } void feedback.run(report => updateOrder(v.id, { status: st }, undefined, { silent: true, onResult: report })) }}>
                      <StatusPill status={st} />
                      {st === v.status && <Check size={13} className="ml-auto text-muted-foreground" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <StatusPill status={v.status} />
            )}
            <OperationStatus state={feedback.state} compact/>
            <DueBadge date={v.dueDate} status={v.status} onClick={onDue} />
          </div>
        </SheetDescription>
        <div className="flex flex-wrap items-start gap-2"><OrderImportance key={`important:${v.id}`} v={v}/><OrderUrgency key={v.id} v={v}/></div>
        <OrderProgress key={`progress:${v.id}`} v={v}/>
      </div>
    </SheetTitle>
  )
}

/** 原订单截止只催未交付；发出演示后保留日期，不再提示逾期。 */
export function DueBadge({ date, status, onClick }: { date: string | null; status: string; onClick?: () => void }) {
  const d = daysUntil(date)
  const open = isInitialDeliveryPending({ status })
  if (d === null && !needsDeadline({ dueDate: date, status })) return <span className="text-xs text-muted-foreground">—</span>
  if (d === null)
    return (
      <button type="button" onClick={onClick} className="inline-flex h-[22px] items-center rounded-full border border-dashed px-2 text-xs text-muted-foreground hover:text-foreground">
        截止未定
      </button>
    )
  // 颜色分主次：逾期红、今天橙，其余灰
  const tone = !open ? 'var(--muted-foreground)' : d < 0 ? 'var(--danger)' : d === 0 ? 'var(--warn)' : 'var(--muted-foreground)'
  const text = !open ? `截止 ${shortDate(date)}` : d < 0 ? `逾期 ${-d} 天` : d === 0 ? '今天截止' : d === 1 ? '明天截止' : `还剩 ${d} 天`
  return (
    <button type="button" onClick={onClick} title={`截止 ${shortDate(date)}`} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Pill tone={tone}>
        {text}
        {open && <span className="font-normal opacity-70">· {shortDate(date)}</span>}
      </Pill>
    </button>
  )
}

function ReviewNote({ v }: { v: OrderView }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-warn/10 px-3 py-2 text-sm">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
      <span className="min-w-0 flex-1 truncate" title={v.reviewFlag ?? undefined}>
        <b className="font-medium text-warn">迁移待核对</b>
        <span className="ml-2 text-muted-foreground">{v.reviewFlag}</span>
      </span>
      <Button size="sm" variant="ghost" className="h-7 shrink-0" onClick={() => void clearReview(v.id).then((ok) => ok && toast.success('已标记核对'))}>
        确认核对
      </Button>
    </div>
  )
}

/** 金额用紧凑明细展示，收款与两类工资在下方分别登记。 */
function MoneyHero({ v }: { v: OrderView }) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const { me, role } = useSession()
  const animationKey = `${me.id}:${role.id}:${role.fields?.sales}`
  if (v.sales === undefined) {
    if (v.myPay === undefined) return null
    return (
      <div data-order-field="价格" className="rounded-lg border px-4 py-3">
        <div className="text-xs text-muted-foreground">我的工资</div>
        <div className="mt-1 text-2xl">{v.myPay === null ? <span className="blank-box">未定</span> : <MoneyText value={v.myPay} />}</div>
      </div>
    )
  }
  const unpaid = v.unpaid ?? 0
  const sales = v.sales
  const refunded = v.status === '退单'
  // 付出去的钱（写手工资、销售提成）用常规字重，进账的用金色
  const minor: { label: string; value: number | null | undefined; pending?: boolean; out?: boolean }[] = []
  if (v.writerTotal !== undefined) minor.push({ label: '写手工资', value: v.writerTotal, pending: v.payPending, out: true })
  else if (v.myPay !== undefined) minor.push({ label: '我的工资', value: v.myPay })
  if (v.commission !== undefined && !v.isSelf && v.salesMode !== 'cost') minor.push({ label: '销售提成', value: v.commission, pending: v.payPending, out: true })
  if (v.bossIncome !== undefined) minor.push({ label: v.isSelf ? '预计收入 · 自营' : '预计收入', value: v.bossIncome, pending: v.payPending })
  return (
    <div data-order-field="价格" className="rounded-lg border bg-background">
      <div className="grid grid-cols-3 divide-x px-1 py-3">
        <button type="button" onClick={() => setOpen(!open)} className="group px-3 text-left" aria-expanded={open} aria-label={v.salesMode === 'cost' ? '底价明细' : '销售额明细'}>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">{v.salesMode === 'cost' ? '销售应付底价' : '销售额'}<CaretDown size={11} className={cn('transition-transform', open && 'rotate-180')} /></div>
          <div className={cn('num mt-1 text-xl font-semibold text-gold', refunded && 'text-muted-foreground line-through decoration-1')}><AnimatedNumber value={sales} format={money} animateOnMount={false} animationKey={animationKey} /></div>
        </button>
        <div className="px-3"><div className="text-xs text-muted-foreground">已收</div><div className="num money mt-1 text-xl"><AnimatedNumber value={v.received} format={money} animateOnMount={false} animationKey={animationKey}/></div></div>
        <div data-order-field="收款摘要" className="px-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">{unpaid < 0 ? '多收' : '未收'}</div>
          <div className={cn('num mt-1 text-xl font-semibold', unpaid < 0 ? 'text-danger' : 'text-foreground')}><AnimatedNumber value={v.unpaid === undefined ? undefined : Math.abs(v.unpaid)} format={money} animateOnMount={false} animationKey={animationKey} /></div>
        </div>
      </div>
      {minor.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          {minor.map((m) => (
            <span key={m.label} className="inline-flex items-baseline gap-1.5">
              {m.label}
              <span className={cn('text-[13px]', m.out && 'text-foreground')}>
                <Money value={m.value} pending={m.pending} out={m.out} />
              </span>
            </span>
          ))}
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && v.basePrice !== undefined && (
          <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.18 }} className="overflow-hidden">
            <div className="mx-2 mb-2 rounded-lg bg-card">
              <PriceSection v={v} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 记收款入口；工资在下方逐人发放。 */
export function FinanceActions({ v, payOpen, onPay }: { v: OrderView; payOpen: boolean; onPay: () => void }) {
  const { can } = useSession()
  if (!can('payment.create') || !v.payments) return null
  return <div className="flex gap-2" aria-label="订单资金操作">
    <button type="button" aria-expanded={payOpen} onClick={onPay}
      className={cn('flex h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium transition-colors', payOpen ? 'border-primary text-primary bg-primary/5' : 'border-input text-primary hover:border-primary hover:bg-primary/5')}>
      {v.salesMode === 'cost' ? '收销售款' : '记收款'}<CaretDown size={12} className={cn('shrink-0 transition-transform', payOpen && 'rotate-180')}/>
    </button>
  </div>
}

/** 交付和跟进单独显示，不重复资金入口。 */
function Actions({ v }: { v: OrderView }) {
  const { can, s } = useSession()
  const [deliveryBusy, setDeliveryBusy] = useState(false)
  const mine = s.role.locked || v.assignees.some((a) => a.userId === s.me.id)
  const canDraft = can('order.draft') && !v.draftAt && v.status !== '退单' && !openAfterSale(v) && mine && v.sales === undefined
  const canAfterSale = can('aftersale.create') && v.status !== '退单' && !openAfterSale(v)
  const keepDelivery = deliveryBusy && can('order.draft') && mine && v.sales === undefined
  if (!canDraft && !keepDelivery && !canAfterSale) return null
  return <div className="flex gap-2">
    {(canDraft || keepDelivery) && <DeliverButton kind="draft" orderId={v.id} no={v.no} label="交付" variant="default" className="h-8 px-3 text-sm" onBusyChange={setDeliveryBusy} />}
    {canAfterSale && <Button size="sm" variant="ghost" className="px-0 text-primary" onClick={() => window.dispatchEvent(new CustomEvent('bxsh:aftersale-entry', { detail: { orderId: v.id } }))}>发起跟进</Button>}
  </div>
}

function Section({ title, count, field, action, children }: { title: string; count?: ReactNode; field?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section data-order-field={field} className="grid gap-1">
      <header className="flex h-8 items-center gap-2 text-[13px] font-medium">
        {title}
        {count !== undefined && count !== null && count !== 0 && <span className="num font-normal text-muted-foreground">{count}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </header>
      {children}
    </section>
  )
}

/** 详情里只放跟进摘要；确认、交付、定性都在「跟进」页做，不做两套。 */
function AfterSaleSummary({ v, onGo }: { v: OrderView; onGo: () => void }) {
  const now = useTaskClock()
  const { afterSale } = useNav()
  if (!v.afterSales.length) return null
  const list = [...v.afterSales].reverse()
  return (
    <Section title="跟进" count={`${list.length} 轮`} field="售后">
      <div className="grid">
        {list.map((a) => {
          const st = afterSaleState(a, now)
          const urgent = isUrgent(a, now)
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onGo()
                afterSale(a.id)
              }}
              className="group -mx-2 flex h-10 items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-accent"
            >
              <span className="num w-11 shrink-0 text-xs text-muted-foreground">第 {a.round} 轮</span>
              <span className="min-w-0 flex-1 truncate">{a.req[0] || (a.shots.length ? '见截图' : '—')}</span>
              <Pill tone={TONE_VAR[st.tone]} className={cn(urgent && 'urgent-pulse')}>{st.label}</Pill>
              <CaretRight size={13} className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )
        })}
      </div>
    </Section>
  )
}

function Overview({ v }: { v: OrderView }) {
  const { s, can, channel } = useSession()
  const editBasic = can('order.edit')
  const channelOpts: Option[] = s.channels.map((c) => ({ value: c.id, label: c.name, icon: <ChannelAvatar channel={c} size={18} /> }))
  return (
    <Section title="信息">
      <div className="grid gap-0.5">
        {v.salesMode !== 'cost' && <Row label="渠道">
          <InlineSelect editable={editBasic} value={v.channelId} options={channelOpts} display={<ChannelName channel={channel(v.channelId)} />} onSave={(x, report) => updateOrder(v.id, { channelId: x }, undefined, { silent: true, onResult: report })} onCreate={async (l) => (await createChannel(l, v.ownerId))?.id ?? null} />
        </Row>}
        <Row label="归属销售">
          <OwnerCell v={v} />
        </Row>
        <Row label="结算方式"><OrderSalesMode v={v}/></Row>
        <Row label="写手" top>
          <AssigneesEditor v={v} />
        </Row>
        {v.extraCosts && <Row label="额外成本" top>
          <OrderCosts key={`costs:${v.id}`} v={v}/>
        </Row>}
        <Row label="初稿">
          <DraftCell v={v} />
        </Row>
        <Row label="订单类型">
          <InlineSelect editable={editBasic} value={v.type} options={s.types.map((t) => ({ value: t, label: t }))} display={v.type || <span className="text-muted-foreground">点击填写</span>} onSave={(x, report) => updateOrder(v.id, { type: x }, undefined, { silent: true, onResult: report })} onCreate={(l) => l} />
        </Row>
        <Row label="下单日期">
          <InlineDate editable={editBasic} value={v.orderDate} onSave={(x, report) => x ? updateOrder(v.id, { orderDate: x }, undefined, { silent: true, onResult: report }) : Promise.resolve(true)} />
        </Row>
        <Row label="截止日期">
          <OrderDeadline v={v} />
        </Row>
        <Row label="微信群">
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1">
              <InlineText value={v.wechatGroup} placeholder="同订单名" editable={editBasic} onSave={(t, report) => updateOrder(v.id, { wechatGroup: t }, undefined, { silent: true, onResult: report })} className="text-sm" />
            </span>
            <CopyText text={v.wechatGroup || v.title} label="复制群名，去微信里搜" className="shrink-0 text-muted-foreground">
              <span className="sr-only">复制群名</span>
            </CopyText>
          </span>
        </Row>
        <Row label="备注" top>
          <InlineText value={v.note} placeholder="点击填写" multiline editable={editBasic} onSave={(t, report) => updateOrder(v.id, { note: t }, undefined, { silent: true, onResult: report })} className="text-sm" />
        </Row>
      </div>
    </Section>
  )
}

function OwnerCell({ v }: { v: OrderView }) {
  const { s, can, user } = useSession()
  const [editing, setEditing] = useState(false)
  const feedback = useOperationFeedback()
  if (!can('order.assign')) return <Person user={user(v.ownerId)} />
  return <FieldFeedback feedback={feedback}>
    {editing ? <div onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))}>
      <PersonChoice showSalesMode people={salesPeople(s)} value={v.ownerId} label="归属销售"
        onChange={(id) => { setEditing(false); if (id !== v.ownerId) void feedback.run(report => updateOrder(v.id, { ownerId: id }, undefined, { silent: true, onResult: report })) }}/>
    </div> : <EditShell editable onEdit={() => { feedback.reset(); setEditing(true) }}><Person user={user(v.ownerId)} /></EditShell>}
  </FieldFeedback>
}

function OrderSalesMode({ v }: { v: OrderView }) {
  const { can, role, s } = useSession()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SalesMode>(v.salesMode ?? 'commission')
  const [channelId, setChannelId] = useState(v.channelId)
  const [price, setPrice] = useState('')
  const [reason, setReason] = useState('')
  const [proof, setProof] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const lock = useRef(false)
  const label = v.salesMode === 'cost' ? '底价订单' : '提成订单'
  const adjustment = sumMoney((v.adjustments ?? []).filter(a => !a.revoked).map(a => a.amount))
  if (!can('order.price') || v.basePrice === undefined || (v.allocationPolicy === 'fixed_60_20_20_v1' && !role.locked)) return <span>{label}</span>
  return <Popover open={open} onOpenChange={next => {
    if (busy || reading) return
    setOpen(next)
    if (next) { setMode(v.salesMode ?? 'commission'); setChannelId(v.channelId); setPrice(''); setReason(''); setProof(undefined) }
  }}>
    <PopoverTrigger asChild><button type="button" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-primary hover:bg-accent" aria-label="修改订单结算方式">{label}<CaretDown size={12}/></button></PopoverTrigger>
    <PopoverContent align="start" className="w-80 p-3">
      <form className="grid gap-3" onSubmit={async e => {
        e.preventDefault()
        if (lock.current || reading) return
        if (mode === (v.salesMode ?? 'commission')) { setOpen(false); return }
        if (!/^\d+(?:\.\d{1,2})?$/.test(price) || Number(price) > 10_000_000) return toast.error('请填写切换后的金额，最多两位小数')
        if (mode === 'commission' && !channelId) return toast.error('请选择渠道')
        if (!role.locked && !reason.trim() && !proof) return toast.error('请填写修改备注或粘贴截图')
        lock.current = true; setBusy(true)
        try {
          if (await updateOrder(v.id, { salesMode: mode, basePrice: Number(price), ...(mode === 'commission' ? { channelId } : {}) }, { reason, proof })) setOpen(false)
        } finally { lock.current = false; setBusy(false) }
      }}>
        <fieldset disabled={busy || reading} className="grid gap-3">
          <div className="flex gap-2" role="group" aria-label="切换订单结算方式">{(['commission', 'cost'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} className={cn('flex-1 rounded-md border px-2 py-1.5 text-sm', mode === value && 'border-primary bg-primary/5 text-primary')} onClick={() => { setMode(value); setPrice('') }}>{value === 'cost' ? '底价订单' : '提成订单'}</button>)}</div>
          {mode !== (v.salesMode ?? 'commission') && <>
            {mode === 'commission' && <Combobox showSelectedIcon value={channelId} options={s.channels.map(c => ({ value: c.id, label: c.name, icon: <ChannelAvatar channel={c} size={18}/> }))} placeholder="选择渠道" onChange={setChannelId}/>}
            <label className="grid gap-1.5 text-xs text-muted-foreground">{mode === 'cost' ? '基础底价' : '订单原价'}<input aria-label="切换后的订单金额" inputMode="decimal" placeholder="填写基础金额" className={inputCls} value={price} onChange={e => setPrice(e.target.value)}/></label>
            {adjustment !== 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>追加 / 减免 {money(adjustment)}</span><span>切换后应收 {price ? money(sumMoney([Number(price), adjustment])) : '—'}</span></div>}
            <FinancialNote note={reason} proof={proof} onNote={setReason} onProof={setProof} onReading={setReading} disabled={busy || reading} required={!role.locked}/>
          </>}
          <Button type="submit" size="sm" disabled={mode === (v.salesMode ?? 'commission')}>{busy ? '保存中…' : '保存'}</Button>
        </fieldset>
      </form>
    </PopoverContent>
  </Popover>
}

/** 「更多」：低频信息，平时收起。 */
function More({ v, target, open, onOpen, history, onHistory, onFiles }: { v: OrderView; target?: string; open: boolean; onOpen: (o: boolean) => void; history: boolean; onHistory: (o: boolean) => void; onFiles: (l: FileList | File[], opts?: UploadOptions) => Promise<boolean> }) {
  const { user, can } = useSession()
  const reduce = useReducedMotion()
  const editBasic = can('order.edit')
  const [files, setFiles] = useState(v.attachments.length > 0)
  const [req, setReq] = useState(false)
  const [nodes, setNodes] = useState(false)
  useEffect(() => {
    if (target === '附件') setFiles(true)
    if (target === '需求') setReq(true)
    if (target === '进度') setNodes(true)
  }, [target])
  const reqCount = Object.values(v.req ?? {}).filter((x) => (Array.isArray(x) ? x.length : !!x)).length
  return (
    <section className="grid gap-1">
      <button type="button" onClick={() => onOpen(!open)} className="-mx-2 flex h-8 w-fit items-center gap-1 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground" aria-expanded={open}>
        <CaretRight size={12} className={cn('transition-transform duration-[180ms] motion-reduce:transition-none', open && 'rotate-90')} />
        更多
        {v.attachments.length > 0 && <span className="num text-xs">· 附件 {v.attachments.length}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.18 }} className="overflow-hidden">
            <div className="grid gap-0.5 pt-1">
              {v.channelNo !== undefined && (
                <Row label="渠道单号">
                  <InlineText value={v.channelNo} placeholder="点击填写" editable={editBasic} onSave={(t, report) => updateOrder(v.id, { channelNo: t }, undefined, { silent: true, onResult: report })} className="num text-sm" />
                </Row>
              )}
              <Row label="录单人">
                <Person user={user(v.creatorId)} />
              </Row>
              {v.commissionRate !== undefined && v.salesMode !== 'cost' && (
                <Row label={isFixedAllocation(v) ? "销售分成" : "原提成比例"}>
                  <span className="num">{isFixedAllocation(v) ? 20 : Math.round(v.commissionRate * 100)}%</span>
                  <span className="ml-2 text-xs text-muted-foreground">录单时锁定</span>
                </Row>
              )}
              {v.settlements && v.settlements.length > 0 && (
                <div data-order-field="结算" className="pt-2">
                  <SettleSection v={v} />
                </div>
              )}
              <Fold label="附件" count={v.attachments.length} open={files} onOpen={setFiles} field="附件">
                <Files v={v} onFiles={onFiles} />
              </Fold>
              <Fold label="需求卡片" count={reqCount} open={req} onOpen={setReq} field="需求">
                <ReqCardTab v={v} />
              </Fold>
              {v.nodes.length > 0 && <Fold label="进度" count={v.nodes.length} open={nodes} onOpen={setNodes} field="进度"><NodesTab v={v} /></Fold>}
              <Fold label="修改记录" open={history} onOpen={onHistory} field="修改记录">
                <Activity id={v.id} />
              </Fold>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function Fold({ label, count, open, onOpen, field, children }: { label: string; count?: number; open: boolean; onOpen: (o: boolean) => void; field: string; children: ReactNode }) {
  return (
    <div data-order-field={field} className="border-t pt-1 first:border-t-0">
      <button type="button" onClick={() => onOpen(!open)} className="-mx-2 flex h-9 w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 text-sm hover:bg-accent" aria-expanded={open}>
        <span>{label}</span>
        {!!count && <span className="num text-xs text-muted-foreground">{count}</span>}
        <CaretDown size={12} className={cn('ml-auto text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="pb-3 pt-1">{children}</div>}
    </div>
  )
}

function DraftCell({ v }: { v: OrderView }) {
  const { can, me, role } = useSession()
  const [deliveryBusy, setDeliveryBusy] = useState(false)
  const mine = role.locked || v.assignees.some((a) => a.userId === me.id)
  const keepDelivery = deliveryBusy && can('order.draft') && mine && v.sales !== undefined
  if (v.draftAt && !keepDelivery)
    return (
      <span className="text-sm">
        <span className="num">{shortDate(businessDate(v.draftAt))}</span> 已交付
      </span>
    )
  if (v.status === '退单' && !keepDelivery) return <span className="text-sm text-muted-foreground">已退单</span>
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      {v.draftAt ? '已交付' : '还没交'}
      {can('order.draft') && mine && v.sales !== undefined && (!openAfterSale(v) || keepDelivery) && <DeliverButton kind="draft" orderId={v.id} no={v.no} label="交付" onBusyChange={setDeliveryBusy} />}
    </span>
  )
}

function SettleSection({ v }: { v: OrderView }) {
  const { user } = useSession()
  return (
    <section className="rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="font-medium text-muted-foreground">结算</span>
        {v.writerSettle && <Pill tone={v.writerSettle === '已结算' ? 'var(--ok)' : v.writerSettle === '部分结算' ? 'var(--gold)' : undefined}>写手 {v.writerSettle}</Pill>}
        {v.salesSettle && <Pill tone={v.salesSettle === '已结算' ? 'var(--ok)' : v.salesSettle === '部分结算' ? 'var(--gold)' : undefined}>提成 {v.salesSettle}</Pill>}
      </div>
      <div className="grid px-3 py-1 text-sm">
        {v.settlements!.map((x) => (
          <div key={x.id} className="flex h-8 items-center gap-2">
            <span className="text-muted-foreground">{x.kind}</span>
            <Person user={user(x.payeeId)} size={18} />
            <span className="text-xs text-muted-foreground">
              {x.status}
              {x.migrated && ' · 飞书迁移'}
            </span>
            <Money value={x.amount} className="ml-auto" />
          </div>
        ))}
      </div>
    </section>
  )
}

function Row({ label, children, top }: { label: string; children: ReactNode; top?: boolean }) {
  return (
    <div data-order-field={label} className={cn('-mx-2 grid min-h-9 grid-cols-[76px_1fr] gap-3 rounded-lg px-2', top ? 'items-start py-0.5' : 'items-center')}>
      <div className={cn('text-[13px] text-muted-foreground', top && 'pt-2')}>{label}</div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  )
}

function EditShell({ editable, onEdit, children, className }: { editable: boolean; onEdit: () => void; children: ReactNode; className?: string }) {
  if (!editable) return <div className={cn('flex min-h-8 items-center', className)}>{children}</div>
  return (
    <button onClick={onEdit} className={cn('group -mx-2 flex min-h-8 w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 text-left hover:bg-accent', className)}>
      <span className="min-w-0 flex-1">{children}</span>
      <PencilSimple size={13} className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  )
}

type FieldSave<T> = (value: T, report?: (result: ActionResult) => void) => Promise<boolean>

function FieldFeedback({ feedback, children }: { feedback: ReturnType<typeof useOperationFeedback>; children: ReactNode }) {
  return <div className="flex min-w-0 items-start gap-2">
    <div className="min-w-0 flex-1">{children}</div>
    <span className="flex min-h-8 w-24 shrink-0 items-center" title={feedback.state.message}>
      <OperationStatus state={feedback.state} compact/>
    </span>
  </div>
}

export function InlineText({ value, onSave, editable, className, placeholder, multiline }: { value: string; onSave: FieldSave<string>; editable: boolean; className?: string; placeholder?: string; multiline?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const dirty = useRef(false)
  const revision = useRef(0)
  const pending = useRef<{ revision: number; value: string } | null>(null)
  const feedback = useOperationFeedback()
  useEffect(() => { if (!dirty.current && !editing) setDraft(value) }, [value, editing])
  const commit = async () => {
    setEditing(false)
    const next = draft.trim()
    if (next === value || pending.current?.value === next) return
    const current = ++revision.current
    pending.current = { revision: current, value: next }
    try {
      const saved = await feedback.run(report => onSave(next, report))
      if (saved && revision.current === current) dirty.current = false
    } finally { if (pending.current?.revision === current) pending.current = null }
  }
  const props = {
    autoFocus: true,
    value: draft,
    'aria-busy': feedback.state.status === 'saving',
    onChange: (e: { target: { value: string } }) => { dirty.current = true; revision.current++; feedback.reset(); setDraft(e.target.value) },
    onBlur: () => { void commit() },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit() }
      if (e.key === 'Escape') { e.stopPropagation(); dirty.current = false; revision.current++; feedback.reset(); setDraft(value); setEditing(false) }
    },
  }
  const content = editing
    ? multiline ? <textarea rows={3} {...props} className={cn(inputCls, 'h-auto py-2', className)} /> : <input {...props} className={cn(inputCls, className)} />
    : <EditShell editable={editable} onEdit={() => { revision.current++; feedback.reset(); if (!dirty.current) setDraft(value); setEditing(true) }} className={className}>
        {value ? <span className="whitespace-pre-wrap break-words">{value}</span> : <span className="text-muted-foreground">{placeholder ?? '—'}</span>}
      </EditShell>
  return editable ? <FieldFeedback feedback={feedback}>{content}</FieldFeedback> : content
}

function InlineSelect({ value, options, onSave, editable, display, onCreate }: { value: string; options: Option[]; onSave: FieldSave<string>; editable: boolean; display: ReactNode; onCreate?: (l: string) => string | null | Promise<string | null> }) {
  const [editing, setEditing] = useState(false)
  const feedback = useOperationFeedback()
  const content = editing
    ? <div onBlur={() => setEditing(false)}>
        <Combobox autoFocus value={value} options={options} onCreate={onCreate}
          onChange={(next) => { setEditing(false); if (next !== value) void feedback.run(report => onSave(next, report)) }}/>
      </div>
    : <EditShell editable={editable} onEdit={() => { feedback.reset(); setEditing(true) }}>{display}</EditShell>
  return editable ? <FieldFeedback feedback={feedback}>{content}</FieldFeedback> : content
}

function InlineDate({ value, onSave, editable }: { value: string | null; onSave: FieldSave<string>; editable: boolean }) {
  const feedback = useOperationFeedback()
  if (!editable) return <span className={cn('num', !value && 'text-muted-foreground')}>{value ? shortDate(value) : '—'}</span>
  return <FieldFeedback feedback={feedback}><DatePicker plain value={value} label="修改日期" onChange={(date) => { if (date !== value) void feedback.run(report => onSave(date, report)) }} /></FieldFeedback>
}

function AssigneesEditor({ v }: { v: OrderView }) {
  const { s, can, user, role } = useSession()
  // 销售能选写手，工资只有管理员定
  const pickable = can('order.edit')
  const editable = role.locked
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const { openOrder } = useNav()
  // undefined 表示权限隐藏，提交时省略，服务端保留原工资。
  const raw = useMemo(() => v.assignees.map(a => ({ userId: a.userId, pay: a.pay, rate: a.rate })), [v])
  const save = async (next: { userId: string; pay?: number | null; rate?: number | null }[], report?: (result: ActionResult) => void) => {
    if (savingRef.current) return false
    savingRef.current = true; setSaving(true)
    try { return await setAssignees(v.id, next, { silent: !!report, onResult: report }) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const canRemove = (userId: string) => {
    if (v.afterSales.some(a => !a.doneAt && !a.cancelledAt && a.writerId === userId)) {
      openOrder(v.id, undefined, 'aftersale')
      toast('先添加新写手并交接跟进，再移除原写手')
      return false
    }
    return true
  }
  const payFor = (userId: string) => {
    const a = v.assignees.find(a => a.userId === userId)
    if (!a) return null
    return editable && a.pay !== undefined ? <div className="flex items-center gap-1.5">
      <PercentInput nullable label={`${user(userId)?.name ?? '写手'}的本单比例`} value={a.rate ?? null}
        onSave={(rate, report) => save(raw.map(x => x.userId === userId ? { ...x, rate } : x), report)}/>
      <PayInput nullable label={`${user(userId)?.name ?? '写手'}的写手工资`} value={a.pay ?? null}
        onSave={(pay, report) => save(raw.map(x => x.userId === userId ? { ...x, rate: null, pay } : x), report)}/>
    </div> : a.pay !== undefined ? <Money value={a.pay}/> : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock size={12}/> 工资不可见</span>
  }
  const selected = v.assignees.flatMap(a => { const person = user(a.userId); return person ? [person] : [] })

  return (
    <fieldset disabled={saving} className="min-w-0">
      {editable && v.writerTotal !== undefined && <div className="mb-2 text-xs text-muted-foreground">写手合计 <span className="tabular-nums">¥{v.writerTotal}</span></div>}
      {pickable ? <WriterSelect
        people={s.users.filter(u => u.canWrite && u.active !== false)}
        selected={selected}
        disabled={saving}
        onToggle={id => !editable
          // 看不到工资的只传人，工资由服务端保留或按制度自动分
          ? raw.some(a => a.userId === id) ? canRemove(id) ? save(raw.filter(a => a.userId !== id).map(a => ({ userId: a.userId }))) : false : save([...raw.map(a => ({ userId: a.userId })), { userId: id }])
          : raw.some(a => a.userId === id)
          ? canRemove(id) ? save(raw.filter(a => a.userId !== id)) : false
          : save([...raw, { userId: id, pay: null, rate: user(id)?.writerRate ?? .2 }])}
        renderPay={person => editable ? payFor(person.id) : null}
      /> : v.assignees.length ? <div className="flex min-w-0 flex-wrap items-start gap-3">
        {v.assignees.map(a => <div key={a.userId} className="grid min-w-0 gap-1.5"><Person user={user(a.userId)}/>{payFor(a.userId)}</div>)}
      </div> : <span className="flex h-9 items-center text-muted-foreground">未指定</span>}
    </fieldset>
  )
}

export function PayInput({ value, onSave, nullable, label = '金额' }: ({ value: number | null; onSave: FieldSave<number>; nullable?: false } | { value: number | null; onSave: FieldSave<number | null>; nullable: true }) & { label?: string }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const [invalid, setInvalid] = useState(false)
  const dirty = useRef(false)
  const revision = useRef(0)
  const pending = useRef<{ revision: number; value: number | null } | null>(null)
  const feedback = useOperationFeedback()
  useEffect(() => { if (!dirty.current) setDraft(value === null ? '' : String(value)) }, [value])
  return (
    <span className="inline-grid min-w-0 gap-0.5">
      <span className="inline-flex h-8 min-w-0 items-center rounded-md border border-transparent pl-2 hover:border-input focus-within:border-ring focus-within:bg-card">
        <span className="num text-sm text-muted-foreground">¥</span>
        <input aria-label={label} aria-invalid={invalid || undefined} aria-busy={feedback.state.status === 'saving'}
          data-writer-pay={nullable ? '' : undefined}
          size={Math.max(nullable ? 4 : 2, draft.length + 1)} placeholder={nullable ? '未定' : undefined}
          className={cn('num h-full min-w-0 bg-transparent pl-0.5 pr-2 text-right text-sm outline-none', invalid && 'text-danger')}
          value={draft} inputMode="decimal"
          onChange={(e) => { dirty.current = true; revision.current++; feedback.reset(); setDraft(e.target.value); setInvalid(false) }}
          onBlur={async () => {
            const next = parseMoneyInput(draft, nullable ? 1_000_000 : 10_000_000)
            if (next === undefined || (next === null && !nullable)) {
              setInvalid(true)
              toast.error(`${label}格式不正确，请填写有效金额，最多两位小数`)
              return
            }
            if (next === value || pending.current?.value === next) return
            const current = ++revision.current
            pending.current = { revision: current, value: next }
            try {
              const saved = await feedback.run(report => (onSave as FieldSave<number | null>)(next, report))
              if (saved && revision.current === current) dirty.current = false
            } finally { if (pending.current?.revision === current) pending.current = null }
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}/>
      </span>
      <span className="min-h-5"><OperationStatus state={feedback.state} compact/></span>
    </span>
  )
}

function PriceSection({ v }: { v: OrderView }) {
  const reduce = useReducedMotion()
  const { can, user, role } = useSession()
  const editable = can('order.price')
  const [adding, setAdding] = useState(false)
  const [amt, setAmt] = useState('')
  const [reason, setReason] = useState('')
  const [sign, setSign] = useState<1 | -1>(1)
  const [editingPrice, setEditingPrice] = useState(false)
  const [proof, setProof] = useState<string>()
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const close = () => { setAdding(false); setEditingPrice(false); setAmt(''); setReason(''); setProof(undefined) }
  return (
    <section data-order-field="价格" className="border-t">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{v.salesMode === 'cost' ? '底价明细' : '销售额明细'}</span>
        {editable && !adding && !editingPrice && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus size={12} weight="bold" /> 追加 / 减免
          </button>
        )}
      </div>
      <div className="grid gap-0.5 px-3 py-1.5 text-sm">
        <div className="flex min-h-8 items-center justify-between">
          <span>{v.salesMode === 'cost' ? '约定底价' : '原价'}</span>
          {editable ? role.locked ? <PayInput value={v.basePrice!} onSave={(n, report) => updateOrder(v.id, { basePrice: n }, undefined, { silent: true, onResult: report })} /> : <button type="button" className="flex items-center gap-2 text-primary" disabled={adding || editingPrice} onClick={() => { setEditingPrice(true); setAmt(String(v.basePrice)); }}><Money value={v.basePrice} /><span className="text-xs">修改</span></button> : <Money value={v.basePrice} />}
        </div>
        {v.adjustments!.map((a) => (
          <div key={a.id} className="group flex min-h-8 items-center justify-between gap-2">
            <span className={cn('min-w-0 truncate text-muted-foreground', a.revoked && 'opacity-60')}>
              <span className={cn(a.revoked && 'line-through')}>
                {a.amount >= 0 ? '追加' : '减免'} · {a.reason} · {user(a.by)?.name} {shortDate(a.at)}
              </span>
              {a.revoked && <RevokedNote r={a.revoked} />}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {role.locked && !a.revoked && <RevokeButton what={a.amount >= 0 ? '追加' : '减免'} onRevoke={(r) => revokeAdjustment(v.id, a.id, r)} />}
              <Money value={a.amount} signed className={cn(a.revoked && 'text-muted-foreground line-through opacity-60')} />
            </span>
          </div>
        ))}
        <AnimatePresence>
          {(adding || editingPrice) && (
            <motion.form
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
              className="grid gap-2 overflow-hidden py-1.5"
              onSubmit={async (e) => {
                e.preventDefault()
                if (lock.current || reading) return
                const n = Number(amt)
                if (!amt.trim() || !Number.isFinite(n) || n < 0 || (!editingPrice && n === 0)) return toast.error('请填写有效金额')
                if (!reason.trim() && !proof) return toast.error('请填写备注或粘贴截图')
                lock.current = true; setSaving(true)
                try {
                  const ok = editingPrice ? await updateOrder(v.id, { basePrice: n }, { reason: reason.trim(), proof }) : await addAdjustment(v.id, n * sign, reason.trim(), proof)
                  if (ok) close()
                } finally { lock.current = false; setSaving(false) }
              }}
            >
              <fieldset disabled={saving || reading} className="grid gap-2">
                <div className="flex items-center gap-2">
                  {editingPrice ? <span className="text-xs text-muted-foreground">修改原价</span> : <div className="flex rounded-md border p-0.5">
                    {([1, -1] as const).map(x => <button type="button" key={x} onClick={() => setSign(x)} className={cn('rounded px-2 py-1 text-xs', sign === x ? 'bg-accent text-foreground' : 'text-muted-foreground')}>{x === 1 ? '追加' : '减免'}</button>)}
                  </div>}
                  <input autoFocus aria-label="金额" inputMode="decimal" className={cn(inputCls, 'num h-8 w-32 text-right')} placeholder="金额" value={amt} onChange={e => setAmt(e.target.value)} />
                </div>
                <FinancialNote note={reason} proof={proof} onNote={setReason} onProof={setProof} onReading={setReading} disabled={saving || reading} required />
                <div className="flex justify-end gap-2">
                  <Button size="sm" className="h-8" type="submit">{saving ? '保存中…' : '保存'}</Button>
                  <Button size="sm" variant="ghost" className="h-8" type="button" onClick={close}>取消</Button>
                </div>
              </fieldset>
            </motion.form>
          )}
        </AnimatePresence>
        <div className="mt-1 flex h-9 items-center justify-between border-t pt-1 font-medium">
          <span>{v.salesMode === 'cost' ? '销售应付' : '销售额'}</span>
          <Money value={v.sales} plain className="text-gold" />
        </div>
      </div>
    </section>
  )
}

export function Payments({ v, compact, formOpen = true, onFormOpen }: { v: OrderView; compact?: boolean; formOpen?: boolean; onFormOpen?: (o: boolean) => void }) {
  const { s, can, user, role } = useSession()
  const [tag, setTag] = useState(v.status === '退单' ? '退款' : v.received ? '尾款' : '定金')
  useEffect(() => { if (v.status === '退单') setTag('退款') }, [v.status])
  const [amt, setAmt] = useState(()=>v.unpaid&&v.unpaid>0?String(v.unpaid):'')
  const [date, setDate] = useState(iso(today()))
  const [note, setNote] = useState('')
  const [proof, setProof] = useState<string>()
  const [hint, setHint] = useState('')
  const [over, setOver] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const paymentLock = useRef(false)
  const [readingProof, setReadingProof] = useState(false)
  const proofLock = useRef(false)
  const setProofReading = (value: boolean) => { proofLock.current = value; setReadingProof(value) }
  const feedback = useOperationFeedback()
  const reduce = useReducedMotion()
  const { me } = useSession()
  const animationKey = `${me.id}:${role.id}:${role.fields?.sales}`

  async function takeImage(f: File) {
    if (paymentLock.current || proofLock.current) return
    setProofReading(true)
    try {
      const next = await thumb(f, 1600)
      if (!next) { toast.error('图片无法读取，原凭证已保留'); return }
      setProof(next); setHint('凭证已添加')
    } catch { toast.error('凭证读取失败，请重试') }
    finally { setProofReading(false) }
  }
  function takeText(text: string) {
    const r = parsePaymentText(text, s.payTags)
    if (r.amount) setAmt(r.amount)
    if (r.date) setDate(r.date)
    if (r.tag) setTag(r.tag)
    setHint(r.amount ? `已认出：${[r.amount && `¥${r.amount}`, r.date, r.tag].filter(Boolean).join(' · ')}，核对后点「保存收款」` : '没认出金额，手填一下')
  }
  const half = Math.round(Math.max(v.unpaid ?? 0,0) / 2 * 100) / 100
  // 收起再展开保留尚未提交的金额，成功保存后才按最新未收预填。
  useEffect(() => { if (formOpen) setAmt(old => old || (v.unpaid && v.unpaid > 0 ? String(v.unpaid) : '')) }, [formOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const live = v.payments!.filter((p) => !p.revoked).length
  const body = (
    <div className="grid gap-3">
      {!compact && <div className="grid grid-cols-3 overflow-hidden rounded-lg border bg-muted/30">
        {[
          ['销售额', v.sales, 'text-gold'],
          ['已收', v.received, ''],
          // 收多了不显示负数，写「多收」，和订单表、概览一致
          (v.unpaid ?? 0) < 0 ? ['多收', -v.unpaid!, 'text-danger'] : ['未收', v.unpaid, 'text-foreground'],
        ].map(([l, n, t]) => (
          <div key={l as string} className="border-r px-3 py-2.5 last:border-r-0">
            <div className="text-[12px] text-muted-foreground">{l}</div>
            <div className={cn("num mt-0.5 text-[14px]", t as string)}><AnimatedNumber value={n as number | undefined} format={money} animateOnMount={false} animationKey={animationKey}/></div>
          </div>
        ))}
      </div>}

      {!compact && <ReceivablesSection v={v} />}

      {can('payment.create') && formOpen && (
        <form data-order-field={compact ? undefined : '收款'}
          className={cn('grid gap-2 rounded-lg border p-3 transition-colors', over && 'border-primary bg-primary/[0.06]')}
          onPaste={(e) => {
            const img = imageFilesFromTransfer(e.clipboardData)[0]
            if (img) {
              e.preventDefault()
              e.stopPropagation()
              void takeImage(img)
              return
            }
            const text = e.clipboardData.getData('text')
            if (text && /[¥￥元块]|转账|收款|到账/.test(text) && (e.target as HTMLElement).getAttribute('aria-label') !== '金额备注') {
              e.preventDefault()
              takeText(text)
            }
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            e.stopPropagation()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOver(false)
            const img = imageFilesFromTransfer(e.dataTransfer)[0]
            if (!img) { toast.error('未收到图片，请点选图片或粘贴'); return }
            void takeImage(img)
          }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (paymentLock.current || proofLock.current) return
            const n = Number(amt)
            if (!n) return toast.error('填一下金额')
            if (!role.locked && !note.trim() && !proof) return toast.error('请填写收款备注或粘贴截图')
            paymentLock.current = true; setSavingPayment(true)
            const wasOutstanding = v.unpaid !== undefined && v.unpaid > 0 && v.status !== '退单'
            const labels = { saving: '正在保存收款', success: '收款已保存' }
            try { await feedback.run(async report => {
              const saved = await addPayment(v.id, { amount: n, date, tag, note, proof }, { onResult: report })
              if (saved) {
                const confirmed = getConfirmedOrder(v.id)
                if (wasOutstanding && confirmed?.sales !== undefined && confirmed.sales > 0 && confirmed.unpaid !== undefined && confirmed.unpaid <= 0 && confirmed.status !== '退单') labels.success = '已收齐'
                toast.success(`已记一笔${tag} ${money(n)}`)
                onFormOpen?.(false)
                setAmt('')
                setNote('')
                setProof(undefined)
                setHint('')
              }
              return saved
            }, labels) } finally { paymentLock.current = false; setSavingPayment(false) }
          }}
        >
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          <fieldset disabled={savingPayment || readingProof} className="grid gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {s.payTags.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => {
                  setTag(t)
                  if (t === '尾款' || t === '全款') setAmt(String(Math.max(v.unpaid!, 0)))
                }}
                className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors', tag === t ? (t === '退款' ? 'border-danger bg-danger/10 text-danger' : 'border-primary bg-primary/10 text-primary') : 'hover:bg-accent')}
              >
                {t}
              </button>
            ))}

          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative w-28">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">¥</span>
              <input aria-label="金额" className={cn(inputCls, 'num h-8 pl-6 text-right')} placeholder="金额" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
            </div>
            <DateField aria-label="日期" className={cn(inputCls, 'num h-8 w-40')} value={date} onChange={(e) => setDate(e.target.value)} />
            <Button size="sm" className="h-8" type="submit" disabled={savingPayment || readingProof} aria-busy={savingPayment || readingProof}>
              {savingPayment ? '保存中…' : tag === '退款' ? '保存退款' : '保存收款'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[12px] text-muted-foreground">金额</span>
            {[
              ['收齐剩余', Math.max(v.unpaid ?? 0, 0)],
              ['剩余一半', half],
            ]
              .filter(([, n]) => (n as number) > 0)
              .map(([l, n]) => (
                <button
                  type="button"
                  key={l as string}
                  onClick={() => setAmt(String(n))}
                  className="num rounded-full border border-dashed border-input px-2 py-0.5 text-[12px] text-muted-foreground hover:border-primary hover:text-primary"
                >
                  {l} ¥{n}
                </button>
              ))}
          </div>

          <FinancialNote note={note} proof={proof} onNote={setNote} onProof={setProof} onReading={setProofReading} disabled={savingPayment || readingProof} required={!role.locked} />
          </fieldset>
        </form>
      )}

      <OperationStatus state={feedback.state} className="min-h-5"/>
      {v.payments!.length === 0 ? (
        compact ? (formOpen ? null : <p className="py-1 text-sm text-muted-foreground">还没有收款</p>) : <Empty icon={<Receipt size={20} />} title="还没有收款记录" hint="收到定金或全款后在上面记一笔" />
      ) : (
        <div className="grid">
          <AnimatePresence initial={false}>
          {[...v.payments!].reverse().map((p) => (
            <motion.div key={p.id} initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.18, ease: [0.2, 0.8, 0.2, 1] }} className="group flex items-center gap-3 border-b py-2.5 text-sm last:border-b-0">
              <span className={cn('tone rounded px-1.5 py-0.5 text-xs', p.revoked && 'opacity-50')} style={{ '--t': p.revoked ? 'var(--muted-foreground)' : p.tag === '退款' ? 'var(--danger)' : 'var(--ok)' } as React.CSSProperties}>
                {p.tag}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={p.note || undefined}>
                <span className={cn(p.revoked && 'line-through opacity-60')}>
                  <span className="num">{shortDate(p.date)}</span> · {user(p.by)?.name}
                  {p.note && ` · ${p.note}`}
                </span>
                {p.revoked && <RevokedNote r={p.revoked} />}
              </span>
              {p.proof && <Thumbs pics={[{ src: p.proof, name: `收款凭证-${p.date}.jpg` }]} className="shrink-0" imgClass="h-8 w-6" />}
              {p.receiptId && <ChannelReceiptLink id={p.receiptId}/>}
              {role.locked && !p.revoked && !p.receiptId && <RevokeButton what="收款" onRevoke={(r) => revokePayment(v.id, p.id, r)} />}
              <Money value={p.tag === '退款' ? -Math.abs(p.amount) : p.amount} className={cn(p.revoked ? 'text-muted-foreground line-through opacity-60' : p.tag === '退款' ? 'text-danger' : '')} />
            </motion.div>
          ))}
          </AnimatePresence>
        </div>
      )}
      {compact && <ReceivablesSection v={v} />}
    </div>
  )
  if (!compact) return body
  return (
    <Section
      title="收款"
      count={live || undefined}
      field="收款"
      action={formOpen ? <button type="button" onClick={() => onFormOpen?.(false)} className="text-xs text-muted-foreground hover:text-foreground">收起</button> : undefined}
    >
      {body}
    </Section>
  )
}

/** 已撤销的记录：谁、什么时候、为什么 */
function RevokedNote({ r }: { r: NonNullable<NonNullable<OrderView['payments']>[number]['revoked']> }) {
  const { user } = useSession()
  return (
    <span className="ml-1.5 text-xs text-danger" title={`${user(r.by)?.name ?? ''} ${relTime(r.at)} 撤销：${r.reason}`}>
      已撤销 · {r.reason}
    </span>
  )
}

/** 撤销记错的收款、追加 / 减免（只给管理员）：填原因，记录保留，不再计入金额 */
function RevokeButton({ what, onRevoke }: { what: string; onRevoke: (reason: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setReason('')
      }}
    >
      <PopoverTrigger asChild>
        <button aria-label={`撤销这笔${what}`} title="记错了？撤销这笔" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:data-[state=open]:opacity-100">
          <ArrowCounterClockwise size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!reason.trim()) return toast.error('写一下撤销原因')
            if (await onRevoke(reason.trim())) {
              toast.success(`已撤销这笔${what}`)
              setOpen(false)
              setReason('')
            }
          }}
        >
          <div className="text-sm font-medium">撤销这笔{what}</div>
          <p className="text-xs text-muted-foreground">记录保留并标为「已撤销」，不再计入金额。填错了就撤销后重新记一笔。</p>
          <input autoFocus aria-label="撤销原因" className={cn(inputCls, 'h-8')} placeholder="原因，如金额多写了一个 0" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7" type="button" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="destructive" className="h-7" type="submit">
              撤销
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function Activity({ id }: { id: string }) {
  const { s, user } = useSession()
  // 按看的人的权限从服务端取：写手看不到改价、收款、工资这类改动
  const [list, setList] = useState<{ id: string; at: string; actorId: string; action: string; field?: string; from?: string; to?: string; note?: string; proof?: string | null }[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/orders/${id}/activity`)
      .then((r) => (r.ok ? r.json() : []))
      .then((x) => alive && setList(x))
    return () => {
      alive = false
    }
  }, [id, s])
  if (!list) return <SkeletonRows rows={4}/>
  if (!list.length) return <p className="py-2 text-sm text-muted-foreground">还没有改动，以后每次修改都会记在这里</p>
  return (
    <ol className="relative ml-2.5 border-l">
      {list.map((a) => (
        <li key={a.id} className="relative pb-4 pl-5">
          <span className="absolute -left-[11px] top-0">
            <Avatar user={user(a.actorId)} size={21} />
          </span>
          <div className="text-sm">
            <span className="font-medium">{user(a.actorId)?.name}</span> <span className="text-muted-foreground">{a.action}</span>
            {a.field && <span> {a.field}</span>}
          </div>
          {(a.from || a.to) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              {a.from && <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger line-through decoration-danger/40">{a.from}</span>}
              {a.from && a.to && <span className="text-muted-foreground">→</span>}
              {a.to && <span className="rounded bg-ok/10 px-1.5 py-0.5 text-ok">{a.to}</span>}
            </div>
          )}
          <FinancialNoteView note={a.note} proof={a.proof} />
          <div className="mt-1 text-xs text-muted-foreground">{relTime(a.at)}</div>
        </li>
      ))}
      <li className="relative pl-5 text-xs text-muted-foreground">
        <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border bg-background" />
        <Info size={12} className="mr-1 inline" />
        迁移前的改动在飞书里，这里从导入开始记
      </li>
    </ol>
  )
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['doc', 'docx'].includes(ext)) return <FileDoc size={20} className="text-info" />
  if (ext === 'pdf') return <FilePdf size={20} className="text-danger" />
  if (['zip', 'rar', '7z'].includes(ext)) return <FileZip size={20} className="text-warn" />
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileXls size={20} className="text-ok" />
  if (['ppt', 'pptx'].includes(ext)) return <FilePpt size={20} className="text-warn" />
  return <FileText size={20} className="text-muted-foreground" />
}

export function Files({ v, onFiles }: { v: OrderView; onFiles: (l: FileList | File[], opts?: UploadOptions) => Promise<boolean> }) {
  const { user, can } = useSession()
  const { rewrite } = useNav()
  const [pic, setPic] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploadingRef = useRef(false)
  const pending = useRef<File[] | null>(null)
  const [uploads, setUploads] = useState<{ file: File; phase: UploadPhase; progress?: number; message?: string }[]>([])
  const feedback = useOperationFeedback()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function add(batch: File[]) {
    if (uploadingRef.current || !batch.length) return
    if (pending.current && pending.current !== batch) { toast('先继续上传未完成的文件'); return }
    if (!pending.current) setUploads(batch.map(file => ({ file, phase: 'waiting' })))
    pending.current = batch
    uploadingRef.current = true; setUploading(true)
    try {
      const saved = await feedback.run(report => onFiles(batch, {
        silent: true, onResult: report,
        onFile: event => { if (mounted.current) setUploads(old => old.map((row, i) => i === event.index ? { file: row.file, phase: event.phase, progress: event.progress, message: event.message } : row)) },
      }), { saving: `正在上传 ${batch.length} 份文件`, success: '文件已上传' })
      if (saved) { pending.current = null; if (mounted.current) setUploads([]) }
    } finally { uploadingRef.current = false; if (mounted.current) setUploading(false) }
  }
  const files = [...v.attachments].reverse()
  const pics = files.filter((f) => isImageName(f.name, f.mime)).map((f) => ({ src: fileUrl(f.id, true), thumb: f.preview, download: fileUrl(f.id), name: f.name }))
  return (
    <div className="grid gap-3">
      <div role="group" aria-label="添加附件" tabIndex={0}
        aria-busy={uploading}
        onClick={e => { if (!(e.target as HTMLElement).closest('button, input')) e.currentTarget.focus({ preventScroll: true }) }}
        onPaste={e => { const images = imageFilesFromTransfer(e.clipboardData); if (images.length) { e.preventDefault(); e.stopPropagation(); void add(images) } }}
        onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation() } }}
        onDrop={e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); void add(Array.from(e.dataTransfer.files)) } }}
        className="flex min-h-16 items-center justify-between gap-3 rounded-lg border bg-background p-3 outline-none transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
        <span className="text-sm text-muted-foreground">{uploading ? '正在上传…' : '订单附件'}</span>
        <ImageInputActions pickerOnly accept="*" pickLabel="上传文件" ariaLabel="订单附件" onFiles={add} disabled={uploading || !!pending.current}/>
      </div>
      {uploads.length > 0 && <div className="grid gap-2" aria-label="待上传附件">
        {uploads.map((item, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_120px] items-center gap-3 rounded-md border px-3 py-2">
          <span className="truncate text-xs" title={item.file.name}>{item.file.name}</span>
          <span className="sr-only" role={item.phase === 'error' || item.phase === 'uncertain' ? 'alert' : 'status'}>{item.file.name}：{({ waiting: '等待上传', reading: '读取中', uploading: '上传中', saving: '保存中', uploaded: '已上传', error: '上传失败', uncertain: '结果待确认' })[item.phase]}</span>
          <div title={item.message}><UploadState phase={item.phase} progress={item.progress}/></div>
        </div>)}
      </div>}
      <div className="flex min-h-5 flex-wrap items-center gap-2">
        <OperationStatus state={feedback.state}/>
        {!uploading && pending.current && <Button type="button" size="sm" variant="outline" onClick={() => pending.current && void add(pending.current)}>继续上传</Button>}
      </div>
      {v.attachments.length === 0 ? null : (
        <div className="grid">
          {files.map((f) => {
            const k = pics.findIndex((p) => p.download === fileUrl(f.id))
            return (
              <div key={f.id} className="group flex items-center gap-3 border-b py-2.5 last:border-b-0">
                {k >= 0 ? (
                  <button type="button" onClick={() => setPic(k)} className="shrink-0 rounded-md outline-none hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring" aria-label={`看大图 ${f.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img loading="lazy" decoding="async" src={f.preview ?? thumbnailSource(f.id)} alt="" className="h-10 w-10 rounded-md border object-cover" />
                  </button>
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border bg-muted/40">{fileIcon(f.name)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <a href={fileUrl(f.id)} download={f.name} className="block truncate text-sm hover:text-primary hover:underline" title={`下载 ${f.name}`}>
                    {f.name}
                  </a>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="num">{fileSize(f.size)}</span> · <Avatar user={user(f.by)} size={14} /> {user(f.by)?.name} · {relTime(f.at)}
                  </div>
                </div>
                {can('toolbox.use') && /\.docx$/i.test(f.name) && f.size <= 10 * 1024 * 1024 && (
                  <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={() => rewrite(v.id, f.id)}>降重 / 降 AI</Button>
                )}
                {k < 0 && <PreviewButton id={f.id} name={f.name} size={f.size} mime={f.mime} />}
                <a href={fileUrl(f.id)} download={f.name} aria-label={`下载 ${f.name}`} title="下载" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary">
                  <DownloadSimple size={16} />
                </a>
                <button aria-label={`删除 ${f.name}`} onClick={() => void removeAttachment(f.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-danger md:opacity-0 md:group-hover:opacity-100">
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <ImageViewer pics={pics} index={pic} onIndex={setPic} />
    </div>
  )
}
