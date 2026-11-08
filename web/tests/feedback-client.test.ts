import { afterEach, expect, it, vi } from 'vitest'
import { fetchFeedback } from '@/client/feedback-client'

afterEach(() => vi.unstubAllGlobals())

it('取齐授权反馈后再交给共享表格筛选，后续页失败不冒充完整列表', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ rows: [{ id: 'a', title: '第一条' }], total: 2, next: 1 }))
    .mockResolvedValueOnce(Response.json({ rows: [{ id: 'b', title: '最后一条' }], total: 2, next: null }))
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController()
  expect((await fetchFeedback(controller.signal)).map(row => row.id)).toEqual(['a', 'b'])
  expect(fetcher.mock.calls[1][0]).toContain('offset=1')
  expect(fetcher.mock.calls[1][1]).toMatchObject({ cache: 'no-store', signal: controller.signal })
  fetcher.mockResolvedValueOnce(Response.json({ rows: [{ id: 'a' }], total: 2, next: 1 })).mockResolvedValueOnce(Response.json({ error: '请重新登录' }, { status: 401 }))
  await expect(fetchFeedback()).rejects.toThrow('请重新登录')
})
