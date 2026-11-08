import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], effects: new Map<number, { deps: any[]; cleanup?: () => void }>(), queue: [] as (() => void)[], cursor: 0, session: {} as any }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => void | (() => void), deps: any[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((v, j) => v !== old.deps[j])) { h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) } },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/reimbursement-client', () => ({ sendReimbursement: vi.fn(), fetchReimbursements: vi.fn() }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/ui', () => ({ Combobox: 'combo', Field: 'field', Person: 'person', Pill: 'pill', SkeletonRows: 'skeleton', inputCls: '' }))
vi.mock('@/client/SettlementNote', () => ({ SettlementNote: 'settlement-note', SettlementNoteView: 'settlement-view' }))
vi.mock('@/client/files', () => ({ thumb: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { ReimbursementDialog, validReimbursementDraft } from '@/client/ReimbursementDialog'
import { fetchReimbursements, sendReimbursement } from '@/client/reimbursement-client'
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const button = (tree: any, label: string) => nodes(tree).find(node => node.type === 'button' && text(node.props.children).startsWith(label))
const input = (tree: any, label: string) => nodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === label)
const proof = (tree: any) => nodes(tree).find(node => node.props.label === '付款账单 / 备注')
let row: any
const list = () => ({ rows: [row], total: 1, next: null, summary: { pendingAmount: row.amount, paidAmount: 0, pendingCount: 1, paidCount: 0 } })
function setup(admin = false) {
  row = { id: 'r1', no: 'BX1', applicantId: 'employee', version: 1, category: '图纸', amount: 100, expenseDate: '2026-10-09', note: '', proofs: ['proof1'], orderId: null, status: '待处理', history: [] }
  const me = { id: admin ? 'boss' : 'employee', name: admin ? '老板' : '员工' }
  h.session = { me, role: { locked: admin }, s: { version: 1, users: [me], orders: [] }, views: [], user: () => me, channel: () => null }
  vi.mocked(fetchReimbursements).mockImplementation(async () => list())
}
function render(props: Partial<Parameters<typeof ReimbursementDialog>[0]> = {}) {
  h.cursor = 0; h.queue = []
  const tree = ReimbursementDialog({ open: true, onOpenChange: vi.fn(), ...props })
  for (const effect of h.queue) effect()
  return tree
}
async function loaded(props: Partial<Parameters<typeof ReimbursementDialog>[0]> = {}) { render(props); await vi.waitFor(() => expect(fetchReimbursements).toHaveBeenCalled()); return render(props) }
afterEach(() => { for (const effect of h.effects.values()) effect.cleanup?.(); h.slots = []; h.effects.clear(); h.queue = []; vi.resetAllMocks() })
it('备注可空但必有有效金额、日期和至少一张付款账单', () => {
  const draft = { category: '图纸' as const, amount: '100', expenseDate: '2026-10-09', orderId: '', note: '', proofs: ['proof'] }
  expect(validReimbursementDraft(draft)).toBe(true)
  expect(validReimbursementDraft({ ...draft, proofs: [] })).toBe(false)
  expect(validReimbursementDraft({ ...draft, amount: '1.001' })).toBe(false)
  expect(validReimbursementDraft({ ...draft, expenseDate: '2026-02-31' })).toBe(false)
  expect(validReimbursementDraft({ ...draft, expenseDate: '2999-10-09' })).toBe(false)
})
it('员工默认记录，底部申请打开中号表单；读取图片期间禁提交', () => {
  setup(); let tree = render()
  const application = (value: any) => nodes(value).find(node => node.type === 'dialog' && nodes(node.props.children).some(child => child.props['data-reimbursement-application']))
  expect(application(tree).props.open).toBe(false)
  expect(nodes(tree).filter(node => node.type === 'button' && text(node) === '申请报销')).toHaveLength(1)
  button(tree, '申请报销').props.onClick(); tree = render()
  expect(application(tree).props.open).toBe(true)
  expect(nodes(application(tree)).find(node => node.props['data-reimbursement-application']).props.size).toBe('md')
  expect(button(tree, '提交申请')).toBeDefined()
  input(tree, '报销金额').props.onChange({ target: { value: '100' } }); proof(tree).props.onProofs(['proof'])
  tree = render()
  expect(input(tree, '报销金额').props.value).toBe('100'); expect(proof(tree).props.proofs).toEqual(['proof'])
  expect(button(tree, '提交申请').props.disabled).toBe(false)
  proof(tree).props.onReading(true)
  button(tree, '提交申请').props.onClick()
  expect(sendReimbursement).not.toHaveBeenCalled()
  expect(button(render(), '提交申请').props.disabled).toBe(true)
})
it('未保存申请关闭先确认，继续填写保留金额和凭证，放弃后只关申请保留记录', () => {
  setup(); button(render(), '申请报销').props.onClick()
  const application = (value: any) => nodes(value).find(node => node.type === 'dialog' && nodes(node.props.children).some(child => child.props['data-reimbursement-application']))
  const confirmation = (value: any) => nodes(value).filter(node => node.type === 'dialog' && nodes(node.props.children).some(child => child.props['data-discard-confirmation'])).at(-1)
  input(render(), '报销金额').props.onChange({ target: { value: '100' } }); proof(render()).props.onProofs(['proof'])
  application(render()).props.onOpenChange(false)
  expect(confirmation(render()).props.open).toBe(true)
  button(confirmation(render()), '继续填写').props.onClick()
  expect(application(render()).props.open).toBe(true)
  expect(input(render(), '报销金额').props.value).toBe('100')
  expect(proof(render()).props.proofs).toEqual(['proof'])
  application(render()).props.onOpenChange(false)
  button(confirmation(render()), '放弃并关闭').props.onClick()
  const tree = render()
  expect(application(tree).props.open).toBe(false)
  expect(nodes(tree).find(node => node.type === 'dialog').props.open).toBe(true)
  expect(input(tree, '报销金额').props.value).toBe('')
  expect(proof(tree).props.proofs).toEqual([])
  expect(sendReimbursement).not.toHaveBeenCalled()
})
it('结果未知保留请求和凭证，明确拒绝恢复编辑', async () => {
  setup(); vi.mocked(sendReimbursement).mockResolvedValueOnce({ status: 'unknown' }).mockResolvedValueOnce({ status: 'rejected' })
  let tree = render(); input(tree, '报销金额').props.onChange({ target: { value: '100' } }); proof(tree).props.onProofs(['proof'])
  button(render(), '提交申请').props.onClick()
  await vi.waitFor(() => expect(button(render(), '重试本次申请').props.disabled).toBe(false))
  const first = vi.mocked(sendReimbursement).mock.calls[0][1]
  tree = render(); expect(nodes(tree).find(node => node.type === 'fieldset').props.disabled).toBe(true)
  button(tree, '重试本次申请').props.onClick()
  await vi.waitFor(() => expect(button(render(), '提交申请').props.disabled).toBe(false))
  expect(vi.mocked(sendReimbursement).mock.calls[1][1]).toEqual(first)
  expect(input(render(), '报销金额').props.value).toBe('100')
})
it('老板默认全部记录；确认时冻结看到的版本和金额，通知定位读取单条', async () => {
  setup(true); vi.mocked(sendReimbursement).mockResolvedValue({ status: 'unknown' })
  let tree = await loaded(); expect(vi.mocked(fetchReimbursements).mock.calls[0][0]).toMatchObject({ applicant: '' })
  nodes(tree).find(node => node.type === 'button' && node.props['aria-expanded'] === false).props.onClick()
  tree = render(); button(tree, '确认已报销').props.onClick(); tree = render()
  expect(text(tree)).toContain('本次报销 ¥100')
  row = { ...row, version: 2, amount: 200 }
  button(tree, '确认报销').props.onClick()
  await vi.waitFor(() => expect(sendReimbursement).toHaveBeenCalled())
  expect(vi.mocked(sendReimbursement).mock.calls[0][1]).toMatchObject({ id: 'r1', expectedVersion: 1 })
})
it('通知入口按id读取，员工不能显示管理员确认入口', async () => {
  setup(); const props = { initialId: 'r1', requestKey: 4 }
  render(props); let tree = await loaded(props)
  expect(fetchReimbursements).toHaveBeenCalledWith({ id: 'r1' })
  expect(button(tree, '确认已报销')).toBeUndefined(); expect(button(tree, '撤回申请')).toBeDefined()
})
it('重提后的历史仍显示原申请金额、备注和付款账单', async () => {
  setup()
  row = { ...row, amount: 200, note: '修改后的说明', proofs: ['new-proof'], history: [{ id: 'event1', action: '提交', by: 'employee', at: '2026-10-09T02:00:00Z', note: '旧备注字段', proofs: [], submission: { category: '图纸', amount: 100, expenseDate: '2026-10-08', note: '原申请说明', proofs: ['original-proof'], orderId: null } }] }
  render({ initialId: 'r1' }); const tree = await loaded({ initialId: 'r1' })
  expect(text(tree)).toContain('图纸 · ¥100 · 付款 2026-10-08')
  const snapshot = nodes(tree).find(node => node.type === 'settlement-view' && node.props.note === '原申请说明')
  expect(snapshot.props.shots).toEqual(['original-proof'])
})
it('筛选和刷新移走原行后仍能用冻结请求重试审批', async () => {
  setup(true)
  vi.mocked(sendReimbursement).mockResolvedValueOnce({ status: 'unknown' }).mockResolvedValueOnce({ status: 'success', id: 'r1' })
  let tree = await loaded()
  nodes(tree).find(node => node.type === 'button' && node.props['aria-expanded'] === false).props.onClick()
  tree = render(); button(tree, '确认已报销').props.onClick(); tree = render()
  button(tree, '确认报销').props.onClick()
  await vi.waitFor(() => expect(button(render(), '重试本次操作')?.props.disabled).toBe(false))
  const first = vi.mocked(sendReimbursement).mock.calls[0][1]
  vi.mocked(fetchReimbursements).mockResolvedValue({ rows: [], total: 0, next: null, summary: { pendingAmount: 0, paidAmount: 100, pendingCount: 0, paidCount: 1 } })
  nodes(render()).find(node => node.type === 'select' && node.props['aria-label'] === '筛选报销状态').props.onChange({ target: { value: '待处理' } })
  render()
  await vi.waitFor(() => expect(text(render())).toContain('暂无报销记录'))
  tree = render()
  const fixed = nodes(tree).find(node => node.props.role === 'status')
  expect(text(fixed)).toContain('BX1 · ¥100')
  button(tree, '重试本次操作').props.onClick()
  await vi.waitFor(() => expect(button(render(), '重试本次操作')).toBeUndefined())
  expect(vi.mocked(sendReimbursement).mock.calls[1][1]).toEqual(first)
})
