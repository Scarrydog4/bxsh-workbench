'use client'

import { useEffect, useState } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/** 普通浏览器仍使用下载链接；只有支持更新的客户端显示原生入口。 */
export function AndroidUpdateButton({ className }: { className?: string }) {
  const [installed, setInstalled] = useState('')
  useEffect(() => { setInstalled(/BxshAndroid\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '') }, [])
  if (!installed) return null
  return <a href="bxsh://check-update" title={`当前安装 v${installed}`} className={cn('inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}><ArrowClockwise size={15}/>检查更新</a>
}
