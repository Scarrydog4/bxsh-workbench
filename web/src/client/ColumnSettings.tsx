import { fuzzyMatch } from '@/shared/search'
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { ColumnOrderState, Table, VisibilityState } from '@tanstack/react-table'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Columns, DotsSixVertical, MagnifyingGlass, X } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useColumnDropFeedback } from './drag-feedback'
import feedbackStyles from './drag-feedback.module.css'

/** 订单、收入等表格共用的列显示与排序设置。 */
export function ColumnSettings<T>({ table, defaultOrder, defaultVisibility, children }: {
  table: Table<T>
  defaultOrder?: ColumnOrderState
  defaultVisibility?: VisibilityState
  children?: ReactNode
}) {
  const cols = table.getAllLeafColumns().filter(c => c.id !== 'select')
  const [query, setQuery] = useState('')
  const shown = cols.filter(c => fuzzyMatch(c.columnDef.header, query))
  const visibleCount = cols.filter(c => c.getIsVisible()).length
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const ids = table.getAllLeafColumns().map(c => c.id)
    const from = ids.indexOf(String(e.active.id))
    const to = ids.indexOf(String(e.over.id))
    if (from < 0 || to < 0) return
    table.setColumnOrder(arrayMove(ids, from, to))
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" aria-label="列设置">
          <Columns size={15} /> <span className="hidden sm:inline">列</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5" onOpenAutoFocus={event => {
        // 手机先看列选项，点搜索框时再唤起键盘；桌面保留默认键盘焦点。
        if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) event.preventDefault()
      }}>
        <div className="flex items-center justify-between px-2 py-1.5 text-xs"><span className="font-medium">显示的列</span><span className="num text-muted-foreground">{visibleCount} / {cols.length}</span></div>
        {cols.length > 12 && <label className="mx-1 mb-2 flex h-8 items-center gap-1.5 rounded-md border px-2 text-muted-foreground"><MagnifyingGlass size={14}/><input aria-label="搜索列" placeholder="找列名称" value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"/>{query && <button type="button" aria-label="清除列搜索" onClick={() => setQuery('')}><X size={13}/></button>}</label>}
        {children && <div className="flex flex-wrap gap-2 border-b p-2">{children}</div>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map(c => c.id)} strategy={verticalListSortingStrategy}>
            <div className="scroll-thin max-h-80 overflow-auto">
              {shown.map(c => (
                <SortableCol key={c.id} id={c.id} label={String(c.columnDef.header)} checked={c.getIsVisible()}
                  disabled={!c.getCanHide() || (c.getIsVisible() && visibleCount <= 1)} onToggle={() => c.toggleVisibility()} />
              ))}
              {!shown.length && <p className="px-2 py-5 text-center text-xs text-muted-foreground">没有匹配的列</p>}
            </div>
          </SortableContext>
        </DndContext>
        <button type="button"
          className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
          onClick={() => {
            setQuery('')
            table.setColumnOrder(defaultOrder ?? table.initialState.columnOrder ?? [])
            table.resetColumnSizing()
            table.setColumnVisibility(defaultVisibility ?? table.initialState.columnVisibility ?? {})
          }}
        >恢复默认</button>
      </PopoverContent>
    </Popover>
  )
}

function SortableCol({ id, label, checked, disabled, onToggle }: {
  id: string; label: string; checked: boolean; disabled: boolean; onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, activeIndex, index } = useSortable({ id, transition: { duration: 180, easing: 'ease-out' } })
  const settled = useColumnDropFeedback(id)
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition: isDragging ? 'none' : transition }
  return (
    <div ref={setNodeRef} style={style} className={cn('relative flex items-center gap-2 rounded px-1.5 py-1 text-sm', feedbackStyles.sortableOption, isDragging ? 'z-10 bg-accent shadow' : 'hover:bg-accent', isOver && !isDragging && (activeIndex < index ? feedbackStyles.dropBottom : feedbackStyles.dropTop))}>
      <span {...attributes} {...listeners} className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing" aria-label={`拖动 ${label}`}>
        <DotsSixVertical size={15} />
      </span>
      <label className={cn('flex flex-1 items-center gap-2', disabled ? 'cursor-default' : 'cursor-pointer')}>
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={onToggle} />
        {label}
      </label>
      <span aria-hidden="true" data-column-settled={settled || undefined} className={cn(feedbackStyles.settledMark, settled && feedbackStyles.settled)}/>
    </div>
  )
}
