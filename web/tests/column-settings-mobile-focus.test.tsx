import { afterEach, expect, it, vi } from 'vitest'
import type { Table } from '@tanstack/react-table'

vi.mock('react', async () => ({ ...await vi.importActual('react'), useState: (value: unknown) => [value, vi.fn()] }))
vi.mock('@dnd-kit/core', async () => ({ ...await vi.importActual('@dnd-kit/core'), useSensor: vi.fn(), useSensors: vi.fn() }))
import { ColumnSettings } from '@/client/ColumnSettings'
import { PopoverContent } from '@/components/ui/popover'

const table = {
  getAllLeafColumns: () => Array.from({ length: 13 }, (_, i) => ({
    id: `column-${i}`, columnDef: { header: `列${i}` }, getIsVisible: () => true, getCanHide: () => true,
  })),
} as unknown as Table<unknown>
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
afterEach(() => vi.unstubAllGlobals())

it.each([false, true])('手机打开列设置不主动唤起键盘，带订单选项=%s', withOptions => {
  const matchMedia = vi.fn(() => ({ matches: true }))
  vi.stubGlobal('window', { matchMedia })
  const tree = nodes(ColumnSettings({ table, children: withOptions ? <select aria-label="行高"/> : undefined }))
  const event = { preventDefault: vi.fn() }
  tree.find(node => node.type === PopoverContent).props.onOpenAutoFocus(event)
  expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  const search = tree.find(node => node.props['aria-label'] === '搜索列')
  expect(search).toBeDefined()
  expect(search.props.disabled).not.toBe(true)
  expect(search.props.readOnly).not.toBe(true)
})

it('桌面打开列设置保留默认自动焦点与键盘导航', () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  const content = nodes(ColumnSettings({ table })).find(node => node.type === PopoverContent)
  const event = { preventDefault: vi.fn() }
  content.props.onOpenAutoFocus(event)
  expect(event.preventDefault).not.toHaveBeenCalled()
})
