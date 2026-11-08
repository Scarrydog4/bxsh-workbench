import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type CellContext,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type Header,
  type SortingState,
  type Table as TanStackTable,
  type VisibilityState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, CalendarBlank, Hash, UserCircle, Storefront, CheckCircle, TextAa, DotsThree, Tag, ClockCounterClockwise, ArrowsLeftRight, ShieldCheck, Percent, PenNib, Table } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { usePref } from './prefs'
import { ColumnDrag, MovableHeader } from './ColumnDrag'
import { TableToolbar } from './TableToolbar'
import { filterTableRows, tableFilterFields, type TableFilter, type TableFilterValue } from './table-filters'

/**
 * 所有表格共用的两根「轴」：
 * - 列宽轴：表头每列右边，拖动调宽，双击恢复。
 * - 冻结轴：冻结区右边那根粗线，拖到哪列，左边就冻结到哪列（像飞书）。
 * 每个人各自保存。
 */

export interface FreezeLayout {
  left: Record<string, number>
  lastId: string | null
  bounds: number[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function freezeLayout(cols: Column<any, unknown>[], count: number): FreezeLayout {
  const left: Record<string, number> = {}
  const bounds = [0]
  let x = 0
  cols.forEach((c, i) => {
    if (i < count) left[c.id] = x
    x += c.getSize()
    bounds.push(x)
  })
  return { left, lastId: count > 0 ? cols[Math.min(count, cols.length) - 1].id : null, bounds }
}

/** 冻结列的单元格：吸在左边，最后一列带一根分隔线。
 *  translateZ 让冻结格单独成层：Safari 滚动中插入新行时，不分层的吸附单元格偶尔不绘制，左半边变白。 */
export function frozenCell(id: string, f: FreezeLayout, header?: boolean): { style: CSSProperties; className: string } {
  if (!(id in f.left)) return { style: {}, className: '' }
  return {
    style: { position: 'sticky', left: f.left[id], transform: 'translateZ(0)' },
    className: cn(header ? 'z-30' : 'z-[5]', id === f.lastId && 'shadow-[inset_-2px_0_0_hsl(var(--border)),6px_0_8px_-6px_rgb(0_0_0/0.12)]'),
  }
}

export function ResizeHandle<T>({ header }: { header: Header<T, unknown> }) {
  if (!header.column.getCanResize()) return null
  const active = header.column.getIsResizing()
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`拖动调整「${String(header.column.columnDef.header)}」列宽，双击恢复`}
      title="拖动调整列宽，双击恢复"
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      onDoubleClick={() => header.column.resetSize()}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-0 z-20 flex h-full w-2 cursor-col-resize touch-none select-none justify-center"
    >
      <span className={cn('h-full w-px transition-colors', active ? 'w-0.5 bg-primary' : 'bg-transparent group-hover/th:bg-border hover:!bg-primary')} />
    </span>
  )
}

