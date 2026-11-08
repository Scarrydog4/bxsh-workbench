import { fuzzyMatch } from '@/shared/search'
import { useState, type ReactNode } from 'react'
import { FunnelSimple, MagnifyingGlass, Plus, CaretDown, X, Check } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { businessDate } from '@/shared/format'
import feedback from './filter-feedback.module.css'
import { SelectField } from './SelectField'
import { tableFilterActive, tableFilterSummary, type TableFilter, type TableFilterField, type TableFilterOperator } from './table-filters'

const inputClass = 'h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring'
const operators: [TableFilterOperator, string][] = [['contains', '包含'], ['equals', '等于'], ['one-of', '任一选中项'], ['gte', '大于等于'], ['lte', '小于等于'], ['between', '范围'], ['empty', '为空'], ['not-empty', '不为空']]
const dateOperators: [TableFilterOperator, string][] = [['equals', '等于'], ['after', '不早于'], ['before', '不晚于'], ['date-between', '日期范围'], ['empty', '为空'], ['not-empty', '不为空']]
const defaultOperator = <T,>(field: TableFilterField<T> | undefined): TableFilterOperator => field?.operators?.[0] ?? (field?.date ? 'date-between' : field?.numeric ? 'between' : field?.multiple ? 'one-of' : field?.options?.length ? 'equals' : 'contains')
const selectedValues = (filter: TableFilter) => filter.operator === 'one-of' ? filter.values ?? [] : filter.operator === 'equals' && filter.value.trim() ? [filter.value] : []

/** 以北京时间确定今天；通用表格的本周、本月覆盖完整自然周期，截止日期也能查未来几天。 */
export function tableDatePreset(mode: 'today' | 'week' | 'month', today = businessDate(new Date())) {
  const from = new Date(`${today}T00:00:00Z`), to = new Date(from)
  if (mode === 'week') {
    from.setUTCDate(from.getUTCDate() - (from.getUTCDay() + 6) % 7)
    to.setTime(from.getTime()); to.setUTCDate(to.getUTCDate() + 6)
  } else if (mode === 'month') {
    from.setUTCDate(1); to.setUTCMonth(to.getUTCMonth() + 1, 0)
  }
  return { value: from.toISOString().slice(0, 10), upper: to.toISOString().slice(0, 10) }
}

