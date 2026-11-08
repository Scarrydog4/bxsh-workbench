import { afterEach, expect, it, vi } from 'vitest'
import type { ActionResult } from '@/client/operation-feedback'
import type { UploadOptions } from '@/client/store'

vi.mock('sonner', () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); vi.useRealTimers() })

const boot = () => ({ me: { id: 'operator' }, role: { locked: true }, users: [], channels: [], orders: [], trash: [], notifications: [], version: 1, unread: 0 })
const delta = () => ({ orders: [], removed: [], notifications: [], version: 2, unread: 0 })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

it.each([
  [400, 'error'], [403, 'error'], [409, 'error'], [408, 'uncertain'], [500, 'uncertain'], [503, 'uncertain'],
] as const)('HTTP %s 回报真实的 %s 状态且保留失败返回值', async (status, expected) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '请求未完成' }, { status })))
  const { act } = await import('@/client/store'), onResult = vi.fn()
  expect(await act('order.update', { id: 'order', patch: { title: '草稿' } }, { silent: true, onResult })).toBeNull()
  expect(onResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: expected }))
})

it.each(['断网', '无可解析响应'] as const)('%s 不断言写入失败，而是回报结果待确认', async failure => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (failure === '断网') throw new TypeError('离线')
    return new Response('broken json', { status: 200 })
  }))
  const { act } = await import('@/client/store'), onResult = vi.fn()
  expect(await act('order.update', {}, { silent: true, onResult })).toBeNull()
  expect(onResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'uncertain' }))
})

it('成功回调等待真实响应；确认提示在刷新前完成，不提前修改快照', async () => {
  let respond!: (response: Response) => void, acknowledge!: () => void
  const response = new Promise<Response>(resolve => { respond = resolve })
  const acknowledgement = new Promise<void>(resolve => { acknowledge = resolve })
  const calls: string[] = [], results: ActionResult[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url === '/api/bootstrap') return Response.json(boot())
    if (url === '/api/act/order.markDraft') return response
    if (url.startsWith('/api/orders?')) return Response.json(delta())
    throw new Error(`unexpected request ${url}`)
  }))
  const store = await import('@/client/store')
  await store.refresh()
  const onConfirmed = vi.fn(() => acknowledgement)
  const pending = store.markDraft('order', ['proof'], { onResult: result => results.push(result), onConfirmed })
  await flush()
  expect(results).toEqual([]); expect(onConfirmed).not.toHaveBeenCalled()
  respond(Response.json({ ok: true })); await flush()
  expect(results).toEqual([{ status: 'success' }]); expect(onConfirmed).toHaveBeenCalledOnce()
  expect(calls).toEqual(['/api/bootstrap', '/api/act/order.markDraft'])
  expect(store.getState().version).toBe(1)
  acknowledge()
  expect(await pending).toBe(true)
  expect(calls.at(-1)).toBe('/api/orders?ids=order')
  expect(store.getState().version).toBe(2)
})

it('加入局部反馈后，收款失败重试仍复用 requestId，成功后独立记款才换号', async () => {
  const bodies: { requestId: string }[] = [], results: ActionResult[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/bootstrap') return Response.json(boot())
    if (url.startsWith('/api/orders?')) return Response.json(delta())
    bodies.push(JSON.parse(init!.body as string))
    return bodies.length === 1 ? Response.json({ error: '响应未确认' }, { status: 503 }) : Response.json({ ok: true })
  }))
  const store = await import('@/client/store'); await store.refresh()
  const payment = { amount: 300, date: '2026-10-30', tag: '定金', note: '' }, options = { silent: true, onResult: (result: ActionResult) => results.push(result) }
  expect(await store.addPayment('order', payment, options)).toBe(false)
  expect(await store.addPayment('order', payment, options)).toBe(true)
  expect(await store.addPayment('order', payment, options)).toBe(true)
  expect(bodies[0].requestId).toBe(bodies[1].requestId)
  expect(bodies[1].requestId).not.toBe(bodies[2].requestId)
  expect(results.map(result => result.status)).toEqual(['uncertain', 'success', 'success'])
})

