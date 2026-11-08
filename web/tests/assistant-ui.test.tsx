import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  slots: [] as any[],
  cursor: 0,
  tab: 'ask',
  turns: [] as any[],
  aiRequest: vi.fn(),
  toastError: vi.fn(),
  session: {
    me: { id: 'boss' },
    role: { locked: true, fields: { sales: true } },
    can: () => true,
    s: { orders: [], users: [] },
    channel: () => undefined,
  },
}))

vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = initial
    return [h.slots[i], (value: any) => { h.slots[i] = typeof value === 'function' ? value(h.slots[i]) : value }]
  },
  useRef: (initial: any) => {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = { current: initial }
    return h.slots[i]
  },
  useEffect: () => {},
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session }))
vi.mock('@/client/prefs', () => ({ usePref: () => [h.tab, (value: string) => { h.tab = value }] }))
vi.mock('@/client/useConversation', () => ({ useConversation: () => [h.turns, (next: any[]) => { h.turns = next }] }))
vi.mock('@/client/AiIntake', () => ({ IntakeFlow: () => null, aiRequest: h.aiRequest }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/ui', () => ({ Avatar: 'span', ChannelAvatar: 'span', StatusPill: 'span' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('sonner', () => ({ toast: { error: h.toastError } }))

import { AssistantPage } from '@/client/AssistantPage'
import { CopyAnswerButton } from '@/client/AssistantReply'
import type { AssistantAnswer } from '@/shared/assistant'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const render = () => { h.cursor = 0; return nodes(AssistantPage()) }
const input = () => render().find(node => node.props.id === 'ai-question')
const answer: AssistantAnswer = { answer: '查询结果文字', orders: [], scopes: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

afterEach(() => {
  h.slots = []
  h.cursor = 0
  h.tab = 'ask'
  h.turns = []
  h.session.role = { locked: true, fields: { sales: true } }
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('示例只填入问题，不自动请求；无财务权限时不提供金额示例', () => {
  const examples = render().filter(node => node.props['data-assistant-example'])
  expect(examples).toHaveLength(3)
  examples[0].props.onClick()
  expect(h.aiRequest).not.toHaveBeenCalled()
  expect(input().props.value).toBe(examples[0].props['data-assistant-example'])

  h.slots = []
  h.session.role = { locked: false, fields: { sales: false } }
  expect(text(render())).not.toContain('多少款没有收')
  expect(text(render())).toContain('我有哪些订单快截止了？')
})

it('查询期间显示当前问题并允许编辑，完成时不清掉新草稿', async () => {
  const request = deferred<AssistantAnswer>()
  h.aiRequest.mockReturnValueOnce(request.promise)
  input().props.onChange({ target: { value: '第一个问题' } })
  render().find(node => node.type === 'form').props.onSubmit({ preventDefault: vi.fn() })

  await vi.waitFor(() => expect(h.aiRequest).toHaveBeenCalledWith('ask', { question: '第一个问题', history: [] }))
  expect(render().some(node => node.props['aria-label'] === '正在查询')).toBe(true)
  expect(input().props.disabled).toBeUndefined()
  input().props.onChange({ target: { value: '等待时写好的下一条草稿' } })
  request.resolve(answer)
  await vi.waitFor(() => expect(h.turns).toHaveLength(1))

  expect(input().props.value).toBe('等待时写好的下一条草稿')
  expect(render().some(node => node.props['aria-label'] === '正在查询')).toBe(false)
  expect(h.aiRequest).toHaveBeenCalledTimes(1)
})

it('失败保留问题并可重试，成功后清空已提交文本', async () => {
  h.aiRequest.mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValueOnce(answer)
  input().props.onChange({ target: { value: '需要重试的问题' } })
  render().find(node => node.type === 'form').props.onSubmit({ preventDefault: vi.fn() })

  await vi.waitFor(() => expect(text(render())).toContain('网络暂时不可用'))
  expect(input().props.value).toBe('需要重试的问题')
  const retry = render().find(node => node.type === 'button' && text(node) === '重试')
  retry.props.onClick()
  await vi.waitFor(() => expect(h.turns).toHaveLength(1))

  expect(h.aiRequest).toHaveBeenCalledTimes(2)
  expect(h.aiRequest).toHaveBeenLastCalledWith('ask', { question: '需要重试的问题', history: [] })
  expect(input().props.value).toBe('')
  expect(text(render())).not.toContain('网络暂时不可用')
})

it('回复复制写入剪贴板并给出成功反馈', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  h.cursor = 0
  const tree = CopyAnswerButton({ text: '查询结果文字' })
  const copy = nodes(tree).find(node => node.props['aria-label'] === '复制查询回复')
  copy.props.onClick()

  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('查询结果文字'))
  h.cursor = 0
  expect(nodes(CopyAnswerButton({ text: '查询结果文字' })).some(node => node.props['aria-label'] === '已复制查询回复')).toBe(true)
})

it('剪贴板不可用时提示手动复制', async () => {
  vi.stubGlobal('navigator', {})
  h.cursor = 0
  const copy = nodes(CopyAnswerButton({ text: '查询结果文字' })).find(node => node.props['aria-label'] === '复制查询回复')
  copy.props.onClick()
  await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledWith('复制失败，请选中文字后手动复制'))
})
