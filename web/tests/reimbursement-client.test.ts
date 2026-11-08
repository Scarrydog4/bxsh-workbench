import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/client/store', () => ({ act: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }))
import { act, refresh } from '@/client/store'
import { fetchReimbursements, sendReimbursement } from '@/client/reimbursement-client'
const input = { requestId: 'request', id: 'r1', expectedVersion: 3 }
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })
it('明确拒绝和结果未知分开，成功后刷新通知且保留幂等payload', async () => {
  vi.mocked(act).mockImplementationOnce(async (_name, _input, opts) => { opts?.onRejected?.(); return null })
  expect(await sendReimbursement('withdraw', input)).toEqual({ status: 'rejected' })
  vi.mocked(act).mockResolvedValueOnce(null)
  expect(await sendReimbursement('withdraw', input)).toEqual({ status: 'unknown' })
  vi.mocked(act).mockResolvedValueOnce({ id: 'r1' })
  expect(await sendReimbursement('withdraw', input)).toEqual({ status: 'success', id: 'r1' })
  expect(vi.mocked(act).mock.calls[2].slice(0, 2)).toEqual(['reimburse.withdraw', input]); expect(refresh).toHaveBeenCalledOnce()
})
it('未知成功响应不清空草稿；查询参数正确编码并支持更多和id定位', async () => {
  vi.mocked(act).mockResolvedValueOnce({} as never)
  expect(await sendReimbursement('withdraw', input)).toEqual({ status: 'unknown' })
  const fetcher = vi.fn(async (_url: string) => Response.json({ rows: [], total: 0, next: null, summary: {} })); vi.stubGlobal('fetch', fetcher)
  await fetchReimbursements({ q: '图纸 & 单据', applicant: 'u1', status: '待处理', offset: 50 })
  const params = new URL(fetcher.mock.calls[0][0] as string, 'https://test.local').searchParams
  expect(params.get('q')).toBe('图纸 & 单据'); expect(params.get('offset')).toBe('50')
  await fetchReimbursements({ id: 'r1' }); expect(String(fetcher.mock.calls[1][0])).toContain('id=r1')
})
