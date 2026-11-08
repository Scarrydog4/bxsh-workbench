import { afterEach, expect, it, vi } from 'vitest'
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/client/files', () => ({ thumb: vi.fn().mockResolvedValue(undefined) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
it('上传完成响应丢失，重试复用上传编号及断点，返回原附件', async () => {
  let received = 0, lost = true
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === '/api/upload') return Response.json({ id: 'up_test', chunk: 1024 })
    if (url.endsWith('/complete')) {
      if (lost) { lost = false; throw new TypeError('响应丢失') }
      return Response.json({ id: 'f_test' })
    }
    if (init?.method === 'PUT') { received = 5; return Response.json({ received }) }
    return Response.json({ received })
  }))
  const { uploadDeliveryShot } = await import('@/client/store')
  const file = new File(['image'], '截图.png', { type: 'image/png' })
  expect(await uploadDeliveryShot(file, { orderId: 'o' })).toBeNull()
  expect(calls).toEqual(['POST /api/upload', 'PUT /api/upload/up_test?offset=0', 'POST /api/upload/up_test/complete'])
  expect(await uploadDeliveryShot(file, { orderId: 'o' })).toBe('f_test')
  expect(calls.filter(c => c === 'POST /api/upload')).toHaveLength(1)
  expect(calls.filter(c => c.startsWith('PUT'))).toHaveLength(1)
  expect(calls.filter(c => c.endsWith('/complete'))).toHaveLength(2)
})
