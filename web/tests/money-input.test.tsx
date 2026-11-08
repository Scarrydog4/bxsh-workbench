import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0 }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (value: any) => { h.slots[i] = value }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: () => {},
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { parseMoneyInput } from '@/shared/money-input'
import { PayInput } from '@/client/OrderDrawer'
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const render = (props: Parameters<typeof PayInput>[0]) => { h.cursor = 0; return nodes(PayInput(props)).find(n => n.type === 'input') }
afterEach(() => { h.slots = []; vi.clearAllMocks() })

it('金额保留零元/未定的区别，拒绝格式错误、负数及超额', () => {
  expect(['', ' ', '0', '80.50', '80.', '.50'].map(value => parseMoneyInput(value))).toEqual([null, null, 0, 80.5, 80, .5])
  for (const value of ['80..5', '-80', 'abc', 'NaN', 'Infinity', '1e3', '0.001', '10000001']) expect(parseMoneyInput(value)).toBeUndefined()
  expect(parseMoneyInput('1000001', 1_000_000)).toBeUndefined()
})

it('详情工资输入错误时不保存，修正后可保存，清空仍表示未定', async () => {
  const onSave = vi.fn().mockResolvedValue(true), props = { value: 80, nullable: true as const, label: '写手的写手工资', onSave }
  render(props).props.onChange({ target: { value: '80..5' } })
  await render(props).props.onBlur()
  expect(onSave).not.toHaveBeenCalled()
  expect(render(props).props['aria-invalid']).toBe(true)
  expect(render(props).props['data-writer-pay']).toBe('')
  render(props).props.onChange({ target: { value: '80.5' } })
  await render(props).props.onBlur()
  expect(onSave).toHaveBeenLastCalledWith(80.5, expect.any(Function))
  render(props).props.onChange({ target: { value: '' } })
  await render(props).props.onBlur()
  expect(onSave).toHaveBeenLastCalledWith(null, expect.any(Function))
})

it('详情原价清空或粘贴负数都不会静默改成零或正数', async () => {
  const onSave = vi.fn().mockResolvedValue(true), props = { value: 500, onSave }
  for (const value of ['', '-80']) {
    render(props).props.onChange({ target: { value } })
    await render(props).props.onBlur()
  }
  expect(onSave).not.toHaveBeenCalled()
})
