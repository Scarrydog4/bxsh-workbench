import { memo, type ReactNode } from 'react'
import { useVirtualRows } from './useVirtualRows'

type Measure = ReturnType<typeof useVirtualRows>['measureElement']
type RowProps<T> = { row: T; index: number; measure: Measure; render: (row: T, index: number, measure: Measure) => ReactNode }
const CachedRow = memo(function RenderRow<T>({ row, index, measure, render }: RowProps<T>) {
  return render(row, index, measure)
}) as <T>(props: RowProps<T>) => ReactNode

/** 把滚动更新限制在表体，避免每滚一行重画筛选栏、表头和整页统计。 */
export function VirtualTableBody<T extends { id: string }>({ rows, scrollRef, rowHeight, enabled, colSpan, children }: {
  rows: T[]
  scrollRef: Parameters<typeof useVirtualRows>[1]
  rowHeight: number
  enabled: boolean
  colSpan: number
  children: RowProps<T>['render']
}) {
  const virtual = useVirtualRows(rows, scrollRef, rowHeight, enabled)
  return <tbody>
    {virtual.before > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: virtual.before, padding: 0, border: 0 }}/></tr>}
    {virtual.rows.map((row, index) => <CachedRow key={row.id} row={row} index={virtual.start + index} measure={virtual.measureElement} render={children}/>)}
    {virtual.after > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: virtual.after, padding: 0, border: 0 }}/></tr>}
  </tbody>
}
