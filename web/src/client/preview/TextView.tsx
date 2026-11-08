'use client'

import { useEffect, useState } from 'react'
import { FORUM_COPY } from '@/shared/copy/forum'
import { Markdown } from '../forum/Markdown'
import { PreviewMessage } from './parts'
import type { PreviewFile } from './preview'

const P = FORUM_COPY.preview
const LIMIT = 2 * 1024 * 1024

/** Markdown 按排版显示，纯文本等宽显示；超过 2 MB 不预览。 */
export function TextView({ file, markdown }: { file: PreviewFile; markdown: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<'big' | 'broken' | null>((file.size ?? 0) > LIMIT ? 'big' : null)
  useEffect(() => {
    if ((file.size ?? 0) > LIMIT) return
    const ctrl = new AbortController()
    fetch(file.url, { signal: ctrl.signal, cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status))
        if (Number(r.headers.get('content-length')) > LIMIT) { setError('big'); ctrl.abort(); return }
        setText(await r.text())
      })
      .catch(() => { if (!ctrl.signal.aborted) setError('broken') })
    return () => ctrl.abort()
  }, [file.url, file.size])
  if (error === 'big') return <PreviewMessage text={P.textBig} file={file} />
  if (error === 'broken') return <PreviewMessage text={P.broken} file={file} />
  if (text === null) return <PreviewMessage text={P.opening} />
  return (
    <div className="mx-auto my-4 max-w-3xl rounded-xl border bg-card px-5 py-5 sm:px-8">
      {markdown ? <Markdown>{text}</Markdown> : <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">{text}</pre>}
    </div>
  )
}
