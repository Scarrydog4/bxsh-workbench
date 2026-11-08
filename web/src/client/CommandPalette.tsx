import { fuzzyMatch } from '@/shared/search'
import { useEffect, useState } from 'react'

import { Plus, FileText, Keyboard } from '@phosphor-icons/react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { useNav } from './nav'
import { useSession } from './store'
import { StatusPill, ChannelName } from './ui'
import { visiblePages } from './Shell'
import { goKeyFor } from './shortcuts'


export function CommandPalette({ open, onOpenChange, onHelp }: { open: boolean; onOpenChange: (v: boolean) => void; onHelp: () => void }) {
  const session = useSession()
  const { views, can, channel, s } = session
  const [search, setSearch] = useState('')
  useEffect(() => { if (open) setSearch('') }, [open])
  const orderText = (v: typeof views[number]) => `${v.no} ${v.title} ${channel(v.channelId)?.name ?? ''} ${v.channelNo ?? ''}`
  const matches = views.map(v => ({ v, score: fuzzyMatch(orderText(v), search) ? 1 : 0 }))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.v.no.localeCompare(a.v.no)).slice(0, 200).map(x => x.v)
  const { go, openOrder, newOrder, openChannel } = useNav()
  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput value={search} onValueChange={setSearch} placeholder="输入订单名称、渠道，或页面名…" />
      <CommandList className="scroll-thin max-h-[min(420px,60vh)] max-sm:max-h-none max-sm:flex-1">
        <CommandEmpty>没有找到匹配的内容</CommandEmpty>
        {can('order.create') && (
          <CommandGroup heading="操作">
            <CommandItem onSelect={() => run(newOrder)} className="gap-2">
              <Plus size={16} />
              录一单
              <CommandShortcut className="hidden sm:inline">N</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="跳转">
          {visiblePages(session).map((p) => (
            <CommandItem key={p.page} value={`page ${p.label}${p.page === 'forum' ? ' Forum Feedback 反馈 公告 问题 建议 Skill 文档' : ''}`} onSelect={() => run(() => go(p.page))} className="gap-2">
              <p.icon size={16} />
              {p.label}
              {goKeyFor(p.page) && <CommandShortcut className="hidden sm:inline">G {goKeyFor(p.page)!.toUpperCase()}</CommandShortcut>}
            </CommandItem>
          ))}
          <CommandItem value="快捷键 键盘 shortcut" onSelect={() => run(onHelp)} className="gap-2 max-sm:hidden">
            <Keyboard size={16} />
            键盘快捷键
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        {can('channel.view')&&<CommandGroup heading="渠道">{s.channels.filter(c=>fuzzyMatch(c.name, search)).slice(0,30).map(c=><CommandItem key={c.id} value={`渠道 ${c.name}`} onSelect={()=>run(()=>openChannel(c.id))}><ChannelName channel={c} size={20}/></CommandItem>)}</CommandGroup>}
        {views.length > 0 && (
          <CommandGroup heading="订单">
            {matches.map((v) => (
              <CommandItem
                key={v.id}
                value={orderText(v)}
                onSelect={() => run(() => openOrder(v.id))}
                className="gap-2"
              >
                <FileText size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{v.title}</span>
                <StatusPill status={v.status} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
