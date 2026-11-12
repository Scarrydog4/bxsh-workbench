import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useVirtualRows } from './useVirtualRows'

/** Measured cards share the same scroll window as tables; every record remains in the row model. */
export function VirtualListBody<T extends { id: string }>({ rows, scrollRef, enabled, estimate = 180, className, style, itemClassName, children }: {
  rows: T[]; scrollRef: RefObject<HTMLDivElement | null>; enabled: boolean; estimate?: number
  className?: string; style?: CSSProperties; itemClassName?: string; children: (row: T, index: number) => ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const list = host.current, scroller = scrollRef.current
    if (!enabled || !list || !scroller) return
    const measure = () => setMargin(Math.max(0, list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list); observer.observe(scroller)
    return () => observer.disconnect()
  }, [enabled, scrollRef])
  const virtual = useVirtualRows(rows, scrollRef, estimate, enabled, { scrollMargin: margin, overscan: 6 })
  return <div ref={host} className={className} style={{ ...style, ...(enabled ? { display: 'block' } : {}) }}>
    {virtual.before > 0 && <div aria-hidden="true" style={{ height: virtual.before }} />}
    {virtual.rows.map((row, index) => enabled
      ? <div key={row.id} data-index={virtual.start + index} ref={virtual.measureElement} className={itemClassName}>{children(row, virtual.start + index)}</div>
      : <Fragment key={row.id}>{children(row, index)}</Fragment>)}
    {virtual.after > 0 && <div aria-hidden="true" style={{ height: virtual.after }} />}
  </div>
}
