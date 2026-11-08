import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageSquare, X } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { uploadDeliveryShot, finishAfterSale, markDraft, markDemo, useSession, refreshOrders } from './store'
import { thumbnailSource, isImageName } from './ImageViewer'
import { ImageInputActions } from './ImageInputActions'
import { IMAGE_INPUT_EMPTY_MESSAGE, imageFilesFromTransfer } from './image-input'
import { CopyOrderName } from './CopyOrderName'
import { UploadState, type UploadPhase } from './UploadState'
import { imageArrivalClass, useImageReceiveFeedback } from './useImageReceiveFeedback'
import { FEEDBACK_MS, type ActionOptions, type ActionResult } from './operation-feedback'

type Shot = { file: File; url: string; phase: UploadPhase; progress: number }

/**
 * 交初稿、交付跟进都要附一张截图作凭证。
 * 打开后聚焦截图接收区，Ctrl+V 直接粘贴；整个面板都可拖图，有截图才能确认。
 */
export function DeliverButton(props: DeliveryProps) {
  return <DeliveryForm key={`${props.orderId}:${props.kind}:${props.asId ?? ''}`} {...props} />
}

type DeliveryProps = {
  kind: 'draft' | 'aftersale'
  userId?: string
  onBusyChange?: (busy: boolean) => void
  orderId: string
  asId?: string
  no?: string
  label?: string
  variant?: 'default' | 'outline' | 'ghost'
  className?: string
}

