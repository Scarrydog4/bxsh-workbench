import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  active: '',
  banks: new Map<string, { slots: any[]; cursor: number; effects: Map<number, { deps: unknown[]; cleanup?: () => void }>; queue: (() => void)[] }>(),
}))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => {
    const bank = hooks.banks.get(hooks.active)!, index = bank.cursor++
    if (!(index in bank.slots)) bank.slots[index] = typeof initial === 'function' ? initial() : initial
    return [bank.slots[index], (next: any) => { bank.slots[index] = typeof next === 'function' ? next(bank.slots[index]) : next }]
  },
  useRef: (current: any) => { const bank = hooks.banks.get(hooks.active)!, index = bank.cursor++; return bank.slots[index] ??= { current } },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const bank = hooks.banks.get(hooks.active)!, index = bank.cursor++, previous = bank.effects.get(index)
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) bank.queue.push(() => { previous?.cleanup?.(); bank.effects.set(index, { deps, cleanup: fn() || undefined }) })
  },
}))
vi.mock('@/components/ui/popover', () => ({ Popover: 'popover', PopoverContent: 'popover-content', PopoverTrigger: 'popover-trigger' }))
vi.mock('@/client/CopyOrderName', () => ({ CopyOrderName: 'copy-order-name' }))
vi.mock('@/client/ImageInputActions', () => ({ ImageInputActions: 'image-input-actions' }))
vi.mock('@/client/ImageViewer', () => ({ isImageName: () => true, thumbnailSource: (id: string) => id }))
vi.mock('@/client/store', () => ({
  useSession: () => ({ order: (id: string) => ({ title: `AJ20261026-${id}`, attachments: [], afterSales: [{ id: `as-${id}`, files: [] }] }) }),
  refreshOrders: vi.fn(), uploadDeliveryShot: vi.fn(), markDraft: vi.fn(), finishAfterSale: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }))

import { DeliveryForm } from '@/client/DeliverButton'
import { uploadDeliveryShot, finishAfterSale } from '@/client/store'
import { IMAGE_INPUT_EMPTY_MESSAGE } from '@/client/image-input'
import { toast } from 'sonner'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const panel = (tree: any) => nodes(tree).find(node => node.type === 'popover-content')
const receiver = (tree: any) => nodes(tree).find(node => node.type === 'textarea')
const previews = (tree: any) => nodes(tree).filter(node => node.type === 'img')
const transfer = () => {
  const file = new File(['picture'], 'shot.png', { type: 'image/png' })
  return { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }], dropEffect: 'none' }
}
const event = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() })
function render(id = 'one') {
  if (!hooks.banks.has(id)) hooks.banks.set(id, { slots: [], cursor: 0, effects: new Map(), queue: [] })
  hooks.active = id
  const bank = hooks.banks.get(id)!; bank.cursor = 0; bank.queue = []
  const tree = DeliveryForm({ kind: 'aftersale', orderId: id, asId: `as-${id}`, no: `DD-${id}` })
  for (const run of bank.queue) run()
  bank.queue = []
  return tree
}
function open(id = 'one') { render(id).props.onOpenChange(true); return render(id) }

beforeEach(() => {
  let sequence = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:delivery-${++sequence}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('navigator', { clipboard: { read: vi.fn() } })
})
afterEach(() => {
  for (const bank of hooks.banks.values()) for (const effect of bank.effects.values()) effect.cleanup?.()
  hooks.banks.clear(); hooks.active = ''
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()
})

it('拖到交付面板外围也加入本次截图，截断向父卡片附件入口的冒泡', () => {
  const tree = open(), content = panel(tree), focus = vi.fn(), dataTransfer = transfer()
  receiver(tree).props.ref.current = { focus }
  const drag = { ...event(), dataTransfer }, drop = { ...event(), dataTransfer }
  content.props.onDragOver(drag)
  expect(dataTransfer.dropEffect).toBe('copy')
  content.props.onDrop(drop)
  for (const e of [drag, drop]) { expect(e.preventDefault).toHaveBeenCalledOnce(); expect(e.stopPropagation).toHaveBeenCalledOnce() }
  expect(previews(render())).toHaveLength(1)
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(uploadDeliveryShot).not.toHaveBeenCalled(); expect(finishAfterSale).not.toHaveBeenCalled()
})

it('原生粘贴接收器可编辑，粘贴后收起再打开仍保留同一张截图', () => {
  let tree = open()
  const target = { focus: vi.fn() }; receiver(tree).props.ref.current = target
  expect(receiver(tree).props.readOnly).not.toBe(true)
  expect(receiver(tree).props.disabled).toBe(false)
  expect(receiver(tree).props['aria-keyshortcuts']).toBe('Meta+V Control+V')
  const paste = { ...event(), target, clipboardData: transfer() }
  panel(tree).props.onPaste(paste)
  tree = render(); const src = previews(tree)[0].props.src
  nodes(tree).find(node => node.props.children === '收起').props.onClick()
  expect(render().props.open).toBe(false)
  tree = open()
  expect(previews(tree).map(node => node.props.src)).toEqual([src])
  expect(paste.preventDefault).toHaveBeenCalledOnce(); expect(paste.stopPropagation).toHaveBeenCalledOnce()
  expect(URL.createObjectURL).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  expect(navigator.clipboard.read).not.toHaveBeenCalled()
})

it('同时打开两个交付面板时仅事件所在面板收图，不安装全局粘贴监听', () => {
  const first = open('first'), second = open('second')
  const firstTarget = { focus: vi.fn() }, secondTarget = { focus: vi.fn() }
  receiver(first).props.ref.current = firstTarget; receiver(second).props.ref.current = secondTarget
  panel(first).props.onPaste({ ...event(), target: firstTarget, clipboardData: transfer() })
  expect(previews(render('first'))).toHaveLength(1)
  expect(previews(render('second'))).toHaveLength(0)
  expect(document.addEventListener).not.toHaveBeenCalled()
  expect(navigator.clipboard.read).not.toHaveBeenCalled()
})

it('名称选择和复制控件不被白区聚焦打断，空白区点击仍聚焦截图接收器', () => {
  const tree = open(), focus = vi.fn(), content = panel(tree)
  receiver(tree).props.ref.current = { focus }
  for (const protectedSelector of ['[data-order-name]', 'button', 'input', 'textarea']) {
    content.props.onClick({ ...event(), target: { closest: (selector: string) => selector.includes(protectedSelector) ? {} : null } })
  }
  expect(focus).not.toHaveBeenCalled()
  const click = { ...event(), target: { closest: () => null } }
  content.props.onClick(click)
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
  expect(click.stopPropagation).toHaveBeenCalledOnce()
  expect(nodes(tree).find(node => node.type === 'copy-order-name').props.title).toBe('AJ20261026-one')
})

it('不接管其他输入框的文字粘贴，截图区收到非图片时给出反馈', () => {
  const tree = open(), target = { focus: vi.fn() }; receiver(tree).props.ref.current = target
  const outside = { ...event(), target: {}, clipboardData: { files: [], items: [] } }
  panel(tree).props.onPaste(outside)
  expect(outside.preventDefault).not.toHaveBeenCalled(); expect(outside.stopPropagation).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled()
  const inside = { ...event(), target, clipboardData: { files: [], items: [] } }
  panel(tree).props.onPaste(inside)
  expect(inside.preventDefault).toHaveBeenCalledOnce(); expect(inside.stopPropagation).toHaveBeenCalledOnce()
  expect(toast).toHaveBeenCalledWith(IMAGE_INPUT_EMPTY_MESSAGE)
  expect(previews(render())).toHaveLength(0)
})
