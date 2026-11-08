import { expandOrder } from '@/shared/order-wire'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const snapshot = () => ({ version:1,me:{id:'boss'},role:{id:'admin'},income:{},audit:[],channels: [{ id: 'source' }, { id: 'target' }], orders: [expandOrder({ id: 'live', channelId: 'source' })], trash: [{ id: 'trash', channelId: 'source' }] })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => vi.resetModules())
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('删除成功立即更新渠道和订单，不等待全量刷新；迟到的旧快照不能把渠道带回来', async () => {
  const old = deferred<Response>(), latest = deferred<Response>()
  const fetcher = vi.fn()
    .mockResolvedValueOnce(response(snapshot()))
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(response({ ok: true, moved: 2 }))
    .mockReturnValueOnce(latest.promise)
  vi.stubGlobal('fetch', fetcher)
  const store = await import('@/client/store')
  await store.refresh()
  const pendingRefresh = store.refresh()
  expect(await store.deleteChannel('source', 'target')).toEqual({ ok: true, moved: 2 })
  expect(store.getState().channels.map(c => c.id)).toEqual(['target'])
  expect(store.getState().orders[0].channelId).toBe('target')
  expect(store.getState().trash[0].channelId).toBe('target')
  old.resolve(response(snapshot()))
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
  expect(store.getState().channels.map(c => c.id)).toEqual(['target'])
  const final = { ...snapshot(), channels: [{ id: 'target' }], orders: [expandOrder({ id: 'live', channelId: 'target' })], trash: [{ id: 'trash', channelId: 'target' }] }
  latest.resolve(response(final))
  await pendingRefresh
  expect(store.getState()).toEqual(final)
})

it('删除失败保留原列表，不误报成功，也不额外刷新', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response({ error: '请选择接收渠道' }, 400))
  vi.stubGlobal('fetch', fetcher)
  const store = await import('@/client/store')
  await store.refresh()
  expect(await store.deleteChannel('source')).toBeNull()
  expect(store.getState()).toEqual(snapshot())
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('自己的删除和实时通知共用一次刷新', async () => {
  vi.useFakeTimers()
  let changed!: (e:{data:string}) => void
  vi.stubGlobal('EventSource', class { addEventListener(_name: string, handler: (e:{data:string}) => void) { changed = handler } })
  const fetcher = vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response({ ok: true, moved: 0 })).mockResolvedValue(response({ ...snapshot(), channels: [{ id: 'target' }] }))
  vi.stubGlobal('fetch', fetcher)
  const store = await import('@/client/store')
  await store.refresh()
  store.connectLive()
  changed({data:JSON.stringify({version:2})})
  await store.deleteChannel('source')
  await vi.advanceTimersByTimeAsync(500)
  expect(fetcher).toHaveBeenCalledTimes(3)
})
