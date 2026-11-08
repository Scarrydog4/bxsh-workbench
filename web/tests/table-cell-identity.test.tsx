import { afterEach, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, table: null as any }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: any) => { const index = hooks.cursor++; return hooks.slots[index] ??= { current } },
  useState: (initial: any) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.slots[index], (next: any) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next }]
  },
}))
vi.mock('@/client/prefs', () => ({ usePref: (_key: string, fallback: unknown) => [fallback, vi.fn()] }))
vi.mock('@/client/ColumnDrag', () => ({ ColumnDrag: 'column-drag', MovableHeader: 'movable-header' }))
vi.mock('@/client/TableToolbar', () => ({ TableToolbar: 'table-toolbar' }))
vi.mock('@tanstack/react-table', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-table')>('@tanstack/react-table')
  return { ...actual, useReactTable: (options: any) => {
    // 仅跳过 React hook 适配层；列、行、context 和 flexRender 仍使用真实 TanStack。
    const table = hooks.table ??= actual.createTable({ ...options, onStateChange: () => {}, renderFallbackValue: null })
    table.setOptions((previous: any) => ({ ...previous, ...options, state: { ...table.initialState, ...options.state } }))
    return table
  } }
})

import { DataTable, type Col } from '@/client/table-kit'

type Row = { id: string; title: string }
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
// 使用真实 TanStack flexRender 的输出；函数 type 改变就会卸载下面的交付表单。
const cells = (tree: any) => nodes(tree).filter(node => node.props.cell?.id === 'task-one_action')
function DeliveryProbe({ title, tick }: { title: string; tick: number }) { return <button>{title} · {tick}</button> }
function render(cols: Col<Row>[], rows: Row[] = [{ id: 'task-one', title: 'AJ20261026 跟进' }]) {
  hooks.cursor = 0
  return DataTable({ id: 'cell-identity-test', cols, rows, rowId: row => row.id, freeze: 0 })
}
afterEach(() => { hooks.slots = []; hooks.cursor = 0; hooks.table = null; vi.clearAllMocks() })

it('倒计时每秒重建内联列时，桌面和手机单元格的 React 组件身份保持不变', () => {
  const columns = (tick: number): Col<Row>[] => [{ id: 'action', header: '操作', cell: row => <DeliveryProbe title={row.title} tick={tick}/> }]
  const initial = cells(render(columns(0)))
  expect(initial).toHaveLength(2)
  for (let tick = 1; tick <= 5; tick++) {
    const updated = cells(render(columns(tick)))
    expect(updated).toHaveLength(2)
    for (let index = 0; index < updated.length; index++) {
      expect(updated[index].type).toBe(initial[index].type)
      const content = updated[index].type(updated[index].props)
      expect(content.type).toBe(DeliveryProbe)
      expect(content.props.tick).toBe(tick)
    }
  }
})

it('稳定的单元格使用最新行数据和最新回调，不把旧闭包永久缓存', () => {
  const oldRender = vi.fn((row: Row) => <DeliveryProbe title={`旧：${row.title}`} tick={0}/>), newRender = vi.fn((row: Row) => <DeliveryProbe title={`新：${row.title}`} tick={1}/>)
  const initial = cells(render([{ id: 'action', header: '操作', cell: oldRender }]))
  initial.forEach(cell => cell.type(cell.props))
  expect(oldRender).toHaveBeenCalledTimes(2)
  const row = { id: 'task-one', title: 'AJ20261026 更新后的跟进' }
  const updated = cells(render([{ id: 'action', header: '操作', cell: newRender }], [row]))
  updated.forEach((cell, index) => {
    expect(cell.type).toBe(initial[index].type)
    expect(cell.type(cell.props).props).toEqual({ title: `新：${row.title}`, tick: 1 })
  })
  expect(newRender).toHaveBeenCalledTimes(2)
  expect(newRender).toHaveBeenLastCalledWith(row)
  expect(oldRender).toHaveBeenCalledTimes(2)
})

it('收入表格搜索无匹配，清除搜索时保留已选列条件', () => {
  const cols: Col<Row>[] = [{ id: 'title', header: '标题', filterValue: row => row.title, cell: row => row.title }]
  const filters = [{ field:'title', operator:'contains', value:'AJ' }]
  function draw() {
    hooks.cursor = 0
    return nodes(DataTable({id:'income-report-date', cols, rows:[{id:'1',title:'AJ'}], rowId: row => row.id,
      filteredEmpty: clear => <button onClick={clear}>清除筛选</button>}))
  }
  const toolbar = () => draw().find(node => node.type === 'table-toolbar').props
  toolbar().onFiltersChange(filters)
  toolbar().onQueryChange('无匹配')
  draw().find(node => node.type === 'button' && node.props.children === '清除筛选').props.onClick()
  expect(toolbar().query).toBe('')
  expect(toolbar().filters).toEqual(filters)
})
