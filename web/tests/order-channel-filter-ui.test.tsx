import { beforeEach, expect, it, vi } from 'vitest'
import type { ChannelLabel } from '@/shared/channel-access'

const hooks = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0 }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.state)) hooks.state[index] = initial
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next }]
  },
}))
import { FilterPopover, orderFilterChannels } from '@/client/OrdersPage'

const props = () => ({
  statuses: ['未交付', '已交付'], channels: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `渠道 ${i}` } as ChannelLabel)),
  statusF: ['未交付'], channelF: ['c19'], setStatusF: vi.fn(), setChannelF: vi.fn(), views: [], viewId: 'all', chooseView: vi.fn(),
  special: { due: true }, setSpecial: vi.fn(), receipt: 'partial' as const, canSeeSales: true, setReceipt: vi.fn(),
  count: 4, clear: vi.fn(), rename: vi.fn(), remove: vi.fn(), move: vi.fn(),
})
beforeEach(() => { hooks.state = []; hooks.cursor = 0 })

it('渠道ID多选通过共享控件更新，其他条件和已选渠道保留', () => {
  const p = props()
  hooks.cursor = 0
  const tree = FilterPopover(p)
  const field = tree.props.fields.find((f: any) => f.id === 'channel')
  expect(field.options).toHaveLength(20)
  expect(field.optionLabel('c19')).toBe('渠道 19')
  expect(field.multiple).toBe(true)
  tree.props.onFiltersChange(tree.props.filters.map((f: any) => f.field === 'channel' ? { ...f, values: ['c19', 'c15'] } : f))
  expect(p.setChannelF).toHaveBeenCalledWith(['c19', 'c15'])
  expect(p.setStatusF).not.toHaveBeenCalled()
  expect(p.setReceipt).not.toHaveBeenCalled()
  expect(p.setSpecial).not.toHaveBeenCalled()
})

it('单独清空渠道不清空其他条件，头像选项由同一渠道标签提供', () => {
  const p = props()
  hooks.cursor = 0
  const tree = FilterPopover(p)
  tree.props.onFiltersChange(tree.props.filters.filter((f: any) => f.field !== 'channel'))
  expect(p.setChannelF).toHaveBeenCalledWith([])
  expect(p.clear).not.toHaveBeenCalled()
  expect(p.setSpecial).not.toHaveBeenCalled()
  expect(p.setStatusF).not.toHaveBeenCalled()
  expect(p.setReceipt).not.toHaveBeenCalled()
  expect(tree.props.renderOption('channel', 'c19').props.channel).toEqual(p.channels[19])
})

it('写手没有渠道库时仍可筛选可见订单渠道，排除其他订单和重复标签', () => {
  const labels = [
    { id: 'own', name: '本人订单渠道', avatar: '/api/avatar/own', ownerId: 'sales' },
    { id: 'other', name: '本人订单渠道', avatar: '/api/avatar/other', ownerId: 'other-sales' },
    { id: 'own', name: '本人订单渠道', avatar: '/api/avatar/own', ownerId: 'sales' },
  ]
  const options = orderFilterChannels([{ channelId: 'own' }, { channelId: 'own' }], labels)
  expect(options).toEqual([{ id: 'own', name: '本人订单渠道', avatar: '/api/avatar/own' }])
  const p = { ...props(), channels: options, channelF: [] }
  hooks.cursor = 0
  const tree = FilterPopover(p)
  const field = tree.props.fields.find((f: any) => f.id === 'channel')
  expect(field.options).toEqual(['own'])
  expect(field.optionLabel('own')).toBe('本人订单渠道')
  tree.props.onFiltersChange([...tree.props.filters, { field: 'channel', operator: 'one-of', value: '', values: ['own'] }])
  expect(p.setChannelF).toHaveBeenCalledWith(['own'])
  expect(orderFilterChannels([], labels)).toEqual([])
})
