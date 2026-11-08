'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import type { OrderView } from '@/shared/types'
import { AvatarStack, ChannelAvatar, Money, StatusPill, STATUS_TONE } from './ui'
import { updateOrder, useSession } from './store'
import { usePref } from './prefs'
import { useNav } from './nav'
import { AfterSaleChip, openAfterSale } from './AfterSale'
import { Due } from './Due'
import { SortableList } from './sortable'

/** 看板：按订单状态分列，把卡片拖到另一列就改状态（要有改状态的权限） */
export function KanbanBoard({ rows }: { rows: OrderView[] }) {
  const { s, can } = useSession()
  const { openOrder } = useNav()
  const [dragging, setDragging] = useState<OrderView | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const movable = can('order.status')
  const ids = rows.map((r) => r.id)

  async function end(e: DragEndEvent) {
    setDragging(null)
    const v = rows.find((r) => r.id === e.active.id)
    const to = e.over?.id as string | undefined
    if (!v || !to || to === v.status) return
    if (await updateOrder(v.id, { status: to })) toast.success(`「${v.title}」改为「${to}」`)
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(rows.find((r) => r.id === e.active.id) ?? null)} onDragEnd={end} onDragCancel={() => setDragging(null)}>
      <div className="scroll-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
        {s.statuses.map((st) => (
          <Column key={st} status={st} rows={rows.filter((r) => r.status === st)} onOpen={(id) => openOrder(id, ids)} movable={movable} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{dragging && <Card v={dragging} overlay />}</DragOverlay>
    </DndContext>
  )
}

function Column({ status, rows, onOpen, movable }: { status: string; rows: OrderView[]; onOpen: (id: string) => void; movable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !movable })
  const total = rows.reduce((a, r) => a + (r.sales ?? 0), 0)
  return (
    <div ref={setNodeRef} className={cn('flex w-[272px] shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors', isOver && 'border-primary bg-primary/[0.06]')}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <StatusPill status={status} />
        <span className="num text-xs text-muted-foreground">{rows.length}</span>
        {rows.some((r) => r.sales !== undefined) && <Money value={total} plain className="ml-auto text-xs text-gold" />}
      </div>
      <div className="scroll-thin grid max-h-[calc(100dvh-300px)] min-h-24 content-start gap-2 overflow-y-auto px-2 pb-2">
        {rows.map((v) => (
          <Draggable key={v.id} v={v} onOpen={() => onOpen(v.id)} movable={movable} />
        ))}
        {rows.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">{movable ? '拖到这里' : '没有'}</div>}
      </div>
    </div>
  )
}

function Draggable({ v, onOpen, movable }: { v: OrderView; onOpen: () => void; movable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: v.id, disabled: !movable })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn('touch-none', isDragging && 'opacity-30')}>
      <Card v={v} onOpen={onOpen} />
    </div>
  )
}

function Card({ v, onOpen, overlay }: { v: OrderView; onOpen?: () => void; overlay?: boolean }) {
  const { user, channel } = useSession()
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('grid w-full gap-2 rounded-lg border bg-card p-2.5 text-left text-sm shadow-sm hover:border-primary/50', overlay && 'rotate-2 shadow-xl')}
      style={{ borderLeft: `3px solid ${STATUS_TONE[v.status] ?? 'var(--border)'}` }}
    >
      <div className="line-clamp-2 font-medium leading-snug">{v.title}</div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ChannelAvatar channel={channel(v.channelId)} size={14} />
        <span className="truncate">{channel(v.channelId)?.name}</span>
        <span className="num ml-auto shrink-0">{v.no.slice(-4)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <AvatarStack users={v.assignees.map((a) => user(a.userId))} />
        <Due date={v.dueDate} status={v.status} />
      </div>
      {openAfterSale(v) && <AfterSaleChip v={v} />}
    </button>
  )
}

/** 手动排序：行可以拖动，顺序每个人自己保存；新单排在最上面 */
export function ManualList({ rows }: { rows: OrderView[] }) {
  const { me, channel } = useSession()
  const { openOrder } = useNav()
  const [saved, setSaved] = usePref<string[]>(`manual-order:${me.id}`, [])
  const ordered = useMemo(() => {
    const rank = new Map(saved.map((id, i) => [id, i]))
    const fresh = rows.filter((r) => !rank.has(r.id))
    const known = rows.filter((r) => rank.has(r.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    return [...fresh, ...known]
  }, [rows, saved])
  const ids = ordered.map((r) => r.id)
  return (
    <SortableList
      className="grid gap-1 rounded-xl border bg-card p-1.5"
      items={ordered}
      id={(v) => v.id}
      onReorder={(next) => {
        const shown = new Set(next.map((v) => v.id))
        setSaved([...next.map((v) => v.id), ...saved.filter((id) => !shown.has(id))])
      }}
      render={(v, handle) => (
        <div className="flex items-center gap-2 rounded-md bg-card px-1 py-1.5 hover:bg-accent">
          {handle}
          <button type="button" onClick={() => openOrder(v.id, ids)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm">
            <span className="min-w-0 flex-1 truncate">{v.title}</span>
            <span className="hidden max-w-28 truncate text-xs text-muted-foreground md:block">{channel(v.channelId)?.name}</span>
            <StatusPill status={v.status} />
            <span className="hidden w-20 shrink-0 text-right sm:block">
              <Due date={v.dueDate} status={v.status} />
            </span>
          </button>
        </div>
      )}
    />
  )
}
