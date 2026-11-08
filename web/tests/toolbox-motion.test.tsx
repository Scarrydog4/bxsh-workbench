import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: new Map<number, { deps: any[]; cleanup?: () => void }>(), queue: [] as (() => void)[] }))
vi.mock('react', async () => ({ ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useCallback: (callback: unknown) => callback,
  useEffect: (fn: () => void | (() => void), deps: any[]) => { const i = h.cursor++; if (!h.effects.has(i)) h.queue.push(() => h.effects.set(i, { deps, cleanup: fn() || undefined })) },
}))
vi.mock('@/client/ui', () => ({ PageHeader: 'header', Empty: 'empty', Combobox: 'combobox', inputCls: '' }))
vi.mock('@/client/SelectField', () => ({ SelectField: 'select' }))
vi.mock('@/components/ui/disclosure', () => ({ Disclosure: 'disclosure' }))
vi.mock('@/components/ui/sliding-segments', () => ({ SlidingSegments: 'segments' }))
vi.mock('@/client/store', () => ({ useSession: () => ({ views: [], me: { id: 'qa-writer' }, can: () => true }) }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/PointsDialog', () => ({ PointsDialog: 'points-dialog' }))
vi.mock('@/client/PageLoading', () => ({ LoadingList: 'loading-list' }))
vi.mock('@/client/files', () => ({ fileSize: (size: number) => `${size} B` }))
vi.mock('@/client/word-stats', () => ({ wordStats: async () => ({ total: 2, chinese: 2, english: 0, paragraphs: 1 }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ToolboxPage } from '@/client/ToolboxPage'
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : node?.props ? text(node.props.children) : ''
const render = () => { h.cursor = 0; h.queue = []; const tree = ToolboxPage({ seed: null, clearSeed: vi.fn() }); h.queue.forEach(effect => effect()); return tree }
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null })
  vi.stubGlobal('document', { hidden: false })
  vi.stubGlobal('setInterval', vi.fn(() => 0)); vi.stubGlobal('clearInterval', vi.fn())
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/platforms')
    ? { platforms: ['降重', '降AI', '双降'].map((service, index) => ({ id: String(index), name: '测试平台', platform: '测试平台', modeName: '标准', service, languages: ['CN'] })), error: null, configured: true }
    : { jobs: [], points: { available: 100, price: { points: 1 } } })))
})
afterEach(() => { h.effects.forEach(effect => effect.cleanup?.()); h.effects.clear(); h.slots = []; h.queue = []; vi.unstubAllGlobals(); vi.clearAllMocks() })

it('切换降重、降AI、双降保留稿件和保留词句，只重选平台且不提交扣费', async () => {
  render(); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  let tree = render()
  nodes(tree).find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [new File(['测试内容'], 'QA-本地稿件.docx')], value: '' } })
  nodes(tree).find(node => node.props.id === 'rewrite-whitelist').props.onChange({ target: { value: '专用术语不得改写' } })
  await vi.waitFor(() => expect(text(render())).toContain('QA-本地稿件.docx'))
  for (const service of ['降重', '双降', '降AI']) {
    tree = render()
    nodes(tree).find(node => node.type === 'segments').props.onValueChange(service)
    tree = render()
    expect(nodes(tree).find(node => node.type === 'segments').props.value).toBe(service)
    expect(text(tree)).toContain('QA-本地稿件.docx')
    expect(nodes(tree).find(node => node.props.id === 'rewrite-whitelist').props.value).toBe('专用术语不得改写')
    expect(nodes(tree).find(node => node.props.id === 'rewrite-platform').props.value).toBe('')
  }
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})

it('处理记录首次等待显示骨架，失败后可重试，只有成功返回空数组才显示空状态', async () => {
  let respond!: (response: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { respond = resolve }))
  let tree = render()
  expect(nodes(tree).some(node => node.type === 'loading-list')).toBe(true)
  expect(nodes(tree).some(node => node.type === 'empty')).toBe(false)
  respond(Response.json({ error: '读取处理记录失败' }, { status: 503 }))
  await vi.waitFor(() => expect(text(render())).toContain('读取处理记录失败'))
  tree = render()
  expect(nodes(tree).some(node => node.type === 'empty')).toBe(false)
  nodes(tree).find(node => node.props.onClick && text(node) === '重试').props.onClick()
  expect(nodes(render()).some(node => node.type === 'loading-list')).toBe(true)
  await vi.waitFor(() => expect(nodes(render()).some(node => node.type === 'empty' && node.props.title === '还没有处理记录')).toBe(true))
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})
