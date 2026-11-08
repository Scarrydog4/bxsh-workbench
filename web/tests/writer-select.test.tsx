import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, reduce: false }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (next: any) => { h.slots[i] = next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
}))
vi.mock('motion/react', () => ({ motion: { div: 'motion-div' }, useReducedMotion: () => h.reduce }))
vi.mock('@/client/ui', () => ({ Person: 'person' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
import { WriterSelect, type WriterSelectProps } from '@/client/WriterSelect'
import { toast } from 'sonner'

const people = [{ id: 'boss', name: '老板', hue: 120 }, { id: 'xiao', name: '肖森凯', hue: 80 }, { id: 'gold', name: 'goldcode', hue: 40 }]
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const render = (props: Partial<WriterSelectProps> = {}) => { h.cursor = 0; return WriterSelect({ people, selected: [], onToggle: vi.fn(), ...props }) }
const cards = (tree: any) => nodes(tree).filter(n => n.type === 'motion-div')
const button = (tree: any, id: string) => nodes(cards(tree).find(n => n.key === id)).find(n => n.type === 'button')
const event = () => ({ stopPropagation: vi.fn() })
afterEach(() => { h.slots = []; h.reduce = false; vi.clearAllMocks() })

it('已选写手靠前且按原顺序排列，工资仍跟着各自的卡片', () => {
  const renderPay = vi.fn(p => <input aria-label={`${p.name}工资`} defaultValue={p.id === 'gold' ? '120' : '80'}/> )
  const tree = render({ selected: [people[2], people[0]], renderPay })
  expect(cards(tree).map(n => n.key)).toEqual(['boss', 'gold', 'xiao'])
  expect(cards(tree).map(n => n.props.layout)).toEqual(['position', 'position', 'position'])
  expect(button(tree, 'boss').props['aria-pressed']).toBe(true)
  expect(button(tree, 'gold').props['aria-pressed']).toBe(true)
  expect(button(tree, 'xiao').props['aria-pressed']).toBe(false)
  expect(nodes(cards(tree)[1]).find(n => n.type === 'input').props.defaultValue).toBe('120')
  expect(nodes(cards(tree)[2]).some(n => n.type === 'input')).toBe(false)
  expect(renderPay.mock.calls.map(([p]) => p.id)).toEqual(['boss', 'gold'])
})

it('停用的已选写手继续靠前且可取消，减少动态效果时关闭位移动画', () => {
  h.reduce = true
  const inactive = { id: 'old', name: '停用写手', hue: 60 }, onToggle = vi.fn()
  const tree = render({ selected: [inactive], onToggle })
  expect(cards(tree).map(n => n.key)).toEqual(['old', 'boss', 'xiao', 'gold'])
  expect(cards(tree).every(n => n.props.layout === false)).toBe(true)
  button(tree, 'old').props.onClick(event())
  expect(onToggle).toHaveBeenCalledWith('old')
})

it('更新中拒绝重复点选，失败后保持原选择并允许重试', async () => {
  let reject!: (error: Error) => void
  const onToggle = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
  const props = { selected: [people[0]], onToggle }
  const tree = render(props)
  button(tree, 'gold').props.onClick(event())
  button(tree, 'xiao').props.onClick(event())
  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(nodes(render(props)).filter(n => n.type === 'button').every(n => n.props.disabled)).toBe(true)
  reject(new Error('failed'))
  await vi.waitFor(() => expect(render(props).props['aria-busy']).toBe(false))
  expect(toast.error).toHaveBeenCalledWith('更新写手失败，请重试')
  expect(button(render(props), 'boss').props['aria-pressed']).toBe(true)
  button(render(props), 'gold').props.onClick(event())
  expect(onToggle).toHaveBeenCalledTimes(2)
})
