import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
const snapshot = (frame = 'none') => ({ version: 1, me: { id: 'writer', frame }, users: [{ id: 'writer', frame }, { id: 'boss', frame: 'crown' }], role: { id: 'writer' }, orders: [], income: {}, audit: [] })
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (value: T) => resolve(value) } }
beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

it('选择立即改变本人和公开头像，保存失败恢复原框', async () => {
  const save = deferred<Response>()
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(snapshot())).mockReturnValueOnce(save.promise)
  vi.stubGlobal('fetch', fetcher)
  const store = await import('@/client/store'); await store.refresh()
  const pending = store.setUserFrame('writer', 'bow')
  expect(store.getState().me.frame).toBe('bow')
  expect(store.getState().users[0].frame).toBe('bow')
  expect(store.getState().users[1].frame).toBe('crown')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  save.resolve(Response.json({ error: '保存失败' }, { status: 400 }))
  expect(await pending).toBe(false)
  expect(store.getState().me.frame).toBe('none')
  expect(store.getState().users[0].frame).toBe('none')
})

it('连续切换按顺序保存，旧刷新不会盖过最后选择，最后保存成功后仍是最新框', async () => {
  const first = deferred<Response>(), second = deferred<Response>(), sent: string[] = []
  let persisted = 'none'
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/bootstrap') return Promise.resolve(Response.json(snapshot(persisted)))
    sent.push(JSON.parse(init!.body as string).frame)
    return sent.length === 1 ? first.promise : second.promise
  }))
  const store = await import('@/client/store'); await store.refresh()
  const older = store.setUserFrame('writer', 'crown'), newer = store.setUserFrame('writer', 'bow')
  expect(store.getState().me.frame).toBe('bow')
  await vi.waitFor(() => expect(sent).toEqual(['crown']))
  persisted = 'crown'; first.resolve(Response.json({ ok: true })); expect(await older).toBe(true)
  await vi.waitFor(() => expect(sent).toEqual(['crown', 'bow']))
  expect(store.getState().me.frame).toBe('bow')
  persisted = 'bow'; second.resolve(Response.json({ ok: true })); expect(await newer).toBe(true)
  expect(store.getState().me.frame).toBe('bow')
  expect(store.getState().users[0].frame).toBe('bow')
})
