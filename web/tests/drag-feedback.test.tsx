import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  slots: [] as any[], cursor: 0, effects: new Set<number>(), cleanups: [] as (() => void)[],
  monitor: {} as any, pref: 50, save: vi.fn(),
  sortable: { isDragging: false, isOver: false, activeIndex: 0, index: 1 },
}))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (effect: () => void | (() => void)) => { const i = h.cursor++; if (!h.effects.has(i)) { h.effects.add(i); const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) } },
}))
vi.mock('@dnd-kit/core', async () => ({
  ...await vi.importActual('@dnd-kit/core'), useDndMonitor: (monitor: any) => { h.monitor = monitor },
}))
vi.mock('@dnd-kit/sortable', async () => ({
  ...await vi.importActual('@dnd-kit/sortable'),
  useSortable: () => ({ ...h.sortable, attributes: {}, listeners: {}, setNodeRef: vi.fn(), setActivatorNodeRef: vi.fn() }),
}))
vi.mock('@/client/prefs', () => ({ useDevicePref: () => [h.pref, (value: number) => { h.pref = value; h.save(value) }] }))

import { MovableHeader } from '@/client/ColumnDrag'
import { TasksSplit } from '@/client/TasksSplit'
import styles from '@/client/drag-feedback.module.css'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const header = (props: Partial<Parameters<typeof MovableHeader>[0]> = {}) => { h.cursor = 0; return MovableHeader({ id: 'title', label: '名称', children: '名称', ...props }) }
const split = () => { h.cursor = 0; return TasksSplit({ left: '订单', right: '跟进' }) }
const divider = (tree: any) => nodes(tree).find(n => n.props.role === 'separator')
const released = (tree: any, key: string) => nodes(tree).find(n => key in n.props).props[key]

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  h.cleanups.splice(0).forEach(cleanup => cleanup())
  h.slots = []; h.cursor = 0; h.effects.clear(); h.monitor = {}; h.pref = 50
  h.sortable = { isDragging: false, isOver: false, activeIndex: 0, index: 1 }
  vi.clearAllMocks(); vi.useRealTimers()
})

it('落点只强调表头边缘，冻结位置和宽度保持原样，普通点击继续排序', () => {
  h.sortable.isOver = true
  const style = { position: 'sticky' as const, left: 50, top: 0, width: 200 }, onSort = vi.fn()
  const tree = header({ style, onSort, className: 'sticky top-0' })
  expect(tree.props.style).toBe(style)
  expect(tree.props.className).toContain(styles.dropRight)
  nodes(tree).find(n => n.type === 'button').props.onClick({})
  expect(onSort).toHaveBeenCalledOnce()
})

it('拖动结束不误触列排序，只让真正移动的列短亮，取消或移回原位没有成功反馈', async () => {
  const onSort = vi.fn()
  h.sortable.isDragging = true; header({ onSort })
  h.sortable.isDragging = false
  let tree = header({ onSort })
  nodes(tree).find(n => n.type === 'button').props.onClick({})
  expect(onSort).not.toHaveBeenCalled()
  h.monitor.onDragEnd({ active: { id: 'title' }, over: null })
  expect(released(header(), 'data-column-settled')).toBeUndefined()
  h.monitor.onDragEnd({ active: { id: 'title' }, over: { id: 'title' } })
  expect(released(header(), 'data-column-settled')).toBeUndefined()
  h.monitor.onDragEnd({ active: { id: 'other' }, over: { id: 'title' } })
  expect(released(header(), 'data-column-settled')).toBeUndefined()
  h.monitor.onDragEnd({ active: { id: 'title' }, over: { id: 'date' } })
  expect(released(header(), 'data-column-settled')).toBe(true)
  await vi.advanceTimersByTimeAsync(700)
  expect(released(header(), 'data-column-settled')).toBeUndefined()
  nodes(header({ onSort })).find(n => n.type === 'button').props.onClick({})
  expect(onSort).toHaveBeenCalledOnce()
})

it('分栏拖动保持即时宽度预览，松手才保存，短亮不会修改比例', async () => {
  let tree = split()
  tree.props.ref.current = { getBoundingClientRect: () => ({ width: 1016 }) }
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() }
  divider(tree).props.onPointerDown({ button: 0, isPrimary: true, pointerId: 1, clientX: 200, preventDefault: vi.fn(), currentTarget: target })
  divider(split()).props.onPointerMove({ pointerId: 1, clientX: 300 })
  tree = split()
  expect(tree.props.style['--tasks-left']).toBe('60fr')
  expect(h.save).not.toHaveBeenCalled()
  divider(tree).props.onPointerUp({ pointerId: 1, currentTarget: target })
  expect(h.save).toHaveBeenCalledExactlyOnceWith(60)
  expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
  expect(released(split(), 'data-split-settled')).toBe(true)
  await vi.advanceTimersByTimeAsync(700)
  expect(released(split(), 'data-split-settled')).toBeUndefined()
  expect(split().props.style['--tasks-left']).toBe('60fr')
})

it('取消拖动不保存，键盘与双击恢复原逻辑且卸载清理强调定时器', () => {
  const target = { focus: vi.fn(), setPointerCapture: vi.fn() }
  divider(split()).props.onPointerDown({ button: 0, isPrimary: true, pointerId: 1, clientX: 200, preventDefault: vi.fn(), currentTarget: target })
  divider(split()).props.onPointerCancel()
  expect(h.save).not.toHaveBeenCalled()
  expect(released(split(), 'data-split-settled')).toBeUndefined()
  divider(split()).props.onKeyDown({ key: 'ArrowRight', shiftKey: true, preventDefault: vi.fn() })
  expect(h.save).toHaveBeenLastCalledWith(60)
  expect(released(split(), 'data-split-settled')).toBe(true)
  divider(split()).props.onDoubleClick()
  expect(h.save).toHaveBeenLastCalledWith(60)
  h.cleanups.splice(0).forEach(cleanup => cleanup())
  expect(vi.getTimerCount()).toBe(0)
})
