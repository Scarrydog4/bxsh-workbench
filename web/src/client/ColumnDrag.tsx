import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import { useColumnDropFeedback } from './drag-feedback'
import feedbackStyles from './drag-feedback.module.css'

export function ColumnDrag({ ids, visibleIds, onChange, children }: {
  ids: string[]
  visibleIds: string[]
  onChange: (ids: string[]) => void
  children: ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: 'auto', keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  )
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ screenReaderInstructions: { draggable: '按空格拿起这一列，左右方向键调整位置，空格放下，Escape 取消。' }, announcements: {
      onDragStart: () => '已拿起表格列。',
      onDragOver: ({ over }) => over ? '松开即可移动到此位置。' : undefined,
      onDragEnd: () => '列顺序已保存。',
      onDragCancel: () => '已取消移动。',
    } }}
    onDragEnd={({ active, over }) => {
      if (!over || active.id === over.id) return
      const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id))
      if (from >= 0 && to >= 0) onChange(arrayMove(ids, from, to))
    }}>
    <SortableContext items={visibleIds} strategy={horizontalListSortingStrategy}>{children}</SortableContext>
  </DndContext>
}

export function MovableHeader({ id, label, onSort, style, className, children, resize, menu, onContextMenu }: {
  id: string
  label: string
  onSort?: (event: unknown) => void
  style?: CSSProperties
  className?: string
  children: ReactNode
  resize?: ReactNode
  menu?: ReactNode
  onContextMenu?: (event: MouseEvent) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging, isOver, activeIndex, index } = useSortable({ id })
  const settled = useColumnDropFeedback(id)
  const dragged = useRef(false)
  if (isDragging) dragged.current = true
  return <th ref={setNodeRef} data-column-id={id} style={style} onContextMenu={onContextMenu}
    className={cn('relative', className, isDragging && 'opacity-50', isOver && !isDragging && (activeIndex < index ? feedbackStyles.dropRight : feedbackStyles.dropLeft))}>
    <button ref={setActivatorNodeRef} {...attributes} {...listeners}
      aria-roledescription="可移动的列" aria-label={label}
      title={`拖动调整列顺序${onSort ? '，点击排序' : ''}`}
      onPointerDown={event => { dragged.current = false; listeners?.onPointerDown?.(event) }}
      onKeyDown={event => { if (event.code === 'Space' && !isDragging) dragged.current = false; listeners?.onKeyDown?.(event) }}
      onClick={event => { if (dragged.current) { dragged.current = false; return } onSort?.(event) }}
      className="inline-flex h-full max-w-full cursor-grab touch-none select-none items-center gap-1.5 align-middle hover:text-foreground active:cursor-grabbing">
      {children}
    </button>
    {menu}
    {resize}
    <span aria-hidden="true" data-column-settled={settled || undefined} className={cn(feedbackStyles.settledMark, settled && feedbackStyles.settled)}/>
  </th>
}
