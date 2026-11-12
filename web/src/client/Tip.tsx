import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** 图标代替文字：鼠标放上去或键盘聚焦时显示说明 */
export function Tip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="max-w-72 whitespace-pre-wrap break-words">{label}</TooltipContent>
  </Tooltip>
}
