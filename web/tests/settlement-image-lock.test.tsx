import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: new Map<string, any[]>(), scope: '', cursor: 0, session: {} as any }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'), useEffect: () => {}, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
  useState: (initial: any) => { const i = h.cursor++, slots = h.slots.get(h.scope) ?? []; h.slots.set(h.scope, slots); if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
  useRef: (current: any) => { const slots = h.slots.get(h.scope)!, i = h.cursor++; return slots[i] ??= { current } },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session }))
vi.mock('@/client/store-p2', () => ({ confirmBatch: vi.fn(), fetchCandidates: vi.fn(), saveBatch: vi.fn(), updateBatchNote: vi.fn(), voidBatch: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/table-kit', () => ({ DataTable: 'table', TableFooter: 'footer', TablePageHeader: 'header' }))
vi.mock('@/client/ui', () => ({ Avatar: 'avatar', Combobox: 'combo', Empty: 'empty', Money: 'money', Person: 'person', PageHeader: 'header', Pill: 'pill', StatusPill: 'status', inputCls: '' }))
vi.mock('@/client/SettlementNote', () => ({ SettlementNote: 'settlement-note', SettlementNoteView: 'note-view' }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: 'checkbox' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { SettlePage } from '@/client/SettlePage'
import { saveBatch, confirmBatch, updateBatchNote } from '@/client/store-p2'
const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children), ...nodes(n.props.toolbarExtras)] : []
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : n?.props ? text(n.props.children) : ''
const button = (tree: any, label: string) => nodes(tree).find(n => n.type === 'button' && text(n).startsWith(label))
const note = (tree: any) => nodes(tree).find(n => n.type === 'settlement-note')
function render(mode: 'pay' | 'records') {
  const call = (scope: string, fn: () => any) => { h.scope = scope; h.cursor = 0; return fn() }
  const root = call('root', () => SettlePage())
  const dialog = nodes(root).find(n => typeof n.type === 'function' && n.type.name === (mode === 'pay' ? 'BatchEditor' : 'BatchDialog'))
  return call('dialog', () => dialog.type(dialog.props))
}
function setup(mode: 'pay' | 'records') {
  const row = { orderId: 'o', payeeId: 'p', title: '订单', no: 'DD1', remaining: 50, on: true, amount: '50', note: '', showNote: false, status: '已交付' }
  const b = { id: 'b', no: 'J1', payeeId: 'p', kind: '写手工资', status: '已确认', total: 50, lines: [], note: '原备注', shots: [], createdAt: '2026-10-09T00:00:00Z', createdBy: 'boss' }
  h.session = { s: { users: [{ id: 'p', name: '写手', canWrite: true }], batches: [b], orders: [] }, me: { id: 'boss' }, role: { locked: true }, can: () => true, adminIds: new Set(['boss']), user: () => ({ id: 'p', name: '写手' }), views: [], order: () => null }
  h.slots.set('root', ['写手工资', '全部', '', mode === 'records' ? 'b' : null, mode === 'pay' ? {} : null])
  if (mode === 'pay') h.slots.set('dialog', ['p', [row]])
}
afterEach(() => { h.slots.clear(); vi.resetAllMocks() })
it('批量结算读取图片时同步禁止确认，读完带凭证保存', async () => {
  setup('pay'); const tree = render('pay')
  vi.mocked(saveBatch).mockResolvedValue({ id: 'saved' } as any); vi.mocked(confirmBatch).mockResolvedValue(true)
  note(tree).props.onReading(true)
  await button(tree, '保存并确认发放').props.onClick()
  expect(saveBatch).not.toHaveBeenCalled(); expect(button(render('pay'), '保存并确认发放').props.disabled).toBe(true)
  note(tree).props.onShots(['transfer-shot']); note(tree).props.onReading(false)
  await button(render('pay'), '保存并确认发放').props.onClick()
  await vi.waitFor(() => expect(confirmBatch).toHaveBeenCalledWith('saved'))
  expect(saveBatch).toHaveBeenCalledWith(expect.objectContaining({ shots: ['transfer-shot'] }))
})
it('修改结算备注读取图片时同步禁止保存，文字和截图读完一起保存', async () => {
  setup('records'); let tree = render('records'); button(tree, '编辑备注').props.onClick(); tree = render('records')
  vi.mocked(updateBatchNote).mockResolvedValue(true)
  note(tree).props.onReading(true)
  await button(tree, '保存备注').props.onClick()
  expect(updateBatchNote).not.toHaveBeenCalled(); expect(button(render('records'), '保存备注').props.disabled).toBe(true)
  note(tree).props.onShots(['new-shot']); note(tree).props.onReading(false)
  await button(render('records'), '保存备注').props.onClick()
  expect(updateBatchNote).toHaveBeenCalledWith('b', '原备注', ['new-shot'])
})
