import { describe, expect, it } from 'vitest'
import { filterTableRows, tableFilterActive, tableFilterFields, tableFilterSummary, type TableFilter } from '@/client/table-filters'

type Row = { id: string; title: string; income: number | null; state: string; privateNote?: string }
const rows: Row[] = [
  { id: '1', title: 'AJ 机械设计', income: 0, state: '未交付', privateNote: '不应被搜索的内部信息' },
  { id: '2', title: 'XY 电气设计', income: 100, state: '已交付' },
  { id: '3', title: 'AJ 自动控制', income: 200, state: '已交付' },
  { id: '4', title: '待定项目', income: null, state: '' },
]
const columns = [
  { id: 'title', header: '订单', sort: (row: Row) => row.title },
  { id: 'income', header: '收入', sort: (row: Row) => row.income ?? -1, filterValue: (row: Row) => row.income },
  { id: 'state', header: '交付', filterValue: (row: Row) => row.state },
  { id: 'actions', header: '操作' },
]
const fields = tableFilterFields(columns, rows)
const run = (filters: TableFilter[], query = '') => filterTableRows(rows, fields, query, filters).map(row => row.id)

describe('通用表格搜索与筛选', () => {
  it('无筛选时保留原数组，仅授权列取值可被搜索', () => {
    expect(filterTableRows(rows, fields, '', [])).toBe(rows)
    expect(fields.map(field => field.id)).toEqual(['title', 'income', 'state'])
    expect(run([], '内部信息')).toEqual([])
    expect(run([{ field: 'privateNote', operator: 'contains', value: '内部信息' }])).toEqual(['1', '2', '3', '4'])
  })

  it('支持文字包含、精确匹配与忽略大小写的搜索', () => {
    expect(run([], ' aj ')).toEqual(['1', '3'])
    expect(run([{ field: 'title', operator: 'contains', value: '设计' }])).toEqual(['1', '2'])
    expect(run([{ field: 'state', operator: 'equals', value: '已交付' }])).toEqual(['2', '3'])
  })

  it('零金额仍是有效数字，空金额不会被当成零', () => {
    expect(fields.find(field => field.id === 'income')?.numeric).toBe(true)
    expect(run([{ field: 'income', operator: 'equals', value: '0' }])).toEqual(['1'])
    expect(run([{ field: 'income', operator: 'empty', value: '' }])).toEqual(['4'])
    expect(run([{ field: 'income', operator: 'not-empty', value: '' }])).toEqual(['1', '2', '3'])
  })

  it('金额区间包含边界，也支持只有一个边界', () => {
    expect(run([{ field: 'income', operator: 'between', value: '0', upper: '100' }])).toEqual(['1', '2'])
    expect(run([{ field: 'income', operator: 'between', value: '', upper: '100' }])).toEqual(['1', '2'])
    expect(run([{ field: 'income', operator: 'gte', value: '100' }])).toEqual(['2', '3'])
    expect(run([{ field: 'income', operator: 'lte', value: '0' }])).toEqual(['1'])
  })

  it('多条件及搜索按同时满足处理', () => {
    expect(run([
      { field: 'state', operator: 'equals', value: '已交付' },
      { field: 'income', operator: 'between', value: '100', upper: '200' },
    ], 'AJ')).toEqual(['3'])
  })

  it('未填的条件与未完成的数字输入不隐藏记录', () => {
    expect(tableFilterActive({ field: 'income', operator: 'gte', value: '-' })).toBe(false)
    expect(run([
      { field: 'income', operator: 'between', value: '', upper: '' },
      { field: 'title', operator: 'contains', value: ' ' },
    ])).toEqual(['1', '2', '3', '4'])
  })

  it('列有显示值时优先使用显示值，不用内部排序哨兵', () => {
    expect(run([], '-1')).toEqual([])
    expect(tableFilterFields(columns, [rows[3], rows[0]]).find(field => field.id === 'income')?.numeric).toBe(true)
  })

  it('生成明确的活动筛选摘要', () => {
    expect(tableFilterSummary({ field: 'income', operator: 'between', value: '0', upper: '200' }, '收入')).toBe('收入 0–200')
    expect(tableFilterSummary({ field: 'state', operator: 'empty', value: '' }, '交付')).toBe('交付为空')
  })

  it('识别日期，按日期前后和区间筛选，未填日期不会误入区间', () => {
    const dates = [{ day: '2026-10-01' }, { day: '2026-10-15' }, { day: '2026-11-01' }, { day: '' }]
    const dateFields = tableFilterFields([{ id: 'day', header: '下单', sort: (row: { day: string }) => row.day }], dates)
    expect(dateFields[0].date).toBe(true)
    const range: TableFilter = { field: 'day', operator: 'date-between', value: '2026-10-01', upper: '2026-10-15' }
    expect(filterTableRows(dates, dateFields, '', [range])).toEqual(dates.slice(0, 2))
    expect(filterTableRows(dates, dateFields, '', [{ ...range, operator: 'after', value: '2026-10-15' }])).toEqual(dates.slice(1, 3))
    expect(filterTableRows(dates, dateFields, '', [{ ...range, operator: 'before', value: '2026-10-15' }])).toEqual(dates.slice(0, 2))
    expect(filterTableRows(dates, dateFields, '', [{ ...range, value: '', upper: '2026-10-15' }])).toEqual(dates.slice(0, 2))
  })

  it('仅为低基数文本列提供当前授权数据里的可选值', () => {
    expect(fields.find(field => field.id === 'state')?.options).toEqual(expect.arrayContaining(['未交付', '已交付']))
    expect(fields.find(field => field.id === 'state')?.options).not.toContain('')
    expect(fields.find(field => field.id === 'income')?.options).toBeUndefined()
    const many = Array.from({ length: 13 }, (_, id) => ({ name: `订单 ${id}` }))
    expect(tableFilterFields([{ id: 'name', header: '订单', sort: (row: { name: string }) => row.name }], many)[0].options).toBeUndefined()
    const classified = tableFilterFields([{ id: 'channel', header: '渠道', filterOptions: 'all', sort: (row: { name: string }) => row.name }], many)
    expect(classified[0].options).toHaveLength(13)
    expect(filterTableRows(many, classified, '', [{ field: 'channel', operator: 'equals', value: '订单 12' }])).toEqual([many[12]])
  })
})

