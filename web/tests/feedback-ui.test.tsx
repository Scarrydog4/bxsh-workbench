import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Feedback } from '@/shared/feedback'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, session: {} as any, act: vi.fn() }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'), useEffect: () => {},
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, act: h.act }))
vi.mock('@/client/SettlementNote', () => ({ SettlementNote: 'note-input', SettlementNoteView: 'note-view' }))
vi.mock('@/client/SelectField', () => ({ SelectField: 'select' }))
vi.mock('@/client/controls', () => ({ Segmented: 'segments' }))
vi.mock('@/client/ui', () => ({ Person: 'person', Empty: 'empty', inputCls: '' }))
vi.mock('@/client/table-kit', () => ({ DataTable: 'table', TableFooter: 'footer', TablePageHeader: 'header' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'content', DialogTitle: 'h1', DialogDescription: 'description' }))
import { FeedbackCreateDialog, FeedbackDetail, FeedbackPage } from '@/client/FeedbackPage'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const author = { id: 'sales-a', name: '销售甲', hue: 100 }
const item: Feedback = { id: 'f1', no: '#1', authorId: author.id, author, kind: '问题', title: '截图没有保存', body: '填写后截图消失', shots: ['/api/feedback/f1/images/p1'], status: '待处理', createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', replies: [{ id: 'r1', by: 'boss', author: { id: 'boss', name: '老板', hue: 20 }, body: '已定位，处理中', shots: ['/api/feedback/f1/images/p2'], at: '2026-10-24T00:01:00Z' }] }
beforeEach(() => { h.session = { me: { id: 'sales-a' }, role: { locked: false }, s: { version: 1 } }; h.act.mockResolvedValue(null) })
afterEach(() => { h.slots = []; h.cursor = 0; vi.clearAllMocks() })

it('新建反馈上传读取中不能提交；结果未知时重试沿用同一请求，成功才关闭', async () => {
  const saved = vi.fn().mockResolvedValue(undefined)
  const render = () => { h.cursor = 0; return FeedbackCreateDialog({ onClose: vi.fn(), onSaved: saved }) }
  nodes(render()).find(n => n.type === 'input').props.onChange({ target: { value: '  截图没有保存  ' } })
  let tree = render(), note = nodes(tree).find(n => n.type === 'note-input')
  note.props.onNote('复现步骤'); note.props.onShots(['data:image/png;base64,a']); note.props.onReading(true)
  expect(nodes(render()).find(n => n.type === 'button' && n.props.type === 'submit').props.disabled).toBe(true)
  note.props.onReading(false)
  const submit = () => nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
  await submit(); await Promise.resolve()
  expect(saved).not.toHaveBeenCalled()
  const first = h.act.mock.calls[0][1]
  expect(first).toMatchObject({ title: '截图没有保存', kind: '问题', body: '复现步骤', shots: ['data:image/png;base64,a'] })
  h.act.mockResolvedValueOnce({ id: 'f1' })
  await submit(); await Promise.resolve()
  expect(h.act.mock.calls[1][1].requestId).toBe(first.requestId)
  expect(saved).toHaveBeenCalledWith('f1')
})

it('员工详情能看完整描述和回复截图，不能改状态；截图回复允许单独提交', async () => {
  const saved = vi.fn().mockResolvedValue(undefined)
  const render = () => { h.cursor = 0; return FeedbackDetail({ item, canManage: false, canReply: true, onClose: vi.fn(), onSaved: saved }) }
  const tree = render()
  expect(nodes(tree).some(n => n.type === 'select')).toBe(false)
  expect(nodes(tree).filter(n => n.type === 'note-view').map(n => [n.props.note, n.props.shots])).toEqual([[item.body, item.shots], [item.replies[0].body, item.replies[0].shots]])
  nodes(tree).find(n => n.type === 'note-input').props.onShots(['data:image/png;base64,b'])
  h.act.mockResolvedValueOnce({ id: 'f1' })
  await nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await Promise.resolve()
  expect(h.act.mock.calls[0].slice(0, 2)).toEqual(['feedback.reply', expect.objectContaining({ id: 'f1', body: '', shots: ['data:image/png;base64,b'] })])
  expect(saved).toHaveBeenCalledOnce()
})

it('老板处理状态使用反馈动作；无回复权限时没有提交入口；切账号丢弃旧详情', async () => {
  const saved = vi.fn().mockResolvedValue(undefined)
  let tree = FeedbackDetail({ item, canManage: true, canReply: false, onClose: vi.fn(), onSaved: saved })
  expect(nodes(tree).some(n => n.type === 'note-input')).toBe(false)
  h.act.mockResolvedValueOnce({ id: 'f1' })
  nodes(tree).find(n => n.type === 'select').props.onChange({ target: { value: '已解决' } })
  await Promise.resolve(); await Promise.resolve()
  expect(h.act.mock.calls[0].slice(0, 2)).toEqual(['feedback.update', expect.objectContaining({ id: 'f1', status: '已解决' })])
  expect(saved).toHaveBeenCalledOnce()
  const firstKey = FeedbackPage().key
  h.session.me.id = 'sales-b'
  expect(FeedbackPage().key).not.toBe(firstKey)
})
