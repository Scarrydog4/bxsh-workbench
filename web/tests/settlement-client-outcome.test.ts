import { afterEach, expect, it, vi } from 'vitest'
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
const input = { kind: '销售提成' as const, requestId: 'a', orderId: 'o', payeeId: 'p', amount: 100, date: '2026-10-09' }
it.each([400, 401, 403, 404, 409, 422, 429])('HTTP %s 明确拒绝允许重新编辑', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '请求被拒绝' }, { status })))
  const { payOrderWithOutcome } = await import('@/client/store-p2')
  expect(await payOrderWithOutcome(input)).toEqual({ status: 'rejected' })
})
it.each([408, 500, 502, 503])('HTTP %s 结果未知，不能换请求号重复登记', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '服务暂不可用' }, { status })))
  const { payOrderWithOutcome } = await import('@/client/store-p2')
  expect(await payOrderWithOutcome(input)).toEqual({ status: 'unknown' })
})
it('断网保留未知状态；确认成功保留响应里的本笔金额', async () => {
  let lost = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (lost) { lost = false; throw new TypeError('Lost response') }
    return Response.json(url.includes('/api/act/') ? { id: 'saved-batch', amount: 100 } : { me: { id: 'boss' }, role: {}, orders: [], income: {}, audit: [] })
  }))
  const { payOrderWithOutcome } = await import('@/client/store-p2')
  expect(await payOrderWithOutcome(input)).toEqual({ status: 'unknown' })
  expect(await payOrderWithOutcome(input)).toEqual({ status: 'success', result: { id: 'saved-batch', amount: 100 } })
})
it.each(['invalid-json', 'missing-id', 'missing-amount'])('2xx 响应%s时仍视为结果未知', async kind => {
  vi.stubGlobal('fetch', vi.fn(async () => kind === 'invalid-json' ? new Response('broken', { status: 200 }) : Response.json(kind === 'missing-id' ? { amount: 100 } : { id: 'saved-batch' })))
  const { payOrderWithOutcome } = await import('@/client/store-p2')
  expect(await payOrderWithOutcome(input)).toEqual({ status: 'unknown' })
})

it('结算确认反馈只在真实成功后出现，刷新等待反馈结束', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    return Response.json(url.includes('/api/act/') ? { id: 'confirmed', amount: 100 } : { me: { id: 'boss' }, role: {}, orders: [], income: {}, audit: [] })
  }))
  const { payOrderWithOutcome } = await import('@/client/store-p2')
  const onConfirmed = vi.fn(() => held)
  const pending = payOrderWithOutcome(input, { onConfirmed })
  await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
  expect(calls).toEqual(['/api/act/settle.pay'])
  release()
  expect((await pending).status).toBe('success')
  expect(calls).toContain('/api/bootstrap')
})

it('被拒绝或响应不完整时不出现结算成功反馈', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'missing-amount' })))
  const { payOrderWithOutcome } = await import('@/client/store-p2')
  const onConfirmed = vi.fn()
  expect((await payOrderWithOutcome(input, { onConfirmed })).status).toBe('unknown')
  expect(onConfirmed).not.toHaveBeenCalled()
})
