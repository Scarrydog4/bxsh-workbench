'use client'

import type { ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DotsSixVertical } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/** 拖动排序的竖排列表：按住左边的点拖，也能用键盘（空格拿起，↑↓ 移动，空格放下） */
export function SortableList<T>({ items, id, onReorder, render, className, disabled }: { items: T[]; id: (x: T) => string; onReorder: (next: T[]) => void; render: (x: T, handle: ReactNode) => ReactNode; className?: string; disabled?: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const ids = items.map(id)
  function end(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    onReorder(arrayMove(items, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <div className={className}>
          {items.map((x) => (
            <Row key={id(x)} id={id(x)} disabled={disabled}>
              {(handle) => render(x, handle)}
            </Row>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function Row({ id, children, disabled }: { id: string; children: (handle: ReactNode) => ReactNode; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const handle = disabled ? null : (
    <button type="button" aria-label="拖动排序" className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing" {...attributes} {...listeners}>
      <DotsSixVertical size={14} weight="bold" />
    </button>
  )
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('relative', isDragging && 'z-10 opacity-80 shadow-lg')}>
      {children(handle)}
    </div>
  )
}
