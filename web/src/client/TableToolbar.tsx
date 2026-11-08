import { type ReactNode } from 'react'
import type { Table, VisibilityState } from '@tanstack/react-table'
import { ArrowsDownUp, ArrowDown, ArrowUp, MagnifyingGlass, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ColumnSettings } from './ColumnSettings'
import { TableFilterPopover } from './TableFilterPopover'
export { tableDatePreset } from './TableFilterPopover'
import { SelectField } from './SelectField'
import { tableFilterActive, tableFilterSummary, type TableFilter, type TableFilterField } from './table-filters'
import feedback from './filter-feedback.module.css'

const inputClass = 'h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring'
export function TableToolbar<T>({ table, fields, query, onQueryChange, filters, onFiltersChange, defaultVisibility, totalRows, countLabel, extras, searchable = true, sortable = false, embedded = false, preferredFilterFields, searchPlaceholder = '搜索表格' }: {
  table: Table<T>
  fields: TableFilterField<T>[]
  query: string
  onQueryChange: (value: string) => void
  filters: TableFilter[]
  onFiltersChange: (filters: TableFilter[]) => void
  defaultVisibility: VisibilityState
  totalRows: number
  countLabel?: (matching:number,total:number)=>string
  extras?: ReactNode
  searchable?: boolean
  sortable?: boolean
  embedded?: boolean
  /** 业务页可指定常用筛选，其余仍可在更多筛选和搜索里选择。 */
  preferredFilterFields?: string[]
  searchPlaceholder?: string
}) {
  const byId = new Map(fields.map(field => [field.id, field]))
  const selected = filters.flatMap((filter, index) => byId.has(filter.field) ? [{ filter, index, field: byId.get(filter.field)! }] : [])
  const active = selected.filter(({ filter }) => tableFilterActive(filter))
  const remove = (index: number) => onFiltersChange(filters.filter((_, at) => at !== index))
  const clear = () => { onFiltersChange([]); onQueryChange('') }
  const matching = table.getRowModel().rows.length
  return <div className={cn('flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2', embedded && 'px-2 py-1.5')}>
    {searchable && fields.length > 0 && <label className="flex h-8 w-full min-w-0 basis-full items-center gap-2 rounded-md border border-input bg-background px-2.5 sm:w-auto sm:min-w-[140px] sm:max-w-72 sm:flex-1 sm:basis-auto focus-within:ring-1 focus-within:ring-ring">
      <MagnifyingGlass size={15} className="shrink-0 text-muted-foreground" />
      <input aria-label="搜索表格" placeholder={searchPlaceholder} value={query} onChange={event => onQueryChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      {query && <button type="button" aria-label="清除搜索" onClick={() => onQueryChange('')} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>}
    </label>}
    <TableFilterPopover fields={fields} filters={filters} onFiltersChange={onFiltersChange} preferredFilterFields={preferredFilterFields} matching={matching} totalRows={totalRows} />
    {sortable && <TableSort table={table} />}
    {extras}
    <div className="ml-auto flex shrink-0 items-center gap-2"><span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" aria-live="polite">{countLabel ? countLabel(matching,totalRows) : matching === totalRows ? `${totalRows} 条` : `${matching} / ${totalRows} 条`}</span><ColumnSettings table={table} defaultVisibility={defaultVisibility} /></div>
    {(active.length > 0 || query) && <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 pt-0.5" aria-label="已选筛选条件">
      {query && <button type="button" aria-label="移除搜索条件" onClick={() => onQueryChange('')} className={cn('inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs', feedback.reveal)}><span className="break-words">搜索：{query}</span><X size={12} className="shrink-0"/></button>}
      {active.map(({ filter, index, field }) => {
        const label = tableFilterSummary(filter, field.label, field.optionLabel)
        return <button key={`${field.id}:${index}`} type="button" aria-label={`移除${field.label}筛选`} title={table.getColumn(field.id)?.getIsVisible() === false ? `${label}（列已隐藏）` : label} onClick={() => remove(index)} className={cn('inline-flex max-w-full items-center gap-1 rounded-md border border-primary/15 bg-primary/5 px-2 py-1 text-xs text-primary', feedback.reveal)}><span className="break-words">{label}</span><X size={12} className="shrink-0"/></button>
      })}
      <button type="button" aria-label="清除表格筛选" onClick={clear} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">清空表格条件</button>
    </div>}
  </div>
}

function TableSort<T>({ table }: { table: Table<T> }) {
  const columns = table.getAllLeafColumns().filter(column => column.getCanSort())
  const selected = table.getState().sorting[0]
  const label = columns.find(column => column.id === selected?.id)?.columnDef.header
  return <Popover>
    <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" aria-label="排序表格" title={selected ? `${String(label ?? '')} · ${selected.desc ? '降序' : '升序'}` : '默认顺序'} disabled={!columns.length}>
      <ArrowsDownUp size={15} /><span>排序</span>
    </Button></PopoverTrigger>
    <PopoverContent align="start" className="w-64 space-y-3 p-3">
      <label className="grid gap-1.5 text-xs text-muted-foreground">排序字段
        <SelectField aria-label="排序字段" value={selected?.id ?? ''} onChange={event => table.setSorting(event.target.value ? [{ id: event.target.value, desc: selected?.desc ?? true }] : [])} className={cn(inputClass, 'w-full text-foreground')}>
          <option value="">默认顺序</option>{columns.map(column => <option key={column.id} value={column.id}>{String(column.columnDef.header)}</option>)}
        </SelectField>
      </label>
      <div className="flex gap-2">{[false, true].map(desc => <Button key={String(desc)} type="button" size="sm" variant={selected && selected.desc === desc ? 'default' : 'outline'} className="h-8 flex-1 gap-1" disabled={!selected} aria-pressed={!!selected && selected.desc === desc} onClick={() => selected && table.setSorting([{ id: selected.id, desc }])}>{desc ? <ArrowDown size={14}/> : <ArrowUp size={14}/>} {desc ? '降序' : '升序'}</Button>)}</div>
    </PopoverContent>
  </Popover>
}
