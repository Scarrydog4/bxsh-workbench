import { afterEach, expect, it, vi } from 'vitest'
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
it('响应丢失后重试复用请求号，成功后的独立收款使用新请求号', async () => {
  const snapshot = { me: { id: 'sales' } }
  const bodies: { requestId: string }[] = []
  let lost = true
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/act/')) {
      bodies.push(JSON.parse(init!.body as string))
      if (lost) { lost = false; throw new TypeError('Lost response') }
      return Response.json({ ok: true })
    }
    return Response.json(snapshot)
  }))
  const store = await import('@/client/store')
  await store.refresh()
  const p = { amount: 300, date: '2026-10-08', tag: '定金', note: '' }
  expect(await store.addPayment('order', p)).toBe(false)
  expect(await store.addPayment('order', p)).toBe(true)
  expect(await store.addPayment('order', p)).toBe(true)
  expect(bodies[0].requestId).toBe(bodies[1].requestId)
  expect(bodies[2].requestId).not.toBe(bodies[1].requestId)
})
