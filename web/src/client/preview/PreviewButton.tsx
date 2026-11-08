'use client'

import { Eye } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'
import { canPreview, openPreview } from './preview'

/** 订单、跟进附件的「预览」小按钮：能预览的类型才显示，打开全站统一的预览弹窗。 */
export function PreviewButton({ id, name, size, mime, className }: { id: string; name: string; size?: number; mime?: string; className?: string }) {
  if (!canPreview(name, mime)) return null
  const label = `${FORUM_COPY.common.preview} ${name}`
  return (
    <button type="button" aria-label={label} title={FORUM_COPY.common.preview}
      onClick={e => { e.preventDefault(); e.stopPropagation(); openPreview({ name, size, mime, url: `/api/files/${id}?inline=1`, downloadUrl: `/api/files/${id}` }) }}
      className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary', className)}>
      <Eye size={16} />
    </button>
  )
}
