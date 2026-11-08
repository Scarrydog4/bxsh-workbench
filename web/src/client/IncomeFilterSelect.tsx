import { useRef, useState } from 'react'
import { CaretDown, Check, Storefront, Users } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { Avatar, ChannelAvatar } from './ui'
import feedback from './filter-feedback.module.css'

type FilterOption = { id: string; name: string; avatar?: string; hue?: number }

/** 收入各端共用；选项只接收报表接口已授权的数据。 */
export function IncomeFilterSelect({ value, onChange, options, kind = 'channel', 'aria-label': label }: {
  value: string
  onChange: (id: string) => void
  options?: FilterOption[]
  kind?: 'channel' | 'sales' | 'writer'
  'aria-label': string
}) {
  const [open, setOpen] = useState(false)
  // 报表重查时暂时没有 options，保留名称、头像和列表，避免按钮闪成空白。
  const lastOptions = useRef<FilterOption[]>([])
  if (options) lastOptions.current = options
  const available = options ?? lastOptions.current
  const selected = available.find(option => option.id === value)
  const noun = kind === 'channel' ? '渠道' : kind === 'writer' ? '写手' : '销售', AllIcon = kind === 'channel' ? Storefront : Users
  const name = value ? selected?.name ?? (value === '__none__' ? '未填渠道' : `当前${noun}`) : `全部${noun}`
  function icon(option?: FilterOption) {
    return option ? kind === 'channel' ? <ChannelAvatar channel={option} size={22}/> : <Avatar user={{ ...option, hue: option.hue ?? 155 }} size={22}/>
      : <AllIcon size={18} className="text-muted-foreground"/>
  }
  function choose(id: string) { onChange(id); setOpen(false) }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" aria-label={label} title={name}
      className={cn('inline-flex min-h-8 w-44 min-w-0 max-w-full items-center gap-2 rounded-md border bg-card px-2.5 py-1 text-sm shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/10 max-sm:min-h-10 max-sm:flex-1', value && 'border-primary/30 bg-primary/5')}>
      <span className="flex size-[22px] shrink-0 items-center justify-center">{icon(selected)}</span>
      <span key={value} className={cn('min-w-0 flex-1 break-words text-left leading-5', feedback.reveal)}>{name}</span><CaretDown size={14} className={cn('shrink-0 text-muted-foreground', feedback.turn, open && 'rotate-180')}/>
    </button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={6} collisionPadding={12} className="w-80 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg p-0 shadow-lg">
      <Command defaultValue={value || `全部${noun}`}>
        <CommandInput aria-label={`搜索${noun}`} placeholder={`搜索${noun}…`}/>
        <CommandList className="scroll-thin max-h-[min(280px,calc(var(--radix-popover-content-available-height)-56px))] overscroll-contain p-1">
          <CommandEmpty>没有找到{noun}</CommandEmpty>
          <CommandItem value={`全部${noun}`} onSelect={() => choose('')} className="min-h-10 cursor-pointer rounded-md px-2.5 max-sm:min-h-11">
            <span className="flex size-[22px] shrink-0 items-center justify-center">{icon()}</span><span className="flex-1">全部{noun}</span>{!value && <Check size={16} aria-hidden className={cn('text-primary', feedback.reveal)}/>}
          </CommandItem>
          {available.map(option => <CommandItem key={option.id} value={option.id} keywords={[option.name]} onSelect={() => choose(option.id)}
            className={cn('min-h-10 cursor-pointer rounded-md px-2.5 max-sm:min-h-11', value === option.id && 'bg-primary/10 text-primary')}>
            {icon(option)}<span className="min-w-0 flex-1 break-words leading-5">{option.name}</span>{value === option.id && <Check size={16} aria-hidden className={cn('text-primary', feedback.reveal)}/>}
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}
