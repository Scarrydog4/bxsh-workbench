import { beforeEach, expect, it, vi } from 'vitest'
import type { OrderView } from '@/shared/types'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, session: {} as any }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (next: any) => { h.slots[i] = next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, updateOrder: vi.fn() }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/ui', () => ({ inputCls: '' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
import { OrderDeadline } from '@/client/OrderDeadline'
import { DatePicker } from '@/client/DatePicker'
import { updateOrder } from '@/client/store'
import { Popover } from '@/components/ui/popover'
const v = { id: 'order', dueDate: '2026-10-28', assignees: [{ userId: 'writer' }] } as OrderView
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const render = (value = v) => { h.cursor = 0; return OrderDeadline({ v: value }) }
const all = () => nodes(render())
const form = () => all().find(n => n.type === 'form')
const button = () => all().find(n => n.props.type === 'submit')
const open = () => { all().find(n => n.type === Popover).props.onOpenChange(true) }
beforeEach(() => {
  h.slots = []; h.cursor = 0; vi.clearAllMocks()
  h.session = { me: { id: 'writer' }, s: { role: { locked: false, perms: ['order.view', 'order.draft'] } } }
})
it('只有本单写手有修改入口；别单只显示日期', () => {
  expect(all().some(n => n.props['aria-label'] === '调整交付日期')).toBe(true)
  expect(render({ ...v, assignees: [] }).type).toBe('span')
})
it('新日期和非空原因均为必填，不能绕过禁用按钮提交空格', async () => {
  open()
  expect(button().props.disabled).toBe(true)
  all().find(n => n.type === DatePicker).props.onChange('2026-10-30')
  all().find(n => n.type === 'textarea').props.onChange({ target: { value: '  ' } })
  expect(button().props.disabled).toBe(true)
  await form().props.onSubmit({ preventDefault: vi.fn() })
  expect(updateOrder).not.toHaveBeenCalled()
})
it('失败保留日期和备注，成功保存裁去首尾空格的备注后关闭', async () => {
  open()
  all().find(n => n.type === DatePicker).props.onChange('2026-10-30')
  all().find(n => n.type === 'textarea').props.onChange({ target: { value: '  客户补资料  ' } })
  vi.mocked(updateOrder).mockResolvedValueOnce(false)
  await form().props.onSubmit({ preventDefault: vi.fn() })
  expect(all().find(n => n.type === Popover).props.open).toBe(true)
  expect(all().find(n => n.type === 'textarea').props.value).toBe('  客户补资料  ')
  vi.mocked(updateOrder).mockResolvedValueOnce(true)
  await form().props.onSubmit({ preventDefault: vi.fn() })
  expect(updateOrder).toHaveBeenLastCalledWith('order', { dueDate: '2026-10-30' }, { reason: '客户补资料' })
  expect(all().find(n => n.type === Popover).props.open).toBe(false)
})
it('老板仍可直接选日期，写手自己的广权限账号也不能跳过原因备注', () => {
  h.session.s.role = { locked: true, perms: [] }
  expect(render().type).toBe(DatePicker)
  h.session.s.role = { locked: false, perms: ['order.edit', 'order.draft'] }
  expect(all().some(n => n.props['aria-label'] === '交期调整备注')).toBe(true)
})
