'use client'

import { Megaphone } from '@phosphor-icons/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'
import { useNav } from '../nav'
import { setForumTarget, useLatestUnreadAnnouncement } from './live'

const K = FORUM_COPY.corner

/** 侧栏左下角：只在有未读公告时显示，点开查看最新一条。 */
export function SidebarCorner({ collapsed, onPick }: { collapsed?: boolean; onPick?: () => void }) {
  const { go } = useNav()
  const notice = useLatestUnreadAnnouncement()
  if (!notice) return null
  const open = () => {
    setForumTarget({ postId: notice.id, category: 'announcement' })
    go('forum'); onPick?.()
  }
  const label = `${K.announcement}：${notice.title}`
  const button = (
    <button type="button" onClick={open} aria-label={label}
      className={cn('group relative flex w-full items-center gap-2.5 rounded-lg text-left transition-colors',
        collapsed ? 'h-8 justify-center' : 'px-2 py-2',
        'bg-primary/[.07] text-foreground hover:bg-primary/10')}>
      <Megaphone size={17} weight="duotone" className="shrink-0 text-primary" />
      {collapsed && <span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
      {!collapsed && (
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[11.5px] font-medium text-primary">{K.announcement}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{notice.title}</span>
        </span>
      )}
    </button>
  )
  return collapsed ? <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip> : button
}