it.each(['error', 'uncertain'] as const)('附件批次第二份 %s 后重试，第一份不重传，第二份复用原上传编号和已收字节', async failure => {
  const calls: string[] = [], results: ActionResult[] = [], events: Parameters<NonNullable<UploadOptions['onFile']>>[0][] = []
  const received = new Map<string, number>()
  let failed = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === '/api/bootstrap') return Response.json(boot())
    if (url.startsWith('/api/orders?')) return Response.json(delta())
    if (url === '/api/upload') {
      const body = JSON.parse(init!.body as string)
      return Response.json({ id: body.name === 'first.png' ? 'upload-first' : 'upload-second', chunk: 2 })
    }
    const id = url.split('/')[3].split('?')[0]
    if (url.endsWith('/complete')) {
      if (id === 'upload-second' && !failed) {
        failed = true
        if (failure === 'uncertain') throw new TypeError('完成响应丢失')
        return Response.json({ error: '截图未通过检查' }, { status: 422 })
      }
      return Response.json({ id: `file-${id}` })
    }
    if (init?.method === 'PUT') {
      received.set(id, (received.get(id) ?? 0) + (init.body as ArrayBuffer).byteLength)
      return Response.json({ received: received.get(id) })
    }
    return Response.json({ received: received.get(id) ?? 0 })
  }))
  const store = await import('@/client/store'); await store.refresh()
  const files = [new File(['1234'], 'first.png', { type: 'image/png' }), new File(['5678'], 'second.png', { type: 'image/png' })]
  const options: UploadOptions = { silent: true, onResult: result => results.push(result), onFile: event => events.push(event) }
  expect(await store.uploadFiles(files, { orderId: 'order' }, options)).toBe(false)
  expect(events.filter(event => event.file === files[0]).map(event => event.phase)).toContain('uploaded')
  expect(events.at(-1)).toMatchObject({ file: files[1], phase: failure, index: 1, total: 2 })
  const beforeRetry = calls.length, previousEvents = events.length
  expect(await store.uploadFiles(files, { orderId: 'order' }, options)).toBe(true)
  expect(events[previousEvents]).toMatchObject({ file: files[0], phase: 'uploaded' })
  expect(calls.slice(beforeRetry)).toEqual(['GET /api/upload/upload-second', 'POST /api/upload/upload-second/complete', 'GET /api/orders?ids=order'])
  expect(calls.filter(call => call === 'POST /api/upload')).toHaveLength(2)
  expect(calls.filter(call => call === 'POST /api/upload/upload-first/complete')).toHaveLength(1)
  expect(events.some(event => event.phase === 'uploading' && event.progress === 0.5)).toBe(true)
  expect(events.filter(event => event.phase === 'saving').every(event => event.progress === 1)).toBe(true)
  expect(results.map(result => result.status)).toEqual([failure, 'success'])
})

it.each([[403, 'error'], [408, 'uncertain']] as const)('分片持续 HTTP %s 保留六次尝试和五次断点查询，最终反馈 %s', async (status, expected) => {
  vi.useFakeTimers()
  const calls: string[] = [], onResult = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === '/api/upload') return Response.json({ id: 'chunk-retry', chunk: 1024 })
    if (init?.method === 'PUT') return Response.json({ error: '分片请求未通过' }, { status })
    return Response.json({ received: 0 })
  }))
  const store = await import('@/client/store')
  const pending = store.uploadDeliveryShot(new File(['image'], 'proof.png', { type: 'image/png' }), { orderId: 'order' }, undefined, { silent: true, onResult })
  await flush(); await vi.runAllTimersAsync()
  expect(await pending).toBeNull()
  expect(calls.filter(call => call.startsWith('PUT '))).toHaveLength(6)
  expect(calls.filter(call => call === 'GET /api/upload/chunk-retry')).toHaveLength(5)
  expect(calls.filter(call => call === 'POST /api/upload')).toHaveLength(1)
  expect(onResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: expected }))
})


it.each([200, 403, 503])('删除 HTTP %s：只在服务端确认后移除订单，不等待慢刷新，也不改变其他单的工资', async status => {
  const orders = [{ id: 'qa-delete', title: 'QA 删除', assignees: [], afterSales: [], payments: [] }, { id: 'keep', title: '保留', assignees: [{ userId: 'writer', paid: 100 }], afterSales: [], payments: [{ amount: 400 }] }]
  let respond!: (response: Response) => void, finishRefresh!: (response: Response) => void
  const response = new Promise<Response>(resolve => { respond = resolve })
  const refreshResponse = new Promise<Response>(resolve => { finishRefresh = resolve })
  let boots = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/bootstrap') return ++boots === 1 ? Response.json({ ...boot(), orders }) : refreshResponse
    if (url === '/api/act/order.delete') return response
    throw new Error(`unexpected request ${url}`)
  }))
  const store = await import('@/client/store'); await store.refresh()
  const retained = store.getState().orders[1], confirmed = vi.fn()
  const pending = store.deleteOrders(['qa-delete'], { silent: true, onConfirmed: confirmed })
  await flush()
  expect(store.getState().orders).toHaveLength(2)
  respond(Response.json(status === 200 ? { ok: true } : { error: '删除未确认' }, { status })); await flush()
  expect(store.getState().orders.map(order => order.id)).toEqual(status === 200 ? ['keep'] : ['qa-delete', 'keep'])
  expect(store.getState().orders.find(order => order.id === 'keep')).toBe(retained)
  expect(confirmed).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
  if (status === 200) finishRefresh(Response.json({ ...boot(), orders: [orders[1]], version: 2 }))
  expect(await pending).toBe(status === 200)
})
