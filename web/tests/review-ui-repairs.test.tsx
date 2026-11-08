import { afterEach, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
const harness = vi.hoisted(() => ({ values: [] as unknown[], writes: [] as unknown[], session: {} as Record<string, unknown> }))
vi.mock('react', async () => ({ ...(await vi.importActual('react')), useState: () => [harness.values.shift(), (value: unknown) => harness.writes.push(value)], useEffect: () => {} }))
vi.mock('@/client/store', () => ({ useSession: () => harness.session }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ go: vi.fn(), openOrder: vi.fn(), newOrder: vi.fn() }) }))
vi.mock('@/client/ui', () => ({ StatusPill: 'span', ChannelName: 'span', Avatar: 'span', ImageDrop: 'div', inputCls: '' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { CommandPalette } from '@/client/CommandPalette'
import { PasswordForm } from '@/client/Profile'
import { toast } from 'sonner'
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); harness.writes = [] })
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<Record<string, unknown>>
  return [element, ...elements(element.props.children as ReactNode)]
}
it('全局搜索能找到原始列表第215条订单，而不先截断前200条', () => {
  harness.values = ['OLD-215']
  harness.session = { role: { locked: false }, s:{channels:[]}, can: () => true, channel: () => ({ name: '检索渠道' }), views: Array.from({ length: 215 }, (_, i) => ({ id: String(i), no: `OLD-${i + 1}`, title: `订单${i + 1}`, channelId: 'channel' })) }
  const tree = CommandPalette({ open: true, onOpenChange: vi.fn(), onHelp: vi.fn() })
  expect(elements(tree).some(e => String(e.props.value ?? '').includes('OLD-215'))).toBe(true)
})
it('改密码网络失败后解除忙碌状态，允许恢复网络后再次提交', async () => {
  harness.values = ['Old-pass-1', 'New-pass-2', 'New-pass-2', false]
  const onDone = vi.fn(), form = PasswordForm({ onDone })
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Network offline')).mockResolvedValueOnce(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await form.props.onSubmit({ preventDefault() {} })
  expect(harness.writes).toEqual([true, false])
  expect(toast.error).toHaveBeenCalled()
  expect(onDone).not.toHaveBeenCalled()
  await form.props.onSubmit({ preventDefault() {} })
  expect(onDone).toHaveBeenCalledOnce()
  expect(harness.writes).toEqual([true, false, true, '', '', '', {}, false])
})
