import { afterEach, expect, it, vi } from 'vitest'
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
const input = { kind: '写手工资' as const, requestId: 'fixed-request', payeeId: 'writer', lines: [{ orderId: 'a', amount: 75 }, { orderId: 'b', amount: 200 }], date: '2026-10-10', note: '本批付款', shots: ['proof'] }

it.each([400, 409, 422])('批量发放 HTTP %s 明确拒绝，可修改后重试', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '金额已变化' }, { status })))
  const { payIncomeBatchWithOutcome } = await import('@/client/store-p2')
  expect(await payIncomeBatchWithOutcome(input)).toEqual({ status: 'rejected' })
})

it.each([408, 500, 502])('批量发放 HTTP %s 保留未知状态', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '响应未知' }, { status })))
  const { payIncomeBatchWithOutcome } = await import('@/client/store-p2')
  expect(await payIncomeBatchWithOutcome(input)).toEqual({ status: 'unknown' })
})

it.each([
  ['坏 JSON', 'broken'], ['非文本编号', { id: 123, amount: 275, count: 2 }], ['缺总额', { id: 'batch', count: 2 }], ['缺条数', { id: 'batch', amount: 275 }], ['零条数', { id: 'batch', amount: 275, count: 0 }],
])('批量成功响应%s仍不能确认记账', async (_label, body) => {
  vi.stubGlobal('fetch', vi.fn(async () => typeof body === 'string' ? new Response(body) : Response.json(body)))
  const { payIncomeBatchWithOutcome } = await import('@/client/store-p2')
  expect(await payIncomeBatchWithOutcome(input)).toEqual({ status: 'unknown' })
})

it('响应丢失后保留未知，重试携带原始批次并刷新成功金额', async () => {
  let lost = true
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    if (lost) { lost = false; throw new TypeError('Lost response') }
    return Response.json(url.includes('/api/act/') ? { id: 'saved-batch', amount: 275, count: 2 } : { me: { id: 'boss' }, role: {}, orders: [], income: {}, audit: [] })
  })
  vi.stubGlobal('fetch', fetcher)
  const { payIncomeBatchWithOutcome } = await import('@/client/store-p2')
  expect(await payIncomeBatchWithOutcome(input)).toEqual({ status: 'unknown' })
  expect(await payIncomeBatchWithOutcome(input)).toEqual({ status: 'success', result: { id: 'saved-batch', amount: 275, count: 2 } })
  expect(fetcher.mock.calls[0][0]).toBe('/api/act/settle.payBatch')
  expect(fetcher.mock.calls[1][0]).toBe('/api/act/settle.payBatch')
  expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify(input))
  expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body)
})

it('批量结算反馈异常不改变已经确认的成功结果', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/api/act/') ? { id: 'batch', amount: 275, count: 2 } : { me: { id: 'boss' }, role: {}, orders: [], income: {}, audit: [] })))
  const { payIncomeBatchWithOutcome } = await import('@/client/store-p2')
  const onConfirmed = vi.fn(async () => { throw new Error('view unmounted') })
  expect((await payIncomeBatchWithOutcome(input, { onConfirmed })).status).toBe('success')
  expect(onConfirmed).toHaveBeenCalledOnce()
})
