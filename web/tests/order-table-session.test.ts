import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
const boot = () => ({
  version: 1, me: { id: 'boss', roleId: 'admin' },
  role: { id: 'admin', locked: true, perms: [], fields: { sales: true } },
  users: [{ id: 'boss', name: '负责人', isAdmin: true }],
  channels: [{ id: 'c', name: '现有渠道', avatar: 'channel.png' }],
  orderChannels: [{ id: 'c', name: '订单渠道' }],
  orders: [{ id: 'a', no: 'AJ2', title: '订单 A', channelId: 'c' }, { id: 'b', no: 'AJ1', title: '订单 B', channelId: 'c' }],
  trash: [], statuses: ['未交付', '已交付'], notifications: [], unread: 0,
})
beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

it('提醒正常刷新，但不改变订单页快照、查询函数及行数据', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(boot()))
  vi.stubGlobal('fetch', fetcher)
  const store = await import('@/client/store'); await store.refresh()
  const table = store.useOrderTableSession(), session = store.useSession()
  fetcher.mockResolvedValueOnce(Response.json({ unread: 1, notifications: [{ id: '1', title: '新提醒' }] }))
  await store.refreshNotes()
  expect(store.getState().unread).toBe(1)
  expect(store.useSession().s.notifications[0].title).toBe('新提醒')
  expect(store.useOrderTableSession()).toBe(table)
  expect(store.useSession().user).toBe(session.user)
  expect(store.useSession().channel).toBe(session.channel)
  expect(store.useSession().can).toBe(session.can)
})

it('单笔实时更新显示最新内容，保留其他订单和用户查询缓存', async () => {
  const data = boot(), fetcher = vi.fn().mockResolvedValueOnce(Response.json(data))
  vi.stubGlobal('fetch', fetcher)
  const store = await import('@/client/store'); await store.refresh()
  const before = store.useOrderTableSession(), untouched = before.order('b')
  fetcher.mockResolvedValueOnce(Response.json({ orders: [{ ...data.orders[0], title: '订单 A 已更新' }], removed: [], version: 2, unread: 0, notifications: [] }))
  await store.refreshOrders(['a'])
  const after = store.useOrderTableSession()
  expect(after).not.toBe(before)
  expect(after.order('a')?.title).toBe('订单 A 已更新')
  expect(after.order('b')).toBe(untouched)
  expect(after.user).toBe(before.user)
  expect(after.can).toBe(before.can)
  expect(after.channel('c')).toMatchObject({ name: '现有渠道', avatar: 'channel.png' })
})

it('渠道、人员、状态和权限刷新立即生效，切账号不会沿用旧权限', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(boot()))
  vi.stubGlobal('fetch', fetcher)
  const store = await import('@/client/store'); await store.refresh()
  expect(store.useOrderTableSession().can('order.delete')).toBe(true)
  const updated = boot()
  updated.channels[0].name = '改名后的渠道'
  updated.users[0].name = '改名后的负责人'
  updated.statuses.push('处理中')
  updated.me = { id: 'writer', roleId: 'writer' }
  updated.role = { id: 'writer', locked: false, perms: [], fields: { sales: false } }
  fetcher.mockResolvedValueOnce(Response.json(updated)); await store.refresh()
  const after = store.useOrderTableSession()
  expect(after.me.id).toBe('writer')
  expect(after.can('order.delete')).toBe(false)
  expect(after.user('boss')?.name).toBe('改名后的负责人')
  expect(after.channel('c')?.name).toBe('改名后的渠道')
  expect(after.s.statuses).toContain('处理中')
  expect(after.s.role.fields.sales).toBe(false)
})
