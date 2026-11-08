import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), queue: [] as (() => void)[] }))
vi.mock('react', () => ({
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((value, j) => value !== old.deps[j])) h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) },
}))
vi.mock('@/client/store', () => ({ useSession: () => ({ me: { id: 'qa-loading' }, role: {} }), pendingAfterSaleTasks: (rows: unknown[]) => rows }))
import { useAfterSaleTasks } from '@/client/after-sale-data'

function render() {
  h.cursor = 0; h.queue = []
  const state = useAfterSaleTasks()
  h.queue.forEach(effect => effect())
  return state
}
afterEach(() => {
  h.effects.forEach(effect => effect.cleanup?.())
  h.slots = []; h.cursor = 0; h.effects.clear(); h.queue = []
  vi.unstubAllGlobals()
})

it('跟进首次请求保留加载状态，失败可重试，成功空列表才是真正的零条', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  let finish!: (value: Response) => void
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve })).mockResolvedValueOnce(Response.json({ tasks: [] }))
  vi.stubGlobal('fetch', fetcher)
  expect(render().loading).toBe(true)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  finish(new Response('', { status: 503 }))
  await vi.waitFor(() => expect(render().loading).toBe(false))
  expect(render().error).toBe('跟进加载失败')
  render().reload(); render()
  expect(render().loading).toBe(true)
  await vi.waitFor(() => expect(render().loading).toBe(false))
  expect(render().error).toBe('')
  expect(render().tasks).toEqual([])
  expect(fetcher).toHaveBeenCalledTimes(2)
})