/** 像飞书：鼠标停在哪一行，冻结区边上就出现一根可拖的轴；没有冻结时出现在第一列左边。 */
export function FreezeHandle({
  layout,
  count,
  setCount,
  max,
  scrollRef,
}: {
  layout: FreezeLayout
  count: number
  setCount: (n: number) => void
  max: number
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <span
      role="separator"
      aria-label="拖动调整冻结列"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const el = scrollRef.current
        if (!el) return
        setDragging(true)
        const move = (ev: PointerEvent) => {
          const box = el.getBoundingClientRect()
          const rel = ev.clientX - box.left
          // 屏幕上每条列边界的位置：冻结区内不动，冻结区外要减去横向滚动
          const pos = (k: number) => (k <= count ? layout.bounds[k] : Math.max(layout.bounds[count], layout.bounds[k] - el.scrollLeft))
          let best = 0
          for (let k = 0; k <= max; k++) if (Math.abs(pos(k) - rel) < Math.abs(pos(best) - rel)) best = k
          if (best !== count) setCount(best)
        }
        const up = () => {
          setDragging(false)
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      title="拖动调整冻结列"
      className={cn(
        'absolute top-1/2 z-40 flex h-7 w-2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center transition-opacity',
        count > 0 ? 'right-0' : 'left-0',
        dragging ? 'opacity-100' : 'opacity-0 group-hover/tr:opacity-100',
      )}
    >
      <span className="h-full w-1.5 rounded-full bg-primary" />
    </span>
  )
}

/** 冻结轴挂在哪一列的表头上 */
export function freezeHost(layout: FreezeLayout, firstId: string) {
  return layout.lastId ?? firstId
}

export function useFreeze(key: string, fallback: number) {
  return usePref<number>(`freeze:${key}`, fallback)
}

// ---------- 通用表格 ----------

const fieldIcons: Record<string, typeof TextAa | null> = {
  渠道: Storefront, 归属销售: UserCircle, 操作人: UserCircle, 成员: UserCircle,
  单数: Hash, 订单号: Hash, 订单编号: Hash, 登录名: UserCircle,
  销售额: null, 应收: null, 已收: null, 未收: null, 金额: null,
  订单: TextAa, 订单名称: TextAa, 状态: CheckCircle, 下单: CalendarBlank, 发放: CalendarBlank,
  类别: Tag, 时间: ClockCounterClockwise, 删除时间: ClockCounterClockwise,
  动作: Tag, 对象: TextAa, 改动: ArrowsLeftRight, 操作: DotsThree,
  角色: ShieldCheck, 可当写手: PenNib, 提成比例: Percent,
}

export function TableFieldIcon({ label }: { label: string }) {
  if (fieldIcons[label] === null) return null
  const Icon = fieldIcons[label] ?? TextAa
  return <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
}

export function TablePageHeader({ title, lead, summary, children }: { title: string; lead?: ReactNode; summary?: ReactNode; children?: ReactNode }) {
  return <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2">
    <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
    {lead}
    {summary && <span className="text-sm tabular-nums text-muted-foreground">{summary}</span>}
    {children && <div className="ml-auto flex min-w-0 max-w-full items-center gap-2">{children}</div>}
  </div>
}

export function TableFooter({ children }: { children: ReactNode }) {
  return <div className="flex h-8 shrink-0 items-center border-t px-4 text-xs tabular-nums text-muted-foreground">{children}</div>
}

export interface Col<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** 排序用的值；不给就不能排序 */
  sort?: (row: T) => string | number
  /** 搜索和筛选的展示值；未设置时沿用排序值，不会读取其他记录字段。 */
  filterValue?: (row: T) => TableFilterValue
  /** 空表或历史值全空时，仍保留正确的日期/金额筛选控件。 */
  filterType?: 'text' | 'number' | 'date'
  /** 分类列始终提供当前授权行的完整选项；普通文本列仍避免列出全部文本。 */
  filterOptions?: 'all'
  filterOptionContent?: (value: string) => ReactNode
  size?: number
  minSize?: number
  align?: 'right'
  hideable?: boolean
}

// flexRender 把 cell 函数当组件。保持组件类型不变，倒计时/数据刷新才不会卸载交付表单。
function DataCell<T>({ column, row }: CellContext<T, unknown>) {
  const meta = column.columnDef.meta as { render: Col<T>['cell'] }
  return meta.render(row.original)
}

