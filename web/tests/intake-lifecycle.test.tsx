import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ values: [] as any[], writes: [] as any[], tab: 'parse' }))
vi.mock('react', async () => ({ ...await vi.importActual('react'), useEffect: () => {}, useRef: (current: any) => ({ current }), useState: (initial: any) => [h.values.length ? h.values.shift() : typeof initial === 'function' ? initial() : initial, (value: any) => h.writes.push(value)] }))
vi.mock('@/client/store', () => ({ useSession: () => ({ me: { id: 'boss' }, s: { payTags: ['定金', '尾款', '全款', '退款'] }, role: { locked: true }, can: () => true, user: () => ({ name: '老板' }) }) }))
vi.mock('@/client/prefs', () => ({ usePref: () => [h.tab, vi.fn()] }))
vi.mock('@/client/useConversation', () => ({ useConversation: () => [[], vi.fn()] }))
vi.mock('motion/react', async () => ({ ...await vi.importActual('motion/react'), useReducedMotion: () => false }))
vi.mock('sonner', () => ({ toast: vi.fn() }))
import { AssistantPage } from '@/client/AssistantPage'
import { AiIntakeHost } from '@/client/AiIntakeHost'
import { IntakeFlow } from '@/client/AiIntake'
import { Dialog } from '@/components/ui/dialog'
import { Payments } from '@/client/OrderDrawer'
function elements(n: any): any[] { return Array.isArray(n) ? n.flatMap(elements) : n?.props ? [n, ...elements(n.props.children)] : [] }
afterEach(() => { h.values = []; h.writes = []; vi.clearAllMocks() })

it('切换到问数据只隐藏录单组件，保留它的草稿和批次引用', () => {
  h.tab = 'ask'
  const nodes = elements(AssistantPage())
  expect(nodes.some(n => n.type === IntakeFlow)).toBe(true)
  expect(nodes.find(n => n.props.children?.type === IntakeFlow).props.hidden).toBe(true)
  h.tab = 'parse'
  expect(elements(AssistantPage()).find(n => n.props.children?.type === IntakeFlow).props.hidden).toBe(false)
})

it('录单尚未保存完整时不允许关闭弹窗，完成后正常关闭', () => {
  h.values = [null, { text: '', files: [] }]
  const nodes = elements(AiIntakeHost())
  const flow = nodes.find(n => n.type === IntakeFlow), dialog = nodes.find(n => n.type === Dialog)
  flow.props.onPendingChange(true)
  dialog.props.onOpenChange(false)
  expect(h.writes).toEqual([])
  flow.props.onClose()
  expect(h.writes).toEqual([null])
})

it('退单仍提供记退款入口，展开后默认选择退款类型', () => {
  const v = { id: 'o', status: '退单', payments: [], received: 200, unpaid: 0, receivables: [] } as any
  const open = vi.fn(), closed = Payments({ v, compact: true, formOpen: false, onFormOpen: open })
  expect(JSON.stringify(closed.props.action)).toContain('记退款')
  closed.props.action.props.onClick()
  expect(open).toHaveBeenCalledWith(true)
  const expanded = Payments({ v, compact: true, formOpen: true })
  const refund = elements(expanded).find(n => n.type === 'button' && n.props.children === '退款')
  expect(refund?.props.className).toContain('border-danger')
})
