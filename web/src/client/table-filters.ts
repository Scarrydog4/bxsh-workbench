import { compileSearch } from '@/shared/search'
import type { ReactNode } from 'react'

export type TableFilterValue = string | number | null | undefined
export type TableFilterOperator = 'contains' | 'equals' | 'one-of' | 'gte' | 'lte' | 'between' | 'after' | 'before' | 'date-between' | 'empty' | 'not-empty'
export interface TableFilter {
  field: string
  operator: TableFilterOperator
  value: string
  upper?: string
  values?: string[]
}
export interface TableFilterField<T> {
  id: string
  label: string
  numeric: boolean
  date: boolean
  options?: string[]
  multiple?: boolean
  optionLabel?: (value: string) => string
  renderOption?: (value: string) => ReactNode
  operators?: TableFilterOperator[]
  value: (row: T) => TableFilterValue
}
interface FilterableColumn<T> {
  id: string
  header: string
  sort?: (row: T) => string | number
  filterValue?: (row: T) => TableFilterValue
  filterType?: 'text' | 'number' | 'date'
  filterOptions?: 'all'
  filterOptionContent?: (value: string) => ReactNode
}

const text = (value: TableFilterValue) => String(value ?? '').trim().toLocaleLowerCase()
const empty = (value: TableFilterValue) => value == null || text(value) === '' || (typeof value === 'number' && !Number.isFinite(value))
const number = (value: string | undefined) => value?.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined
const date = (value: TableFilterValue) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined

/** 仅从调用页面允许展示的列取值，不读取原始记录中的其他属性。 */
export function tableFilterFields<T>(columns: FilterableColumn<T>[], rows: T[]): TableFilterField<T>[] {
  return columns.flatMap(column => {
    const value = column.filterValue ?? column.sort
    if (!value) return []
    let numeric = column.filterType === 'number'
    let isDate = column.filterType === 'date'
    for (const row of column.filterType ? [] : rows) {
      const candidate = value(row)
      if (empty(candidate)) continue
      numeric = typeof candidate === 'number'
      isDate = date(candidate) !== undefined
      break
    }
    let options: string[] | undefined
    if (!numeric && !isDate) {
      const unique = new Set<string>()
      for (const row of rows) {
        const candidate = value(row)
        if (!empty(candidate)) unique.add(String(candidate).trim())
        if (column.filterOptions !== 'all' && unique.size > 12) break
      }
      if (unique.size > 0 && (column.filterOptions === 'all' || unique.size <= 12)) options = [...unique].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    }
    return [{ id: column.id, label: column.header, numeric, date: isDate, options, value, renderOption: column.filterOptionContent }]
  })
}

export function tableFilterActive(filter: TableFilter) {
  if (filter.operator === 'one-of') return !!filter.values?.some(value => value.trim() !== '')
  if (filter.operator === 'empty' || filter.operator === 'not-empty') return true
  if (filter.operator === 'date-between') return date(filter.value) !== undefined || date(filter.upper) !== undefined
  if (filter.operator === 'after' || filter.operator === 'before') return date(filter.value) !== undefined
  if (filter.operator === 'between') return number(filter.value) !== undefined || number(filter.upper) !== undefined
  if (filter.operator === 'gte' || filter.operator === 'lte') return number(filter.value) !== undefined
  return filter.value.trim() !== ''
}

function matches(value: TableFilterValue, filter: TableFilter, numeric: boolean) {
  if (filter.operator === 'empty') return empty(value)
  if (filter.operator === 'not-empty') return !empty(value)
  if (empty(value)) return false
  if (filter.operator === 'after' || filter.operator === 'before' || filter.operator === 'date-between') {
    const current = date(value)
    if (!current) return false
    const lower = date(filter.value)
    const upper = date(filter.upper)
    if (filter.operator === 'after') return lower === undefined || current >= lower
    if (filter.operator === 'before') return lower === undefined || current <= lower
    return (lower === undefined || current >= lower) && (upper === undefined || current <= upper)
  }
  if (filter.operator === 'contains') return text(value).includes(text(filter.value))
  if (filter.operator === 'equals') return numeric ? Number(value) === Number(filter.value) : text(value) === text(filter.value)
  if (filter.operator === 'one-of') return !!filter.values?.some(option => option.trim() !== '' && (numeric ? Number(value) === Number(option) : text(value) === text(option)))
  const current = Number(value)
  if (!Number.isFinite(current)) return false
  const lower = number(filter.value)
  const upper = number(filter.upper)
  if (filter.operator === 'gte') return lower === undefined || current >= lower
  if (filter.operator === 'lte') return lower === undefined || current <= lower
  return (lower === undefined || current >= lower) && (upper === undefined || current <= upper)
}

export function filterTableRows<T>(rows: T[], fields: TableFilterField<T>[], query: string, filters: TableFilter[]) {
  const needle = text(query)
  const matchesQuery = compileSearch(query)
  const byId = new Map(fields.map(field => [field.id, field]))
  const active = filters.flatMap(filter => {
    const field = byId.get(filter.field)
    return field && tableFilterActive(filter) ? [{ filter, field }] : []
  })
  if (!needle && !active.length) return rows
  return rows.filter(row =>
    (!needle || matchesQuery(fields.map(field => text(field.value(row))))) &&
    active.every(({ filter, field }) => matches(field.value(row), filter, field.numeric)),
  )
}

export function tableFilterSummary(filter: TableFilter, label: string, optionLabel: (value: string) => string = value => value) {
  if (filter.operator === 'empty') return `${label}为空`
  if (filter.operator === 'not-empty') return `${label}不为空`
  if (filter.operator === 'between' || filter.operator === 'date-between') return `${label} ${filter.value.trim() || '不限'}–${filter.upper?.trim() || '不限'}`
  if (filter.operator === 'one-of') return `${label}：${filter.values?.map(optionLabel).join('、') ?? ''}`
  const sign = { contains: '包含', equals: '=', gte: '≥', lte: '≤', after: '不早于', before: '不晚于' }[filter.operator]
  return `${label} ${sign} ${filter.operator === 'equals' ? optionLabel(filter.value.trim()) : filter.value.trim()}`
}
