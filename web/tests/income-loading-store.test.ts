import { afterEach, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
const row = { key: 'qa-order', id: 'qa-order', title: '测试收入', kind: '工资', amount: 100, paid: 40, left: 60 }
const boot = (income = {}) => ({ me: { id: 'boss' }, role: { locked: true }, users: [], orders: [], trash: [], notifications: [], channels: [], income, audit: [], version: 1, unread: 0 })

it.each(['http', 'network', 'json'] as const)('收入首次 %s 失败返回 false，重试成功返回 true', async failure => {
  let fail = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/bootstrap') return Response.json(boot())
    if (fail) {
      if (failure === 'network') throw new TypeError('offline')
      return failure === 'http' ? new Response('', { status: 503 }) : new Response('invalid json')
    }
    return Response.json({ rows: [row], next: null })
  }))
  const store = await import('@/client/store'); await store.refresh()
  expect(await store.loadIncome('writer')).toBe(false)
  expect(store.getState().income.writer).toBeUndefined()
  fail = false
  expect(await store.loadIncome('writer')).toBe(true)
  expect(store.getState().income.writer).toEqual([row])
})

it('收入翻页请求中途失败保留原应发实发数据，不用半份响应覆盖', async () => {
  let refreshing = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/bootstrap') return Response.json(boot())
    if (!refreshing) return Response.json({ rows: [row], next: null })
    return url.includes('offset=0') ? Response.json({ rows: [{ ...row, paid: 80, left: 20 }], next: 1 }) : new Response('', { status: 503 })
  }))
  const store = await import('@/client/store'); await store.refresh()
  expect(await store.loadIncome('writer')).toBe(true)
  refreshing = true
  expect(await store.loadIncome('writer')).toBe(false)
  expect(store.getState().income.writer).toEqual([row])
})
