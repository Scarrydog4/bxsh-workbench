'use client'

import { DownloadSimple, FileText } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { FORUM_COPY } from '@/shared/copy/forum'
import type { PreviewFile } from './preview'

const C = FORUM_COPY.common

export function DownloadButton({ file, primary }: { file: Pick<PreviewFile, 'name' | 'downloadUrl'>; primary?: boolean }) {
  return <Button asChild size="sm" variant={primary ? 'default' : 'outline'} className="gap-1.5"><a href={file.downloadUrl} download={file.name}><DownloadSimple size={15} />{C.download}</a></Button>
}

export function PreviewMessage({ text, file, children }: { text: string; file?: PreviewFile; children?: React.ReactNode }) {
  return <div className="grid h-full min-h-[240px] place-items-center p-6 text-center">
    <div className="flex max-w-sm flex-col items-center gap-3 text-sm text-muted-foreground">
      <FileText size={30} />
      <span>{text}</span>
      {(file || children) && <div className="flex flex-wrap justify-center gap-2">{file && <DownloadButton file={file} primary />}{children}</div>}
    </div>
  </div>
}
