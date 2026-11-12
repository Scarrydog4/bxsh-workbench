import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CaretLeft, CaretRight, Check, CopySimple } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { AppDialogBody, AppDialogContent, AppDialogHeader } from '@/components/ui/app-dialog'
import type { Material } from '@/shared/work-materials'
import { useCopyFeedback } from '../copy-feedback'
import { caseImagePng, copyCaseImage } from './case-image-copy'

function useImageCopy(src: string, name: string) {
  const feedback = useCopyFeedback(src)
  return {
    state: feedback.state,
    copy: async () => {
      const ok = await feedback.copy(() => copyCaseImage(src))
      if (ok) toast.success('已复制' + name + '，可以粘贴到微信')
      else if (ok === false) toast.error('复制失败，请下载图片后发送')
    },
  }
}

function Thumb({ src, index, active, open }: { src: string; index: number; active: boolean; open: () => void }) {
  const name = '第 ' + (index + 1) + ' 张'
  const { state, copy } = useImageCopy(src, name)
  return <div className="relative w-28 shrink-0 md:w-full">
    <button type="button" aria-label={'查看' + name} aria-current={active} onClick={open}
      className={'block w-full overflow-hidden rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring ' + (active ? 'border-primary ring-1 ring-primary' : '')}>
      <img src={src + '&thumb=1'} alt="" className="aspect-[16/10] w-full object-cover"/>
    </button>
    <button type="button" aria-label={'复制' + name} title={'复制' + name} aria-busy={state === 'copying'} onClick={copy}
      className="absolute right-1 top-1 grid size-7 place-items-center rounded-md border bg-card text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
      {state === 'copied' ? <Check size={15} aria-hidden/> : <CopySimple size={15} aria-hidden/>}
    </button>
  </div>
}

export function CasePreview({ entry, index, select, close, actions }: { entry: Material; index: number; select: (index: number) => void; close: () => void; actions: ReactNode }) {
  const images = entry.images, src = images[index], many = images.length > 1
  const [full, setFull] = useState(false)
  const [loaded, setLoaded] = useState('')
  const [failed, setFailed] = useState('')
  const main = useImageCopy(src, many ? '第 ' + (index + 1) + ' 张' : '图片')
  const go = (next: number) => { setFull(false); select((next + images.length) % images.length) }
  useEffect(() => { void caseImagePng(src).catch(() => undefined) }, [src])
  function keys(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]')) return
    if (event.key === 'ArrowLeft' && many) { event.preventDefault(); go(index - 1) }
    else if (event.key === 'ArrowRight' && many) { event.preventDefault(); go(index + 1) }
    else if (event.key.toLowerCase() === 'c' && !String(window.getSelection() ?? '')) { event.preventDefault(); void main.copy() }
  }
  const round = 'absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border bg-card text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring'
  return <Dialog open onOpenChange={open => !open && close()}>
    <AppDialogContent size="lg" aria-describedby={undefined} onKeyDown={keys} className="sm:h-[min(760px,calc(100dvh-48px))] sm:w-[min(1040px,calc(100vw-32px))]">
      <AppDialogHeader className="py-3 sm:py-3"><DialogTitle className="truncate">{entry.title}</DialogTitle></AppDialogHeader>
      <AppDialogBody className="flex min-h-0 flex-col gap-3 p-4">
        <div className={'grid min-h-0 flex-1 gap-3 ' + (many ? 'md:grid-cols-[minmax(0,1fr)_132px]' : '')}>
          <div className="relative min-h-[240px] overflow-hidden rounded-lg bg-muted/40">
            {loaded !== src && <div role="status" className="image-placeholder absolute inset-0 grid place-items-center text-sm text-muted-foreground">{failed === src ? '图片暂时无法加载，请切换图片或稍后重试' : '正在加载图片…'}</div>}
            <div className="absolute inset-0 overflow-auto">
              <button type="button" aria-pressed={full} aria-label={full ? '适应窗口' : '查看原尺寸'} title={full ? '适应窗口' : '查看原尺寸'} onClick={() => setFull(!full)}
                className={'block focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ' + (full ? 'cursor-zoom-out' : 'size-full cursor-zoom-in')}>
                <img key={src} src={src} alt={entry.title + ' · ' + (index + 1)} onLoad={() => setLoaded(src)} onError={() => setFailed(src)} className={(loaded === src ? 'case-preview-image ' : 'opacity-0 ') + (full ? 'block max-w-none' : 'size-full object-contain')}/>
              </button>
            </div>
            <button type="button" aria-busy={main.state === 'copying'} onClick={main.copy} className="absolute right-3 top-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              {main.state === 'copied' ? <Check size={16} aria-hidden/> : <CopySimple size={16} aria-hidden/>}
              {main.state === 'copying' ? '复制中' : main.state === 'copied' ? '已复制' : '复制'}
              <kbd className="hidden rounded bg-white/20 px-1.5 text-xs font-normal sm:inline">C</kbd>
            </button>
            {many && <>
              <button type="button" aria-label="上一张" onClick={() => go(index - 1)} className={round + ' left-3'}><CaretLeft size={16} aria-hidden/></button>
              <button type="button" aria-label="下一张" onClick={() => go(index + 1)} className={round + ' right-3'}><CaretRight size={16} aria-hidden/></button>
              <span aria-live="polite" className="absolute bottom-3 left-3 rounded bg-black/65 px-2 py-0.5 text-xs text-white">{index + 1} / {images.length}</span>
            </>}
          </div>
          {many && <div className="flex gap-2 overflow-auto p-0.5 md:flex-col">
            {images.map((image, i) => <Thumb key={image + i} src={image} index={i} active={i === index} open={() => go(i)}/>)}
          </div>}
        </div>
        <div className="flex shrink-0 items-start justify-between gap-4">
          <p className="max-h-20 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry.content}</p>
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        </div>
      </AppDialogBody>
    </AppDialogContent>
  </Dialog>
}