export function DeliveryForm({
  kind,
  orderId,
  asId,
  onBusyChange,
  no,
  label,
  variant = 'outline',
  className,
}: DeliveryProps) {
  const { order } = useSession()
  const current = order(orderId)
  const prefix = kind === 'draft' ? '初稿交付截图' : '售后交付截图'
  const saved = (kind !== 'aftersale' ? current?.attachments : current?.afterSales.find(a => a.id === asId)?.files) ?? []
  const available = saved.filter(f => isImageName(f.name) && f.name.startsWith(prefix))
  const proofLabel = '群内发稿截图'
  const [deliveryMode, setDeliveryMode] = useState<'delivery' | 'demo'>('delivery')
  const demo = kind === 'draft' && deliveryMode === 'demo'
  const confirmLabel = demo ? '确认已发演示' : '确认交付'
  const successLabel = demo ? '✓ 已记录演示' : '✓ 已确认交付'
  const [open, setOpen] = useState(false)
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [readingImages, setReadingImages] = useState(false)
  const [need, setNeed] = useState(false)
  const [over, setOver] = useState(false)
  const imageFeedback = useImageReceiveFeedback()
  const [selected, setSelected] = useState<string[]>([])
  const [progress, setProgress] = useState('')
  const [failed, setFailed] = useState<ActionResult | null>(null)
  const [success, setSuccess] = useState(false)
  const uploaded = useRef(new Map<File, string>())
  const working = useRef(false), imageReading = useRef(false)
  const onImageReading = (value: boolean) => { imageReading.current = value; setReadingImages(value); onBusyChange?.(value || working.current) }
  const zone = useRef<HTMLDivElement>(null)
  const pasteTarget = useRef<HTMLTextAreaElement>(null)
  const urls = useRef(new Set<string>())
  const mounted = useRef(true)
  const successTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const finishSuccess = useRef<(() => void) | undefined>(undefined)
  const text = label ?? '交付'

  function add(files: File[]) {
    if (working.current) return
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return toast(IMAGE_INPUT_EMPTY_MESSAGE)
    if (shots.length + selected.length + imgs.length > 20) return toast('一次最多附 20 张截图')
    imageFeedback.acknowledge()
    const start = shots.length
    setShots((old) => [
      ...old,
      ...imgs.map((f, i) => {
        const ext = f.type.split('/')[1] || 'png'
        const name = `${prefix}${no ? '-' + no : ''}-${start + i + 1}.${ext}`
        const url = URL.createObjectURL(f)
        urls.current.add(url)
        return { file: new File([f], name, { type: f.type }), url, phase: 'reading' as const, progress: 0 }
      }),
    ])
    setNeed(false)
  }

  useEffect(() => {
    mounted.current = true
    const owned = urls.current
    return () => {
      mounted.current = false
      clearTimeout(successTimer.current)
      finishSuccess.current?.()
      owned.forEach(url => URL.revokeObjectURL(url)); owned.clear()
    }
  }, [])

  function updateShot(file: File, patch: Partial<Pick<Shot, 'phase' | 'progress'>>, onlyReading = false) {
    if (!mounted.current) return
    setShots(old => old.map(shot => shot.file === file && (!onlyReading || shot.phase === 'reading') ? { ...shot, ...patch } : shot))
  }

  function remove(shot: Shot) {
    URL.revokeObjectURL(shot.url)
    urls.current.delete(shot.url)
    uploaded.current.delete(shot.file)
    setShots(old => old.filter(s => s.file !== shot.file))
  }

  async function confirm() {
    if (working.current || imageReading.current) return
    if (!shots.length && !selected.length) {
      setNeed(true)
      if (typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        zone.current?.classList.remove('cell-shake')
        void zone.current?.offsetWidth
        zone.current?.classList.add('cell-shake')
      }
      return
    }
    working.current = true
    setBusy(true)
    onBusyChange?.(true)
    setFailed(null)
    setSuccess(false)
    let uploadingFile: File | undefined
    try {
      for (const [index, { file }] of shots.entries()) {
        if (uploaded.current.has(file)) continue
        uploadingFile = file
        setProgress(`正在上传第 ${index + 1}/${shots.length} 张截图`)
        updateShot(file, { phase: 'uploading', progress: 0 })
        let failure: ActionResult = { status: 'error' }
        const id = await uploadDeliveryShot(file, { orderId, ...(kind === 'aftersale' ? { afterSaleId: asId! } : {}) }, p => {
          if (!mounted.current) return
          updateShot(file, { phase: p < 1 ? 'uploading' : 'saving', progress: p })
          setProgress(p < 1 ? `正在上传第 ${index + 1}/${shots.length} 张截图` : `正在保存第 ${index + 1}/${shots.length} 张截图`)
        }, { onResult: result => { if (result.status !== 'success') failure = result } })
        if (!mounted.current) return
        if (!id) { updateShot(file, { phase: failure.status === 'uncertain' ? 'uncertain' : 'error' }); setFailed(failure); return }
        uploaded.current.set(file, id)
        updateShot(file, { phase: 'uploaded', progress: 1 })
        uploadingFile = undefined
      }
      const proofIds = [...new Set([...selected, ...shots.map(s => uploaded.current.get(s.file)!)])]
      setProgress(demo ? '正在记录演示…' : '正在确认交付…')
      let failure: ActionResult = { status: 'error' }
      const feedback: ActionOptions = {
        onResult: result => { if (result.status !== 'success') failure = result },
        onConfirmed: async () => {
          toast.success(demo ? '已记录演示，正式交付仍待完成' : kind === 'draft' ? '订单已交付，截图已存档' : '跟进已交付，截图已存档')
          if (!mounted.current) return
          setSuccess(true)
          setProgress(demo ? '✓ 已记录演示，截图已存档' : '✓ 已确认交付，截图已存档')
          await new Promise<void>(resolve => {
            finishSuccess.current = resolve
            successTimer.current = setTimeout(() => { finishSuccess.current = undefined; resolve() }, FEEDBACK_MS.success)
          })
        },
      }
      const ok = kind === 'draft' ? await (demo ? markDemo : markDraft)(orderId, proofIds, feedback) : await finishAfterSale(orderId, asId!, proofIds, feedback)
      if (!mounted.current) return
      if (ok) {
        shots.forEach(remove)
        setSelected([])
        setOpen(false)
      } else {
        setFailed(failure)
      }
    } catch {
      if (mounted.current) {
        if (uploadingFile) updateShot(uploadingFile, { phase: 'uncertain' })
        setFailed({ status: 'uncertain' })
      }
    } finally {
      working.current = false
      if (mounted.current) setBusy(false)
      onBusyChange?.(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { if (working.current || imageReading.current) return; setOpen(o); if (o) void refreshOrders([orderId]) }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={variant} className={cn('h-7 shrink-0 px-2.5 text-xs', className)} onClick={(e) => e.stopPropagation()}>
          {text}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end" className={cn('w-80 max-w-[calc(100vw-24px)] p-3', over && 'border-primary ring-2 ring-primary/20')}
        onClick={(e) => {
          e.stopPropagation()
          if (!(e.target as HTMLElement).closest('button, input, textarea, [data-order-name]')) pasteTarget.current?.focus({ preventScroll: true })
        }}
        onPaste={(e) => {
          const files = imageFilesFromTransfer(e.clipboardData)
          if (!files.length && e.target !== pasteTarget.current) return
          e.preventDefault()
          e.stopPropagation()
          add(files)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
          setOver(true)
        }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          add(imageFilesFromTransfer(e.dataTransfer))
          pasteTarget.current?.focus({ preventScroll: true })
        }}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => { e.preventDefault(); pasteTarget.current?.focus({ preventScroll: true }) }}
      >
        <div className="mb-2 text-sm font-medium">{kind === 'draft' ? '交付订单' : '交付本次跟进'}</div>
        {current?.title && <div className="mb-3 flex items-start gap-1 text-xs text-muted-foreground">
          <span data-order-name className="min-w-0 flex-1 select-text whitespace-pre-wrap [overflow-wrap:anywhere]">{current.title}</span>
          <CopyOrderName title={current.title}/>
        </div>}
        {kind === 'draft' && <fieldset disabled={busy || readingImages || !!failed} className="mb-3 space-y-2">
          <div role="group" aria-label="交付方式" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <Button type="button" size="sm" variant={demo ? 'ghost' : 'secondary'} aria-pressed={!demo} onClick={() => setDeliveryMode('delivery')}>正式交付</Button>
            <Button type="button" size="sm" variant={demo ? 'secondary' : 'ghost'} aria-pressed={demo} disabled={current?.status === '已交付' || current?.status === '退单'} onClick={() => setDeliveryMode('demo')}>发演示</Button>
          </div>
          <p className="text-xs text-muted-foreground">{demo ? '已发演示后不再提示本单逾期，仍需正式交付；不触发工资结算。' : '正式交付将记录完成状态，请附群内发稿截图。'}</p>
        </fieldset>}
        <div
          ref={zone}
          role="group"
          aria-label="交付截图粘贴和拖入区域"
          className={cn(
            'relative grid min-h-[112px] place-items-center rounded-lg border bg-background p-3 pt-9 text-center text-xs text-muted-foreground transition-colors outline-none focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15',
            over && 'border-primary bg-primary/5 text-primary',
            need && 'border-danger text-danger',
            imageFeedback.className,
          )}
        >
          {/* 真正可编辑的接收器让 Safari 原生粘贴、右键粘贴和触屏粘贴可用。 */}
          <textarea ref={pasteTarget} aria-label="粘贴交付截图" aria-keyshortcuts="Meta+V Control+V" value="" onChange={() => {}} spellCheck={false} disabled={busy || readingImages} className="absolute inset-0 h-full w-full resize-none rounded-lg bg-transparent text-transparent caret-transparent outline-none" />
          <ImageInputActions pickerOnly pickLabel="上传截图" onFiles={files => { add(files) }} disabled={busy || readingImages} compact pasteTargetRef={pasteTarget} className="absolute right-2 top-2 z-10" onReading={onImageReading}/>
          {shots.length ? (
            <div className="pointer-events-auto relative flex max-h-60 flex-wrap justify-center gap-2 overflow-y-auto p-1.5">
              {shots.map((s, i) => (
                <div key={s.url} className={cn("relative w-20", imageArrivalClass)} role="group" aria-label={`截图 ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img decoding="async" draggable={false} src={s.url} alt={`截图 ${i + 1}`} onLoad={() => updateShot(s.file, { phase: 'waiting' }, true)} onError={() => updateShot(s.file, { phase: 'waiting' }, true)} className="h-16 w-full rounded-md border object-cover" />
                  <UploadState phase={s.phase} progress={s.progress} className="mt-1 text-left" />
                  <button type="button" aria-label="去掉这张" disabled={busy} onClick={() => remove(s)} className="pointer-events-auto absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border bg-background text-muted-foreground hover:text-foreground">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span className="pointer-events-none relative grid justify-items-center gap-1.5">
              <ImageSquare size={22} />
              <span>{proofLabel}</span>
              <kbd className="text-[10px] opacity-70">⌘V / Ctrl+V</kbd>
            </span>
          )}
        </div>
        {available.some(f => ![...uploaded.current.values()].includes(f.id)) && <div className="mt-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">已存交付截图 · 点选后直接确认</p>
          <div className="flex max-h-36 flex-wrap gap-2 overflow-auto">{available.filter(f => ![...uploaded.current.values()].includes(f.id)).map(f => <button key={f.id} type="button" disabled={busy} aria-label={`使用已存截图 ${f.name}`} aria-pressed={selected.includes(f.id)} className={cn('relative rounded border-2 p-0.5', selected.includes(f.id) ? 'border-primary bg-primary/10' : 'border-transparent')} onClick={() => { if (!selected.includes(f.id) && shots.length + selected.length >= 20) return toast('一次最多附 20 张截图'); setSelected(old => old.includes(f.id) ? old.filter(id => id !== f.id) : [...old, f.id]); setNeed(false) }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnailSource(f.id)} alt={f.name} loading="lazy" decoding="async" className="h-14 w-14 rounded object-cover" />
            {selected.includes(f.id) && <span className="absolute right-0 top-0 rounded-bl bg-primary px-1 text-xs text-primary-foreground">✓</span>}
          </button>)}</div>
        </div>}
        {need && <p role="alert" className="mt-1.5 text-xs text-danger">先附{proofLabel}</p>}
        {(busy || readingImages) && <p role="status" aria-live="polite" aria-atomic="true" className={cn('mt-2 text-xs', success ? 'text-ok' : 'text-muted-foreground')}>{readingImages ? '正在读取截图…' : progress}</p>}
        {failed && <p role="alert" className="mt-2 text-xs text-danger">{failed.status === 'uncertain' ? '网络中断，交付结果尚未确认。截图已保留，可重试继续。' : '交付尚未确认，截图已保留。点重试继续。'}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy || readingImages}>
            收起
          </Button>
          <Button size="sm" onClick={() => void confirm()} disabled={busy || readingImages} aria-busy={busy || readingImages}>
            {success && busy ? successLabel : busy ? '处理中…' : failed ? '重试确认' : confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
