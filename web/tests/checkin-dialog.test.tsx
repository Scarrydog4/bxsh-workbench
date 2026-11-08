import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], effects: new Map<number, { deps: any[]; cleanup?: () => void }>(), queue: [] as (() => void)[], cursor: 0, session: {} as any }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => void | (() => void), deps: any[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((v, j) => v !== old.deps[j])) h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogDescription: 'description', DialogTitle: 'title' }))
vi.mock('@/components/ui/app-dialog', () => ({ AppDialogContent: 'content', AppDialogBody: 'body' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/calendar', () => ({ Calendar: 'calendar', fromDay: (date: Date) => date.toISOString().slice(0, 10), toDay: (date: string) => new Date(`${date}T00:00:00Z`) }))
vi.mock('@/client/CheckinCamera', () => ({ CheckinCamera: 'camera' }))
vi.mock('@/client/CheckinRequests', () => ({ CheckinRequests: 'requests' }))
vi.mock('@/client/ImageViewer', () => ({ Thumbs: 'thumbs' }))
vi.mock('@/client/controls', () => ({ Segmented: 'segmented' }))
vi.mock('@/client/ui', () => ({ Avatar: 'avatar' }))
vi.mock('@/client/table-kit', () => ({ DataTable: 'table' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

import { CheckinDialog } from '@/client/CheckinDialog'
const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : n?.props ? text(n.props.children) : ''
const button = (tree: any, label: string) => nodes(tree).find(n => n.type === 'button' && text(n) === label)
const change = vi.fn()
function render(open = true) {
  h.cursor = 0; h.queue = []
  const tree = CheckinDialog({ open, onOpenChange: change })
  h.queue.forEach(run => run())
  return tree
}
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }
const sample = () => ({ today: '2026-11-03', rows: [], todayRecord: { id: 'qa', day: '2026-11-03', clockInAt: '2026-11-03T02:00:00Z', clockInPhoto: '/qa.webp', name: '测试', userId: 'qa', isWorkday: true, clockOutAt: null, breakStartAt: null, breakEndAt: null, breakMinutes: null, breakOvertimeMinutes: 0, late: false, earlyLeave: false } })

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T04:00:00Z'))
  h.session = { me: { id: 'qa', name: '测试' }, role: { locked: false } }
  vi.stubGlobal('window', { setInterval, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(sample())))
  change.mockClear()
})
afterEach(() => {
  h.effects.forEach(effect => effect.cleanup?.()); h.effects.clear(); h.slots = []; h.queue = []
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('slow reads stay dismissible and a response after closing cannot replace the next read', async () => {
  let first!: (value: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
  const tree = render(); tree.props.onOpenChange(false)
  expect(change).toHaveBeenCalledWith(false)
  render(false); render(); await flush()
  first(Response.json({ ...sample(), todayRecord: null })); await flush()
  expect(button(render(), '开始午休')).toBeDefined()
})

it('a stalled check-in submission times out, releases the close guard and keeps the result uncertain', async () => {
  render(); await flush()
  vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  button(render(), '开始午休').props.onClick()
  render().props.onOpenChange(false)
  expect(change).not.toHaveBeenCalled()
  expect(text(render())).toContain('正在提交打卡')
  await vi.advanceTimersByTimeAsync(20_000)
  const tree = render(); tree.props.onOpenChange(false)
  expect(change).toHaveBeenCalledWith(false)
  expect(text(tree)).toContain('提交结果暂未确认')
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

it('team empty state is a centered padded panel, not a bare string', async () => {
  h.session.role.locked = true
  render(); await flush()
  const table = nodes(render()).find(n => n.type === 'table')
  expect(text(table.props.empty)).toBe('今天还没有人打卡')
  expect(table.props.empty.props.className).toContain('justify-center')
  expect(table.props.empty.props.className).toContain('px-6')
})
