import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('react', async () => ({ ...await vi.importActual('react'), useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read() }))
const boot = (ids: string[] = []) => ({ version: 1, me: { id: 'writer' }, role: { id: 'writer' }, orders: ids.map(id => ({ id, no: id })), trash: [], users: [], channels: [], notifications: [], income: {}, audit: [] })
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('shell appears before complete data without presenting its empty orders as loaded', async () => {
  const shell = deferred<Response>(), full = deferred<Response>()
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('phase=shell') ? shell.promise : full.promise))
  const store = await import('@/client/store'), pending = store.refresh()
  expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['/api/bootstrap?phase=shell', '/api/bootstrap'])
  shell.resolve(Response.json(boot())); await flush()
  expect(store.useBootStatus()).toBe('ready')
  expect(store.useWorkspaceStatus()).toBe('loading')
  full.resolve(Response.json(boot(['mine']))); await pending
  expect(store.useWorkspaceStatus()).toBe('ready')
  expect(store.getState().orders.map(order => order.id)).toEqual(['mine'])
})

it('late shell cannot erase a complete response', async () => {
  const shell = deferred<Response>()
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('phase=shell') ? shell.promise : Promise.resolve(Response.json(boot(['complete'])))))
  const store = await import('@/client/store'); await store.refresh()
  shell.resolve(Response.json(boot())); await flush()
  expect(store.useWorkspaceStatus()).toBe('ready')
  expect(store.getState().orders.map(order => order.id)).toEqual(['complete'])
})

it('a failed full load exposes retry rather than an empty workspace; retry does not reapply shell', async () => {
  const first = deferred<Response>(), retry = deferred<Response>()
  let loads = 0
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('phase=shell') ? Promise.resolve(Response.json(boot())) : ++loads === 1 ? first.promise : retry.promise))
  const store = await import('@/client/store'), pending = store.refresh(); await flush()
  first.reject(new Error('offline')); await pending
  expect(store.useBootStatus()).toBe('ready'); expect(store.useWorkspaceStatus()).toBe('error')
  const next = store.refresh(true)
  expect(store.useWorkspaceStatus()).toBe('loading')
  retry.resolve(Response.json(boot(['recovered']))); await next
  expect(store.useWorkspaceStatus()).toBe('ready')
  expect(store.getState().orders[0].id).toBe('recovered')
  expect(vi.mocked(fetch).mock.calls.filter(call => String(call[0]).includes('phase=shell'))).toHaveLength(1)
})

it('an offline refresh retains already loaded business data and never replaces it with shell placeholders', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(Response.json(boot(url.includes('phase=shell') ? [] : ['confirmed'])))))
  const store = await import('@/client/store'); await store.refresh()
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
  await store.refresh(true)
  expect(store.useBootStatus()).toBe('ready'); expect(store.useWorkspaceStatus()).toBe('ready')
  expect(store.getState().orders[0].id).toBe('confirmed')
})

it('forced refresh during startup ignores the obsolete full snapshot', async () => {
  const first = deferred<Response>(), latest = deferred<Response>(); let loads = 0
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('phase=shell') ? Promise.resolve(Response.json(boot())) : ++loads === 1 ? first.promise : latest.promise))
  const store = await import('@/client/store'), pending = store.refresh(); await flush()
  const forced = store.refresh(true)
  first.resolve(Response.json(boot(['stale']))); await flush()
  expect(store.useWorkspaceStatus()).toBe('loading')
  expect(store.getState().orders).toEqual([])
  latest.resolve(Response.json(boot(['current']))); await Promise.all([pending, forced])
  expect(store.getState().orders[0].id).toBe('current')
})

it('forced refresh also discards an obsolete shell before it can expose the previous session', async () => {
  const shell = deferred<Response>(), first = deferred<Response>(), latest = deferred<Response>(); let loads = 0
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('phase=shell') ? shell.promise : ++loads === 1 ? first.promise : latest.promise))
  const store = await import('@/client/store'), pending = store.refresh()
  const forced = store.refresh(true)
  shell.resolve(Response.json({ ...boot(), me: { id: 'previous' } })); await flush()
  expect(store.useBootStatus()).toBe('loading')
  expect(store.getState()).toBeNull()
  first.resolve(Response.json(boot(['stale']))); await flush()
  latest.resolve(Response.json(boot(['current']))); await Promise.all([pending, forced])
  expect(store.getState().me.id).toBe('writer')
  expect(store.getState().orders[0].id).toBe('current')
})
