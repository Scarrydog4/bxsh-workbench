'use client'

import { useEffect, useRef, useState } from 'react'
import { renderWordDocument } from './render-word'
import { Button } from '@/components/ui/button'
import { FORUM_COPY } from '@/shared/copy/forum'
import { PreviewMessage } from './parts'
import type { PreviewFile } from './preview'

const P = FORUM_COPY.preview
const BIG = 20 * 1024 * 1024

/** Word（.docx）：浏览器里用 docx-preview 渲染，超过 20 MB 先问一声。 */
export function DocxView({ file }: { file: PreviewFile }) {
  const [forced, setForced] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const body = useRef<HTMLDivElement>(null)
  const style = useRef<HTMLDivElement>(null)
  const big = (file.size ?? 0) > BIG && !forced
  useEffect(() => {
    if (big || !body.current || !style.current) return
    const ctrl = new AbortController()
    setState('loading')
    fetch(file.url, { signal: ctrl.signal, cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob() })
      .then(blob => renderWordDocument(blob, body.current!, style.current!))
      .then(() => { if (!ctrl.signal.aborted) setState('ready') })
      .catch(() => { if (!ctrl.signal.aborted) setState('failed') })
    return () => ctrl.abort()
  }, [file.url, big])
  if (big) return <PreviewMessage text={P.wordBig} file={file}><Button size="sm" variant="outline" onClick={() => setForced(true)}>{P.anyway}</Button></PreviewMessage>
  if (state === 'failed') return <PreviewMessage text={P.broken} file={file} />
  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b bg-card/90 px-4 py-1.5 text-center text-xs text-muted-foreground backdrop-blur">{P.wordNote}</div>
      {state === 'loading' && <PreviewMessage text={P.opening} />}
      <div ref={style} />
      <div ref={body} className="docx-host overflow-x-auto" />
    </div>
  )
}