it('同字段多选取任一项，不同字段仍需同时满足；空多选不筛掉数据', () => {
  expect(run([{ field: 'state', operator: 'one-of', value: '', values: ['未交付', '已交付'] }])).toEqual(['1', '2', '3'])
  expect(run([{ field: 'state', operator: 'one-of', value: '', values: ['未交付', '已交付'] }, { field: 'income', operator: 'gte', value: '100' }])).toEqual(['2', '3'])
  expect(tableFilterActive({ field: 'state', operator: 'one-of', value: '', values: [] })).toBe(false)
  expect(run([{ field: 'state', operator: 'one-of', value: '', values: [' '] }])).toEqual(['1', '2', '3', '4'])
  expect(tableFilterSummary({ field: 'channel', operator: 'one-of', value: '', values: ['id1', 'id2'] }, '渠道', value => ({ id1: '小马', id2: '唐老师' })[value] ?? value)).toBe('渠道：小马、唐老师')
})

it('显式字段类型不受历史空日期和当前数据为空影响', () => {
  const explicit = tableFilterFields([
    { id: 'day', header: '结算日期', filterType: 'date', filterValue: () => null },
    { id: 'amount', header: '金额', filterType: 'number', filterValue: () => null },
    { id: 'code', header: '客户编号', filterType: 'text', filterValue: () => 100 },
  ], [{}])
  expect(explicit.map(({ id, numeric, date }) => ({ id, numeric, date }))).toEqual([
    { id: 'day', numeric: false, date: true }, { id: 'amount', numeric: true, date: false }, { id: 'code', numeric: false, date: false },
  ])
  expect(tableFilterFields([{ id: 'day', header: '结算日期', filterType: 'date', filterValue: () => null }], [])[0].date).toBe(true)
})
