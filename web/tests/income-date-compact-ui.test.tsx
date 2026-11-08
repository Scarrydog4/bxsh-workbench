import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0 }))
vi.mock('react', async () => ({ ...await vi.importActual('react'), useState: (initial: any) => {
  const index = hooks.cursor++
  if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial
  return [hooks.slots[index], (next: any) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next }]
} }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/popover', () => ({ Popover: 'popover', PopoverContent: 'popover-content', PopoverTrigger: 'popover-trigger' }))
vi.mock('@/client/controls', () => ({ Segmented: 'segmented' }))
vi.mock('@/components/ui/calendar', () => ({ Calendar: 'calendar', fromDay: (date: Date) => date.toISOString().slice(0, 10), toDay: (day: string) => new Date(`${day}T00:00:00Z`) }))
import { IncomeDateFilter, incomePreset, type IncomeDateSelection } from '@/client/IncomeDateFilter'
const nodes = (node: any, skipPopup = false): any[] => Array.isArray(node) ? node.flatMap(n => nodes(n, skipPopup)) : node?.props ? skipPopup && node.type === 'popover-content' ? [] : [node, ...nodes(node.props.children, skipPopup)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T08:00:00Z')) })
afterEach(() => vi.useRealTimers())

it('紧凑模式外面只有日期按钮，全部/快捷和前后切换都在弹层内；收入默认模式保留', () => {
  const props = { value: incomePreset('month'), all: true, onAll: vi.fn(), onChange: vi.fn() }
  let tree = IncomeDateFilter({ ...props, compact: true, label: '下单日期' })
  const outside = nodes(tree, true)
  expect(outside.filter(n => n.type === 'button').map(text)).toEqual(['下单日期 · 全部'])
  expect(outside.some(n => n.type === 'segmented')).toBe(false)
  const popup = nodes(tree).find(n => n.type === 'popover-content')
  for (const label of ['全部日期', '今日', '本周', '本月']) expect(nodes(popup).some(n => n.type === 'button' && text(n) === label)).toBe(true)
  expect(nodes(popup).filter(n => ['往前一段', '往后一段'].includes(n.props['aria-label']))).toHaveLength(2)
  hooks.cursor = 0; tree = IncomeDateFilter(props)
  expect(nodes(tree, true).some(n => n.type === 'segmented')).toBe(true)
  expect(nodes(tree, true).filter(n => ['往前一段', '往后一段'].includes(n.props['aria-label']))).toHaveLength(2)
})

it('紧凑模式快捷切换和全部日期即时回写，范围平移仍复用原规则', () => {
  let value: IncomeDateSelection = incomePreset('month'), all = false
  const onChange = vi.fn((v: IncomeDateSelection) => { value = v; all = false }), onAll = vi.fn(() => { all = true })
  const render = () => { hooks.cursor = 0; return IncomeDateFilter({ value, all, compact: true, label: '结算日期', onChange, onAll }) }
  nodes(render()).find(n => n.type === 'popover').props.onOpenChange(true)
  nodes(render()).find(n => n.props['aria-label'] === '往前一段').props.onClick()
  expect(value).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
  expect(nodes(render()).find(n => n.type === 'calendar').props.month.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  nodes(render()).find(n => n.type === 'button' && text(n) === '今日').props.onClick()
  expect(value).toMatchObject({ from: '2026-10-27', to: '2026-10-27', mode: 'today' })
  expect(nodes(render()).find(n => n.type === 'popover').props.open).toBe(false)
  nodes(render()).find(n => n.props['aria-label'] === '往前一段').props.onClick()
  expect(value).toMatchObject({ from: '2026-10-26', to: '2026-10-26' })
  nodes(render()).find(n => n.type === 'button' && text(n) === '全部日期').props.onClick()
  expect(onAll).toHaveBeenCalledOnce()
  expect(nodes(render(), true).filter(n => n.type === 'button').map(text)).toEqual(['结算日期 · 全部'])
})
