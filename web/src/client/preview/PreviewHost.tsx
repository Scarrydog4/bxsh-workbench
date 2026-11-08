'use client'

import dynamic from 'next/dynamic'
import * as D from '@radix-ui/react-dialog'
import { X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { FORUM_COPY } from '@/shared/copy/forum'
import { extOf, fileSize } from '../forum/format'
import { ImageViewer } from '../ImageViewer'
import { closePreview, previewKind, usePreviewFile } from './preview'
import { DownloadButton, PreviewMessage } from './parts'

const P = FORUM_COPY.preview, C = FORUM_COPY.common
const loading = () => <PreviewMessage text={P.opening} />
const PdfView = dynamic(() => import('./PdfView').then(m => m.PdfView), { ssr: false, loading })
const DocxView = dynamic(() => import('./DocxView').then(m => m.DocxView), { ssr: false, loading })
const TextView = dynamic(() => import('./TextView').then(m => m.TextView), { ssr: false, loading })
const VideoView = dynamic(() => import('./VideoView').then(m => m.VideoView), { ssr: false, loading })

/** 全站唯一的预览弹窗：论坛、私信、订单附件都调用 openPreview()。 */
export function PreviewHost() {
  const file = usePreviewFile()
  const kind = file ? previewKind(file.name, file.mime) : 'none'
  if (file && kind === 'image') return <ImageViewer pics={[{ src: file.url, download: file.downloadUrl, name: file.name }]} index={0} onIndex={i => i === null && closePreview()} />
  return (
    <D.Root open={!!file} onOpenChange={o => !o && closePreview()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[60] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content aria-describedby={undefined} className="fixed inset-2 z-[61] mx-auto flex max-w-5xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl outline-none sm:inset-4">
          {file && <>
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
              <span className="num shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] uppercase text-muted-foreground">{extOf(file.name) || '?'}</span>
              <D.Title className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>{file.name}</D.Title>
              {file.size != null && <span className="num hidden shrink-0 text-xs text-muted-foreground sm:inline">{fileSize(file.size)}</span>}
              <DownloadButton file={file} />
              <D.Close asChild><Button size="sm" variant="ghost" className="gap-1.5"><X size={15} /><span className="hidden sm:inline">{C.close}</span></Button></D.Close>
            </div>
            <div className="relative min-h-0 flex-1 overflow-auto bg-muted/60">
              {kind === 'pdf' && <PdfView file={file} />}
              {kind === 'docx' && <DocxView file={file} />}
              {(kind === 'markdown' || kind === 'text') && <TextView file={file} markdown={kind === 'markdown'} />}
              {kind === 'video' && <VideoView file={file} />}
              {kind === 'doc' && <PreviewMessage text={P.oldWord} file={file} />}
              {kind === 'video-unsupported' && <PreviewMessage text={P.videoUnsupported} file={file} />}
              {kind === 'none' && <PreviewMessage text={P.unsupported} file={file} />}
            </div>
          </>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
