import { SelectField } from './SelectField'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { RewriteJobView } from '@/shared/toolbox'
import { renderWordDocument } from './preview/render-word'
import { downloadWordPreview } from './preview/download-word'
import { fileSize } from './files'

function WordPane({ url, size }: { url: string; size?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState('loading')
  const [retry, setRetry] = useState(0)
  const [download, setDownload] = useState({ loaded: 0, total: 0 })
  const [forced, setForced] = useState(false)
  const big = (size ?? 0) > 20 * 1024 * 1024 && !forced
  useEffect(() => {
    if (big || !host.current) return
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
    const style = document.createElement('div'), body = document.createElement('div'), fitStyle = document.createElement('style')
    fitStyle.textContent = '.docx-wrapper{padding:12px;background:transparent}.docx-wrapper>section.docx{margin-bottom:16px;box-shadow:0 1px 4px #0002} :host{display:block;color:#111;font-family:serif}'
    root.replaceChildren(style, fitStyle, body)
    const ctrl = new AbortController()
    let observer: ResizeObserver | undefined
    setState('loading')
    setDownload({ loaded: 0, total: 0 })
    downloadWordPreview(url, ctrl.signal, setDownload)
      .then(async (blob) => { if (!ctrl.signal.aborted) await renderWordDocument(blob, body, style) })
      .then(() => {
        if (ctrl.signal.aborted) return
        const fit = () => {
          const page = body.querySelector('section.docx') as HTMLElement | null
          if (page && host.current) body.style.zoom = String(Math.min(1, Math.max(0.15, host.current.clientWidth / (page.offsetWidth + 24))))
        }
        fit(); observer = new ResizeObserver(fit); observer.observe(host.current!)
        setState('ready')
      })
      .catch((e) => { if (!ctrl.signal.aborted) setState(e.name === 'TimeoutError' || e.name === 'AbortError' ? '预览连接超时，请重试' : e.message ?? '预览失败') })
    return () => { ctrl.abort(); observer?.disconnect() }
  }, [url, retry, big])
  return <div className="min-h-full" data-word-state={big ? 'big' : state}>
    {big ? <div className="grid justify-items-center gap-3 p-8 text-sm text-muted-foreground"><p>文件较大，预览需要一些时间。</p><Button size="sm" variant="outline" onClick={() => setForced(true)}>继续预览</Button></div>
      : state === 'loading' ? <p role="status" className="p-6 text-center text-sm text-muted-foreground">{download.total > 0 && download.loaded >= download.total ? '正在排版 Word…' : `正在读取 Word…${download.loaded ? ` ${fileSize(download.loaded)}${download.total ? ` / ${fileSize(download.total)}` : ''}` : ''}`}</p>
        : state !== 'ready' && <div role="alert" className="grid justify-items-center gap-3 p-8 text-sm"><p>{state}</p><Button size="sm" variant="outline" onClick={() => setRetry((n) => n + 1)}>重新预览</Button></div>}
    <div ref={host} />
  </div>
}

export function ToolboxComparison({ job, onClose }: { job: RewriteJobView | null; onClose: () => void }) {
  const [selection, setSelection] = useState<{ jobId: string; variant: string } | null>(null)
  const variant = selection && selection.jobId === job?.id ? selection.variant : job?.hasDiff ? 'diff' : 'result'
  const [sync, setSync] = useState(true)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [copyLabel, setCopyLabel] = useState('复制结果')
  const panes = useRef<(HTMLDivElement | null)[]>([])
  const scrollLock = useRef(false)
  useEffect(() => {
    setData(null); setError(''); setCopyLabel('复制结果')
    if (!job) return
    const ctrl = new AbortController()
    fetch(`/api/toolbox/${job.id}/preview`, { signal: ctrl.signal, cache: 'no-store' }).then(async (r) => {
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? '读取失败'); if (!ctrl.signal.aborted) setData(d)
    }).catch((e) => { if (!ctrl.signal.aborted) setError(e.message) })
    return () => ctrl.abort()
  }, [job?.id])
  const text = job?.inputKind === 'text'
  const href = (v = 'result') => `/api/toolbox/${job?.id}/result?variant=${v}`
  const scroll = (index: number) => {
    const current = panes.current[index], other = panes.current[1 - index]
    if (!sync || scrollLock.current || !current || !other) return
    const max = current.scrollHeight - current.clientHeight
    if (max <= 0) return
    scrollLock.current = true
    other.scrollTop = current.scrollTop / max * (other.scrollHeight - other.clientHeight)
    requestAnimationFrame(() => { scrollLock.current = false })
  }
  return <Dialog open={!!job} onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className="flex h-[92dvh] max-w-[96vw] flex-col gap-3 overflow-hidden p-4 sm:p-5">
    <DialogHeader className="shrink-0 pr-7"><DialogTitle>改写前后对比</DialogTitle><DialogDescription className="truncate">{job?.name} · Word 预览与附件预览共用引擎，下载文件保留完整内容和颜色</DialogDescription></DialogHeader>
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
      <a href={href('source')} className="rounded-md border px-3 py-2 hover:bg-accent">下载原文件</a>
      <a href={href()} className="rounded-md bg-primary px-3 py-2 text-primary-foreground">下载改写文件</a>
      {job?.hasDiff && <a href={href('diff')} className="rounded-md border px-3 py-2 text-primary hover:bg-accent">下载彩色对比文档</a>}
      <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />同步滚动</label>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 sm:gap-4">
      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-muted/25" aria-label="原稿预览">
        <div className="flex h-11 shrink-0 items-center justify-between border-b bg-card px-3 text-sm font-medium"><span>原稿</span><span className="text-xs font-normal text-muted-foreground">{job?.sourceSize !== undefined && fileSize(job.sourceSize)}</span></div>
        <div ref={(el) => { panes.current[0] = el }} onScroll={() => scroll(0)} className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {text ? <div className="whitespace-pre-wrap p-4 text-sm leading-7">{data?.originalText ?? (data ? '' : '正在读取…')}</div> : job && <WordPane key={`${job.id}:source`} url={href('source')} size={job.sourceSize} />}
        </div>
      </section>
      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-muted/25" aria-label="结果预览">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 text-sm font-medium">
          {job?.hasDiff ? <SelectField aria-label="右侧稿件" className="w-auto min-w-0 rounded border bg-background px-2 py-1 text-xs" value={variant} onChange={(e) => { if (job) setSelection({ jobId: job.id, variant: e.target.value }) }}><option value="diff">彩色对比稿</option><option value="result">改写稿</option></SelectField> : <span>改写稿</span>}
          {text ? <button className="shrink-0 text-xs text-primary" onClick={() => { void navigator.clipboard.writeText(data?.resultText ?? '').then(() => setCopyLabel('已复制')).catch(() => setCopyLabel('请手动复制')) }}>{copyLabel}</button> : <span className="text-xs font-normal text-muted-foreground">{variant === 'result' && job?.resultSize !== undefined && fileSize(job.resultSize)}</span>}
        </div>
        <div ref={(el) => { panes.current[1] = el }} onScroll={() => scroll(1)} className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {text ? <div className="whitespace-pre-wrap p-4 text-sm leading-7">{data?.resultText ?? '正在读取…'}</div>
              : job && <WordPane key={`${job.id}:${variant}`} url={href(variant)} size={variant === 'result' ? job.resultSize : undefined} />}
        </div>
      </section>
    </div>
    {!text && <p className="shrink-0 text-center text-[11px] text-muted-foreground">彩色标记由通道提供，分页显示以 Word 打开后的效果为准。</p>}
  </DialogContent></Dialog>
}