export function TableFilterPopover<T>({ fields, filters, onFiltersChange, preferredFilterFields, matching, totalRows, footer, ariaLabel = '筛选表格', renderOption, onClear }: {
  fields: TableFilterField<T>[]
  filters: TableFilter[]
  onFiltersChange: (filters: TableFilter[]) => void
  preferredFilterFields?: string[]
  matching: number
  totalRows: number
  footer?: ReactNode
  ariaLabel?: string
  renderOption?: (fieldId: string, value: string) => ReactNode
  onClear?: () => void
}) {
  const [fieldSearch, setFieldSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [optionSearch, setOptionSearch] = useState<Record<string, string>>({})
  const [expandedOptions, setExpandedOptions] = useState<Record<string, boolean>>({})
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>({})
  const [advancedFields, setAdvancedFields] = useState<Record<string, boolean>>({})
  const byId = new Map(fields.map(field => [field.id, field]))
  const selected = filters.flatMap((filter, index) => byId.has(filter.field) ? [{ filter, index, field: byId.get(filter.field)! }] : [])
  const active = selected.filter(({ filter }) => tableFilterActive(filter))
  const update = (index: number, patch: Partial<TableFilter>) => onFiltersChange(filters.map((filter, at) => at === index ? { ...filter, ...patch } : filter))
  const remove = (index: number) => onFiltersChange(filters.filter((_, at) => at !== index))
  const fieldFilter = (field: TableFilterField<T>) => filters.find(filter => filter.field === field.id)
  const blankFilter = (field: TableFilterField<T>): TableFilter => ({ field: field.id, operator: defaultOperator(field), value: '' })
  const updateField = (field: TableFilterField<T>, patch: Partial<TableFilter>) => {
    const index = filters.findIndex(filter => filter.field === field.id)
    if (index < 0) onFiltersChange([...filters, { ...blankFilter(field), ...patch }])
    else update(index, patch)
  }
  const clearField = (field: TableFilterField<T>) => onFiltersChange(filters.filter(filter => filter.field !== field.id))
  const pickField = (field: TableFilterField<T>) => {
    if (!fieldFilter(field)) onFiltersChange([...filters, blankFilter(field)])
    setAdvancedFields(current => ({ ...current, [field.id]: true }))
    setAdding(false); setFieldSearch('')
  }
  const preferred = preferredFilterFields?.flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
  const simpleFilter = (field: TableFilterField<T>, filter: TableFilter) => filter.operator === defaultOperator(field)
  const common = preferred?.filter(field => {
    const existing = fieldFilter(field)
    if (advancedFields[field.id] || existing && tableFilterActive(existing) && !simpleFilter(field, existing)) return false
    // 只有一个选项时不占首屏；已选条件仍展示，避免留下看不到的条件。
    return !(field.options?.length === 1 && !existing?.value && !existing?.values?.length)
  }) ?? []
  const commonIds = new Set(common.map(field => field.id))
  const advanced = selected.filter(({ field }) => !commonIds.has(field.id))
  const choices = fields.filter(field => (!preferred && filters.some(filter => filter.field === field.id) ? false : true) && fuzzyMatch(field.label, fieldSearch))
  const toggleQuick = (field: TableFilterField<T>, value: string) => {
    const index = filters.findIndex(filter => filter.field === field.id)
    if (field.multiple) {
      const current = index < 0 ? [] : selectedValues(filters[index])
      const values = current.includes(value) ? current.filter(item => item !== value) : [...current, value]
      if (!values.length && index >= 0) remove(index)
      else updateField(field, { operator: 'one-of', value: '', values, upper: undefined })
    } else if (index >= 0 && filters[index].operator === 'equals' && filters[index].value === value) remove(index)
    else updateField(field, { operator: 'equals', value, upper: undefined })
  }
  const fieldButton = (field: TableFilterField<T>) => <button key={field.id} type="button" aria-label={`${fieldFilter(field) ? '调整' : '添加'}${field.label}筛选`} onClick={() => pickField(field)} className="flex min-h-9 min-w-0 items-center justify-between gap-1 rounded-md px-2 text-left text-sm hover:bg-accent"><span className="truncate">{field.label}</span><Plus size={13} className="shrink-0 text-muted-foreground"/></button>
  const fieldSearchInput = <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 focus-within:ring-1 focus-within:ring-ring"><MagnifyingGlass size={14} className="text-muted-foreground"/><input aria-label="查找筛选字段" placeholder="搜索全部筛选项" value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none"/>{fieldSearch && <button type="button" aria-label="清除字段搜索" onClick={() => setFieldSearch('')}><X size={13}/></button>}</label>
  const choiceContent = (field: TableFilterField<T>, value: string) => renderOption?.(field.id, value) ?? field.renderOption?.(value) ?? field.optionLabel?.(value) ?? value
  const choiceLabel = (field: TableFilterField<T>, value: string) => field.optionLabel?.(value) ?? value
  const editor = (field: TableFilterField<T>, filter: TableFilter, index: number, isAdvanced: boolean) => {
    const change = (patch: Partial<TableFilter>) => index < 0 ? updateField(field, patch) : update(index, { ...(filters[index].operator !== filter.operator ? { operator: filter.operator, value: filter.value, upper: filter.upper, values: filter.values } : {}), ...patch })
    const noInput = filter.operator === 'empty' || filter.operator === 'not-empty'
    const range = filter.operator === 'between' || filter.operator === 'date-between'
    const values = selectedValues(filter)
    const options = [...new Set([...(field.options ?? []), ...values])]
    const search = optionSearch[field.id] ?? ''
    const matchingOptions = options.filter(value => fuzzyMatch(choiceLabel(field, value), search))
    const shownOptions = search.trim() || expandedOptions[field.id] ? matchingOptions : matchingOptions.slice(0, 12)
    const inputIndex = index < 0 ? filters.length + 1 : index + 1
    return <>
      {!noInput && (['equals', 'one-of'].includes(filter.operator) && field.options ? <div className="space-y-2">
        {options.length > 6 && <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2"><MagnifyingGlass size={14} className="shrink-0 text-muted-foreground"/><input aria-label={`搜索${field.label}选项`} placeholder={`搜索${field.label}`} value={search} onChange={event => setOptionSearch(current => ({ ...current, [field.id]: event.target.value }))} className="min-w-0 flex-1 bg-transparent text-sm outline-none"/>{search && <button type="button" aria-label={`清除${field.label}搜索`} onClick={() => setOptionSearch(current => ({ ...current, [field.id]: '' }))}><X size={13}/></button>}</label>}
        {values.length > 0 && options.length > 6 && <div className="flex flex-wrap gap-1" aria-label={`${field.label}已选项`}>{values.map(value => <button key={value} type="button" aria-label={`移除${field.label}：${choiceLabel(field, value)}`} onClick={() => change(filter.operator === 'one-of' ? { values: values.filter(item => item !== value) } : { value: '' })} className={cn('flex max-w-full items-center gap-1 rounded border border-primary/20 bg-primary/5 px-2 py-1 text-xs text-primary', feedback.reveal)}><span className="break-words">{choiceLabel(field, value)}</span><X size={12} className="shrink-0"/></button>)}</div>}
        <div className="flex flex-wrap gap-1.5" aria-label={`筛选值 ${inputIndex}`}>
          {shownOptions.map(value => <button key={value} type="button" aria-label={`${field.label}：${choiceLabel(field, value)}`} aria-pressed={values.includes(value)} onClick={() => change(filter.operator === 'one-of' ? { values: values.includes(value) ? values.filter(item => item !== value) : [...values, value] } : { value: filter.value === value ? '' : value })} className={cn('inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-left text-sm', feedback.choice, values.includes(value) ? 'border-primary/40 bg-primary/10 text-primary' : 'border-input hover:bg-accent')}><span className="min-w-0 break-words">{choiceContent(field, value)}</span><Check size={14} aria-hidden className={feedback.mark}/></button>)}
          {!matchingOptions.length && <p className="py-2 text-xs text-muted-foreground">没有匹配的选项</p>}
        </div>
        {matchingOptions.length > 12 && !search.trim() && <button type="button" className="min-h-8 text-xs text-primary" aria-expanded={!!expandedOptions[field.id]} onClick={() => setExpandedOptions(current => ({ ...current, [field.id]: !current[field.id] }))}>{expandedOptions[field.id] ? '收起选项' : `显示全部 ${matchingOptions.length} 项`}</button>}
      </div> : <div className="flex items-center gap-2">
        <input type={field.date ? 'date' : field.numeric ? 'number' : 'text'} step={field.numeric ? 'any' : undefined} aria-label={`筛选值 ${inputIndex}`} placeholder={range ? field.date ? '开始日期' : '最小值' : `搜索${field.label}`} value={filter.value} onChange={event => change({ value: event.target.value })} className={cn(inputClass, 'h-9 w-full flex-1')} />
        {range && <><span className="text-xs text-muted-foreground">至</span><input type={field.date ? 'date' : 'number'} step={field.numeric ? 'any' : undefined} aria-label={`筛选上限 ${inputIndex}`} placeholder={field.date ? '结束日期' : '最大值'} value={filter.upper ?? ''} onChange={event => change({ upper: event.target.value })} className={cn(inputClass, 'h-9 w-full flex-1')} /></>}
      </div>)}
      {field.date && (!isAdvanced || !field.operators || field.operators.includes('date-between')) && <div className="flex flex-wrap gap-1.5">{([['today', '今天'], ['week', '本周'], ['month', '本月']] as const).map(([mode, label]) => <button key={mode} type="button" className="min-h-8 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10" onClick={() => change({ operator: 'date-between', ...tableDatePreset(mode) })}>{label}</button>)}</div>}
    </>
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className={cn('h-8 gap-1.5', active.length > 0 && 'border-primary/40 bg-primary/5 text-primary')} aria-label={ariaLabel} disabled={!fields.length}>
      <FunnelSimple size={15} /><span>筛选</span>{active.length > 0 && <span key={active.length} className={cn("num rounded bg-primary/10 px-1 text-xs", feedback.reveal)}>{active.length}</span>}
    </Button></PopoverTrigger>
    <PopoverContent align="start" collisionPadding={12} style={{ maxHeight: 'min(75dvh, var(--radix-popover-content-available-height, 75dvh))' }} className="flex w-[min(440px,calc(100vw-24px))] flex-col gap-0 overflow-hidden p-0" onOpenAutoFocus={event => {
      if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) event.preventDefault()
    }}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <span className="text-sm font-medium">筛选<span className="ml-2 text-xs font-normal text-muted-foreground">{matching} / {totalRows} 条</span></span>
        {selected.length > 0 && <button type="button" onClick={() => { if (onClear) onClear(); else onFiltersChange([]); setAdding(false); setAdvancedFields({}) }} className="min-h-8 text-xs text-primary">清空条件</button>}
      </div>
      <div className="scroll-thin min-h-0 space-y-3 overflow-y-auto p-3">
        {preferred && <div className="space-y-3" aria-label="常用筛选">{common.map(field => {
          const existing = fieldFilter(field), filter = existing && tableFilterActive(existing) ? existing : blankFilter(field)
          const values = selectedValues(filter)
          const options = [...new Set([...(field.options ?? []), ...values])]
          const quick = !field.numeric && !field.date && options.length > 0 && options.length <= 8 && ['equals', 'one-of'].includes(defaultOperator(field))
          const hasValue = !!existing && tableFilterActive(existing)
          if (quick) return <section key={field.id} className="space-y-1.5" aria-label={`${field.label}快捷筛选`}>
            <div className="flex min-h-6 items-center justify-between gap-2 text-xs font-medium text-muted-foreground"><span>{field.label}{field.multiple && hasValue && <span className="ml-1.5">已选 {values.length}</span>}</span>{hasValue && <button type="button" aria-label={`清除${field.label}筛选`} className="text-xs text-primary" onClick={() => clearField(field)}>清除</button>}</div>
            <div className="flex flex-wrap gap-1.5">{options.map(value => <button key={value} type="button" aria-label={`${field.label}：${choiceLabel(field, value)}`} aria-pressed={values.includes(value)} onClick={() => toggleQuick(field, value)} className={cn('inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-left text-sm', feedback.choice, values.includes(value) ? 'border-primary/40 bg-primary/10 text-primary' : 'border-input hover:bg-accent')}><span className="min-w-0 break-words">{choiceContent(field, value)}</span><Check size={14} aria-hidden className={feedback.mark}/></button>)}</div>
          </section>
          const expanded = expandedFields[field.id] ?? hasValue
          const summary = hasValue ? tableFilterSummary(filter, '', field.optionLabel).trim().replace(/^[：=]\s*/, '') : '不限'
          return <section key={field.id} className="rounded-lg border" aria-label={`${field.label}筛选`}>
            <div className="flex min-h-10 items-center gap-2 pr-2">
              <button type="button" aria-label={`编辑${field.label}筛选`} aria-expanded={expanded} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-2.5 text-left text-sm" onClick={() => setExpandedFields(current => ({ ...current, [field.id]: !expanded }))}><span className="shrink-0 font-medium">{field.label}</span><span className={cn('min-w-0 flex-1 truncate text-right text-xs', hasValue ? 'text-primary' : 'text-muted-foreground')}>{summary}</span><CaretDown size={14} className={cn('shrink-0 text-muted-foreground', feedback.turn, expanded && 'rotate-180')}/></button>
              {hasValue && <button type="button" aria-label={`清除${field.label}筛选`} className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent" onClick={() => clearField(field)}><X size={14}/></button>}
            </div>
            {expanded && <div className="space-y-2 border-t p-2.5">{editor(field, filter, filters.findIndex(f => f.field === field.id), false)}</div>}
          </section>
        })}</div>}
        {advanced.length > 0 && <div className="space-y-2" aria-label="高级筛选条件">
          {preferred && <div className="text-xs font-medium text-muted-foreground">高级条件</div>}
          {advanced.map(({ filter, index, field }) => {
            const available = field.operators ? [...operators, ...dateOperators.filter(([op]) => !operators.some(([existing]) => existing === op))].filter(([op]) => field.operators!.includes(op)) : field.date ? dateOperators : operators.filter(([op]) => field.numeric ? !['contains', 'one-of'].includes(op) : ['contains', 'equals', 'empty', 'not-empty', ...(field.multiple ? ['one-of'] : [])].includes(op))
            return <section key={`${field.id}:${index}`} className="space-y-2 rounded-lg border bg-muted/20 p-2.5" aria-label={`${field.label}高级筛选`}>
              <div className="flex items-center gap-2">
                <SelectField aria-label={`筛选字段 ${index + 1}`} value={filter.field} onChange={event => {
                  const next = byId.get(event.target.value)
                  setAdvancedFields(current => ({ ...current, [event.target.value]: true }))
                  update(index, { field: event.target.value, operator: defaultOperator(next), value: '', upper: '', ...(filter.values ? { values: undefined } : {}) })
                }} className={cn(inputClass, 'flex-1 font-medium')}>
                  {fields.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </SelectField>
                {available.length > 1 && <SelectField aria-label={`筛选条件 ${index + 1}`} value={filter.operator} onChange={event => update(index, { operator: event.target.value as TableFilterOperator })} className={cn(inputClass, 'w-24 shrink-0 text-xs')}>
                  {available.map(([op, label]) => <option key={op} value={op}>{label}</option>)}
                </SelectField>}
                <button type="button" aria-label={`删除筛选 ${index + 1}`} onClick={() => { remove(index); setAdvancedFields(current => ({ ...current, [field.id]: false })) }} className="grid size-8 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"><X size={14}/></button>
              </div>
              {editor(field, filter, index, true)}
            </section>
          })}
        </div>}
        {preferred ? <div className="space-y-2 border-t pt-1">
          <button type="button" className="flex min-h-9 w-full items-center justify-between rounded-md px-2 text-sm text-muted-foreground hover:bg-accent" aria-expanded={more} onClick={() => setMore(value => !value)}><span>更多筛选</span><CaretDown size={14} className={cn(feedback.turn, more && 'rotate-180')}/></button>
          {more && <div className="space-y-2">{fieldSearchInput}<div className="grid grid-cols-2 gap-1">{choices.map(fieldButton)}</div>{!choices.length && <p className="py-3 text-center text-xs text-muted-foreground">没有匹配的筛选项</p>}</div>}
        </div> : (!selected.length || adding) ? <div className="space-y-2">
          {fieldSearchInput}<div className="grid grid-cols-2 gap-1">{choices.map(fieldButton)}</div>
          {!choices.length && <p className="py-3 text-center text-xs text-muted-foreground">{fieldSearch ? '没有匹配的筛选项' : '可选条件已添加'}</p>}
          {selected.length > 0 && <button type="button" onClick={() => { setAdding(false); setFieldSearch('') }} className="text-xs text-muted-foreground hover:text-foreground">收起</button>}
        </div> : <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-primary" disabled={selected.length >= fields.length} onClick={() => setAdding(true)}><Plus size={14}/>添加条件</Button>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2">{footer}<Button type="button" size="sm" className="ml-auto h-8" onClick={() => setOpen(false)}>完成</Button></div>
    </PopoverContent>
  </Popover>
}
