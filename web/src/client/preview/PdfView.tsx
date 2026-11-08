'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsOutLineHorizontal, MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import { Button } from '@/components/ui/button'
import { FORUM_COPY } from '@/shared/copy/forum'
import { PreviewMessage } from './parts'
import type { PreviewFile } from './preview'

// worker 由本站打包发出，不走外部 CDN
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const P = FORUM_COPY.preview
const A4 = 297 / 210

/** PDF：按需取字节（服务器支持分段读取），只渲染滚到附近的页。 */
export function PdfView({ file }: { file: PreviewFile }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [zoom, setZoom] = useState(1)
  const [pages, setPages] = useState(0)
  const [current, setCurrent] = useState(1)
  const [near, setNear] = useState<Set<number>>(() => new Set([1, 2]))
  const [failed, setFailed] = useState(false)
  const source = useMemo(() => ({ url: file.url }), [file.url])
  const options = useMemo(() => ({ disableAutoFetch: true, disableStream: false, isEvalSupported: false }), [])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.min(900, el.clientWidth - 32))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const root = box.current?.closest('.overflow-auto') as HTMLElement | null
    if (!root || !pages) return
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-pdf-page]')]
    const loader = new IntersectionObserver(entries => setNear(prev => {
      const next = new Set(prev)
      for (const e of entries) if (e.isIntersecting) next.add(Number((e.target as HTMLElement).dataset.pdfPage))
      return next.size === prev.size ? prev : next
    }), { root, rootMargin: '1200px 0px' })
    const reader = new IntersectionObserver(entries => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (top) setCurrent(Number((top.target as HTMLElement).dataset.pdfPage))
    }, { root, rootMargin: '-40% 0px -55% 0px' })
    nodes.forEach(n => { loader.observe(n); reader.observe(n) })
    return () => { loader.disconnect(); reader.disconnect() }
  }, [pages])

  if (failed) return <PreviewMessage text={P.broken} file={file} />
  const w = Math.round(width * zoom)
  return (
    <div ref={box} className="min-h-full">
      {pages > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-center gap-1 border-b bg-card/90 px-2 py-1 backdrop-blur">
          <span className="num mr-2 text-xs text-muted-foreground">{P.page(current, pages)}</span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={P.zoomOut} aria-label={P.zoomOut} onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}><MagnifyingGlassMinus size={16} /></Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={P.zoomIn} aria-label={P.zoomIn} onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}><MagnifyingGlassPlus size={16} /></Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={P.fitWidth} aria-label={P.fitWidth} onClick={() => setZoom(1)}><ArrowsOutLineHorizontal size={16} /></Button>
        </div>
      )}
      <Document file={source} options={options} onLoadSuccess={doc => setPages(doc.numPages)} onLoadError={() => setFailed(true)} onSourceError={() => setFailed(true)}
        loading={<PreviewMessage text={P.opening} />} error={<PreviewMessage text={P.broken} file={file} />} className="flex flex-col items-center gap-3 overflow-x-auto px-4 py-4">
        {Array.from({ length: pages }, (_, i) => i + 1).map(n => (
          <div key={n} data-pdf-page={n} className="shrink-0 bg-white shadow-md" style={{ width: w, minHeight: near.has(n) ? undefined : Math.round(w * A4) }}>
            {near.has(n) && <Page pageNumber={n} width={w} renderAnnotationLayer={false} loading={<div style={{ height: Math.round(w * A4) }} />} />}
          </div>
        ))}
      </Document>
    </div>
  )
}