export function DataTable<T>({
  id,
  cols,
  rows,
  rowId,
  onRowClick,
  rowClassName,
  freeze = 1,
  maxHeight,
  empty,
  expandedRow,
  filteredEmpty,
  fill = false,
  embedded = false,
  groupBy,
  groupLabel,
  toolbar,
  toolbarExtras,
  countLabel,
  toolbarSearch = true,
  toolbarSort = false,
  preferredFilterFields,
  searchPlaceholder,
  defaultSorting = [],
  footer,
  defaultVisibility = {},
}: {
  id: string
  cols: Col<T>[]
  rows: T[]
  rowId: (r: T) => string
  onRowClick?: (r: T) => void
  rowClassName?: (r: T) => string | false | undefined
  freeze?: number
  maxHeight?: string
  expandedRow?: (r: T) => ReactNode
  filteredEmpty?: (clear:()=>void)=>ReactNode
  empty?: ReactNode
  /** 占满页面剩余高度，让原生滚动条一直留在工作区底部。 */
  fill?: boolean
  /** 渠道展开的子表沿用外层滚动区域。 */
  groupBy?: (r:T)=>string
  /** 分组标题行的内容；不给就显示分组名 */
  groupLabel?: (key: string) => ReactNode
  embedded?: boolean
  toolbar?: (table: TanStackTable<T>) => ReactNode
  toolbarExtras?: ReactNode | ((table: TanStackTable<T>) => ReactNode)
  countLabel?: (matching:number,total:number)=>string
  toolbarSearch?: boolean
  toolbarSort?: boolean
  preferredFilterFields?: string[]
  searchPlaceholder?: string
  defaultSorting?: SortingState
  footer?: (table: TanStackTable<T>) => ReactNode
  defaultVisibility?: VisibilityState
}) {
  const [sizing, setSizing] = usePref<ColumnSizingState>(`cols-size:${id}`, {})
  const [order, setOrder] = usePref<ColumnOrderState>(`cols-order:${id}`, [])
  const [visibility, setVisibility] = usePref<VisibilityState>(`cols-visible:${id}`, defaultVisibility)
  const columnVisibility = useMemo(() => {
    const value = { ...defaultVisibility, ...visibility }
    for (const col of cols) if (col.hideable === false) value[col.id] = true
    if (cols.length && !cols.some(col => value[col.id] !== false)) value[cols[0].id] = true
    return value
  }, [cols, defaultVisibility, visibility])
  const [count, setCount] = useFreeze(id, freeze)
  const [sorting, setSorting] = useState<SortingState>(defaultSorting)
  const [filterState, setFilterState] = useState<{ id: string; query: string; filters: TableFilter[] }>({ id, query: '', filters: [] })
  const query = filterState.id === id ? filterState.query : ''
  const filters = filterState.id === id ? filterState.filters : []
  const setQuery = (value: string) => setFilterState(previous => ({ id, query: value, filters: previous.id === id ? previous.filters : [] }))
  const setFilters = (value: TableFilter[]) => setFilterState(previous => ({ id, query: previous.id === id ? previous.query : '', filters: value }))
  const filterFields = useMemo(() => tableFilterFields(cols, rows), [cols, rows])
  const filteredRows = useMemo(() => toolbar ? rows : filterTableRows(rows, filterFields, toolbarSearch ? query : '', filters), [rows, filterFields, query, filters, toolbar, toolbarSearch])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    setWidth(el.clientWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const columns = useMemo<ColumnDef<T>[]>(
    () =>
      cols.map((c) => ({
        id: c.id,
        header: c.header,
        size: c.size ?? 140,
        minSize: c.minSize ?? 60,
        accessorFn: c.sort ?? (() => 0),
        enableSorting: !!c.sort,
        enableHiding: c.hideable !== false,
        meta: { align: c.align, render: c.cell },
        cell: DataCell<T>,
      })),
    [cols],
  )
  const table = useReactTable({
    data: filteredRows,
    columns,
    getRowId: rowId,
    state: { columnSizing: sizing, columnOrder: order, sorting, columnVisibility },
    onColumnVisibilityChange: setVisibility,
    onColumnOrderChange: setOrder,
    onColumnSizingChange: setSizing,
    onSortingChange: setSorting,
    columnResizeMode: 'onChange',
    // 本表不分页。嵌套子表的数据引用更新时，自动重置会形成微任务渲染循环。
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const sortedRows=table.getRowModel().rows
  const tableRows=useMemo(()=>{if(!groupBy)return sortedRows;const groups=new Map<string,typeof sortedRows>();for(const row of sortedRows){const key=groupBy(row.original);groups.set(key,[...(groups.get(key)??[]),row])}return [...groups.values()].flat()},[sortedRows,groupBy])
  const leafs = table.getVisibleLeafColumns()
  let pinnedWidth = 0
  let fittingPins = 0
  for (const col of leafs) {
    if (pinnedWidth + col.getSize() > width * .5) break
    pinnedWidth += col.getSize()
    fittingPins++
  }
  const n = embedded ? 0 : Math.max(0, Math.min(count, leafs.length - 1, fittingPins))
  const layout = freezeLayout(leafs, n)

  return (
    <>
    {toolbar ? toolbar(table) : <TableToolbar table={table} fields={filterFields} query={query} onQueryChange={setQuery} filters={filters} onFiltersChange={setFilters} defaultVisibility={defaultVisibility} totalRows={rows.length} countLabel={countLabel} extras={typeof toolbarExtras === 'function' ? toolbarExtras(table) : toolbarExtras} searchable={toolbarSearch} sortable={toolbarSort} embedded={embedded} preferredFilterFields={preferredFilterFields} searchPlaceholder={searchPlaceholder} />}
    <ColumnDrag ids={table.getAllLeafColumns().map(c => c.id)} visibleIds={leafs.map(c => c.id)} onChange={setOrder}>
    <div ref={scrollRef} tabIndex={embedded ? undefined : 0} aria-label={embedded ? undefined : '数据表格，可横向滚动'} className={cn('relative min-h-0 bg-card outline-none', embedded ? 'overflow-visible' : 'order-grid-scroll overflow-auto', fill ? 'flex-1' : 'border')} style={{ maxHeight }}>
      <table className="workbench-grid hidden table-fixed border-separate border-spacing-0 sm:table" style={{ width: Math.max(table.getTotalSize(), 0), minWidth: '100%' }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const right = (h.column.columnDef.meta as { align?: string } | undefined)?.align === 'right'
                const fz = frozenCell(h.id, layout, true)
                const sorted = h.column.getIsSorted()
                return (
                  <MovableHeader
                    key={h.id}
                    id={h.id}
                    label={String(h.column.columnDef.header)}
                    onSort={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                    style={{ width: h.getSize(), ...fz.style }}
                    className={cn('group/th top-0 z-10 h-9 border-b bg-card px-3 text-left text-[13px] font-normal text-muted-foreground', embedded ? 'relative' : 'sticky', right && 'text-right', fz.className)}
                    resize={<ResizeHandle header={h} />}
                  >
                        <span className="truncate">{String(h.column.columnDef.header)}</span>
                        {sorted === 'asc' && <ArrowUp size={11} />}
                        {sorted === 'desc' && <ArrowDown size={11} />}
                  </MovableHeader>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {tableRows.map((r,index) => {
            const detail = expandedRow?.(r.original)
            return (
            <Fragment key={r.id}>{groupBy&&(index===0||groupBy(tableRows[index-1].original)!==groupBy(r.original))&&<tr><td colSpan={leafs.length} className="sticky top-9 z-10 border-b bg-muted px-3 py-2 text-sm font-medium">{groupLabel ? groupLabel(groupBy(r.original)) : groupBy(r.original)}</td></tr>}<tr onClick={onRowClick ? () => onRowClick(r.original) : undefined} className={cn('group/tr', onRowClick && 'cursor-pointer', rowClassName?.(r.original))}>
              {r.getVisibleCells().map((c) => {
                const right = (c.column.columnDef.meta as { align?: string } | undefined)?.align === 'right'
                const fz = frozenCell(c.column.id, layout)
                return (
                  <td
                    key={c.id}
                    style={{ width: c.column.getSize(), maxWidth: c.column.getSize(), ...fz.style }}
                    className={cn('relative h-10 overflow-hidden border-b border-border/60 bg-card px-3 align-middle', onRowClick && 'group-hover/tr:bg-accent', right && 'text-right', fz.className)}
                  >
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                    {!embedded && c.column.id === freezeHost(layout, leafs[0].id) && <FreezeHandle layout={layout} count={n} setCount={setCount} max={leafs.length - 1} scrollRef={scrollRef} />}
                  </td>
                )
              })}
            </tr>
            {<AnimatePresence initial={false}>{detail && <motion.tr key="detail"><td colSpan={leafs.length} className="bg-muted/20 p-0"><ExpandedContent><div className="border-b p-2">{detail}</div></ExpandedContent></td></motion.tr>}</AnimatePresence>}
            </Fragment>
          )})}
        </tbody>
      </table>
      <div className={cn('divide-y sm:hidden', !embedded && 'pb-20')}>{tableRows.map((r, index) => {
        const detail = expandedRow?.(r.original)
        return <Fragment key={r.id}>
          {groupBy && (index === 0 || groupBy(tableRows[index - 1].original) !== groupBy(r.original)) && <h3 className="bg-muted px-3 py-2 text-sm font-medium">{groupLabel ? groupLabel(groupBy(r.original)) : groupBy(r.original)}</h3>}
          <article className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3" onClick={() => onRowClick?.(r.original)}>
            {r.getVisibleCells().map((c, i) => <div key={c.id} className={cn('flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm', i === 0 && 'col-span-2 mb-1 font-medium', c.column.id === 'actions' && 'col-span-2 border-t pt-2')}>
              <span className={cn('shrink-0 text-xs font-normal text-muted-foreground', i === 0 && 'sr-only')}>{String(c.column.columnDef.header)}</span>
              <span className={cn('min-w-0 truncate', i === 0 && 'w-full whitespace-normal [&_.truncate]:whitespace-normal [&_.truncate]:text-clip', c.column.id === 'actions' && 'ml-auto')}>{flexRender(c.column.columnDef.cell, c.getContext())}</span>
            </div>)}
            <div className="col-span-2 empty:hidden"><AnimatePresence initial={false}>{detail && <ExpandedContent key="detail"><div onClick={e => e.stopPropagation()} className="rounded-lg bg-muted/30 p-2">{detail}</div></ExpandedContent>}</AnimatePresence></div>
          </article>
        </Fragment>
      })}</div>
      {filteredRows.length === 0 && (filteredEmpty && (query || filters.length) ? filteredEmpty(() => query ? setQuery('') : setFilters([])) : rows.length > 0 ? <div className="px-4 py-12 text-center text-sm text-muted-foreground">没有符合条件的记录</div> : empty)}
    </div>
    </ColumnDrag>
    {footer?.(table)}
    </>
  )
}

function ExpandedContent({children}:{children:ReactNode}) {const reduce=useReducedMotion();return <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:reduce?0:.18,ease:'easeOut'}} className="overflow-hidden">{children}</motion.div>}
