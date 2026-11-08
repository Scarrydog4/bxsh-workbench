import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Sparkle, X } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSession } from './store'
import { IntakeFlow } from './AiIntake'

type Payload = { text: string; files: File[] }

/**
 * 全局粘贴录单：光标不在输入框时 ⌘V，右下角问一句「识别成订单？」，回车才开始。
 * 不理它 5 秒自己消失，所以误粘贴没有代价。
 */
export function AiIntakeHost() {
  const { can } = useSession()
  const [offer, setOffer] = useState<Payload | null>(null)
  const [open, setOpen] = useState<Payload | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef(false)
  const allowed = can('order.create')

  useEffect(() => {
    if (!allowed) return
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable=true]')) return
      if (document.querySelector('[role=dialog], [role=menu]')) return
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      const text = e.clipboardData?.getData('text')?.trim() ?? ''
      if (!files.length && text.length < 8) return
      e.preventDefault()
      setOffer({ text, files })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setOffer(null), 5000)
    }
    const onOpen = (e: Event) => {
      if (pending.current) { toast('这批订单还没处理完，请先继续保存'); return }
      const d = (e as CustomEvent<Partial<Payload>>).detail ?? {}
      setOpen({ text: d.text ?? '', files: d.files ?? [] })
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('bxsh:ai-intake', onOpen)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('bxsh:ai-intake', onOpen)
    }
  }, [allowed])

  useEffect(() => {
    if (!offer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        accept()
      } else if (e.key === 'Escape') setOffer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer])

  function accept() {
    if (!offer) return
    window.clearTimeout(timer.current)
    setOpen(offer)
    setOffer(null)
  }

  if (!allowed) return null
  const preview = offer ? (offer.files.length ? `${offer.files.length} 张截图${offer.text ? ' · ' : ''}` : '') + offer.text.replace(/\s+/g, ' ').slice(0, 28) : ''
  return (
    <>
      <AnimatePresence>
        {offer && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed bottom-6 right-6 z-[60] w-[300px] overflow-hidden rounded-xl border bg-popover shadow-md"
            role="status"
          >
            <button type="button" onClick={accept} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-accent/60">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Sparkle size={16} weight="fill" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">识别成订单？</span>
                <span className="block truncate text-xs text-muted-foreground">{preview}</span>
              </span>
              <span className="kbd">回车</span>
            </button>
            <button type="button" aria-label="不用了" onClick={() => setOffer(null)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded text-muted-foreground opacity-60 hover:opacity-100">
              <X size={11} />
            </button>
            <div className="h-0.5 origin-left bg-primary/50" style={{ animation: 'bubble-timer 5s linear forwards' }} />
          </motion.div>
        )}
      </AnimatePresence>
      <Dialog open={!!open} onOpenChange={(o) => { if (o) return; if (pending.current) { toast('这批订单还没处理完，请先继续保存'); return } setOpen(null) }}>
        <DialogContent className="max-h-[calc(100dvh-32px)] w-[calc(100vw-24px)] max-w-[980px] gap-4 overflow-y-auto p-5 sm:rounded-2xl">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkle size={16} weight="fill" className="text-primary" /> AI 录单
          </DialogTitle>
          <DialogDescription className="sr-only">识别渠道消息，核对后确认入库</DialogDescription>
          {open && <IntakeFlow initialText={open.text} initialFiles={open.files} autoStart={!!(open.text || open.files.length)} onPendingChange={(value) => { pending.current = value }} onClose={() => { pending.current = false; setOpen(null) }} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
