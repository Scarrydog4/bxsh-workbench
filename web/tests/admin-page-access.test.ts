import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ ctx: vi.fn(), redirect: vi.fn((url: string, type: string) => { throw new Error(`${type}:${url}`) }) }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: 'bxsh_session=test' }) }))
vi.mock('next/navigation', () => ({ redirect: h.redirect, RedirectType: { replace: 'replace' } }))
vi.mock('@/server/session', () => ({ getCtx: h.ctx }))
import { requireAdminPage } from '@/server/workbench-page-access'
afterEach(() => vi.clearAllMocks())

it.each(['settings', 'accounts', 'audit', 'trash'])('未登录访问 %s 后返回原管理页', async section => {
  h.ctx.mockResolvedValue(null)
  await expect(requireAdminPage(`/admin/${section}`)).rejects.toThrow(`replace:/login?next=%2Fadmin%2F${section}`)
})
it('非管理员直接访问管理页在服务器端replace回首页', async () => {
  h.ctx.mockResolvedValue({ role: { locked: false } })
  await expect(requireAdminPage('/admin/accounts')).rejects.toThrow('replace:/')
})
it('管理员通过服务器校验', async () => {
  h.ctx.mockResolvedValue({ role: { locked: true } })
  await requireAdminPage('/admin/audit')
  expect(h.redirect).not.toHaveBeenCalled()
})
