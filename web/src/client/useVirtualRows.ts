import { useVirtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'

/** 实测行高，滚动时同步补齐视口；分组日期和多写手行不再按固定高度推算。 */
export function useVirtualRows<T extends { id: string }>(rows: T[], ref: RefObject<HTMLDivElement | null>, height: number, enabled: boolean) {
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => ref.current,
    getItemKey: index => rows[index].id,
    estimateSize: () => height,
    overscan: 20,
    scrollMargin: 36,
    initialRect: { width: 0, height: 720 },
    enabled,
  })
  const items = virtual.getVirtualItems()
  const start = items[0]?.index ?? 0
  const end = (items.at(-1)?.index ?? -1) + 1
  return {
    rows: enabled ? rows.slice(start, end) : rows,
    start: enabled ? start : 0,
    before: enabled && items.length ? Math.max(0, items[0].start - 36) : 0,
    after: enabled && items.length ? Math.max(0, virtual.getTotalSize() - (items.at(-1)!.end - 36)) : 0,
    measureElement: enabled ? virtual.measureElement : undefined,
  }
}
