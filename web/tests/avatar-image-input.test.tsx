import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), queue: [] as (() => void)[] }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial; return [hooks.slots[index], (next: any) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next }] },
  useRef: (current: any) => { const index = hooks.cursor++; return hooks.slots[index] ??= { current } },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++, previous = hooks.effects.get(index)
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) hooks.queue.push(() => { previous?.cleanup?.(); hooks.effects.set(index, { deps, cleanup: fn() || undefined }) })
  },
}))
vi.mock('@/components/ui/popover', () => ({ Popover: 'popover', PopoverContent: 'popover-content', PopoverTrigger: 'popover-trigger' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { AvatarButton, ImageDrop, cropAvatar } from '@/client/ui'
import { toast } from 'sonner'

type DecodingImage = { width: number; height: number; src: string; onload: () => void; onerror: () => void }
const decoding: DecodingImage[] = []
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const photo = () => new File(['picture'], 'avatar.png', { type: 'image/png' })
const event = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clipboardData: { files: [photo()], items: [] }, dataTransfer: { files: [photo()], items: [] } })
const currentImage = (tree: any) => nodes(tree).find(node => node.type === 'img' && node.props.alt === '当前头像')?.props.src
function render(props: Partial<Parameters<typeof ImageDrop>[0]> = {}) {
  hooks.cursor = 0; hooks.queue = []
  return ImageDrop({ onImage: vi.fn(), preview: 'old-avatar', ...props })
}
function effects() { for (const run of hooks.queue) run(); hooks.queue = [] }
beforeEach(() => {
  vi.stubGlobal('Image', class { width = 200; height = 100; src = ''; onload = () => {}; onerror = () => {}; constructor() { decoding.push(this) } })
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => 'new-avatar' })) })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar-test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  for (const effect of hooks.effects.values()) effect.cleanup?.()
  hooks.slots = []; hooks.cursor = 0; hooks.queue = []; hooks.effects.clear(); decoding.length = 0
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()
})

it('头像图片解码失败或画布不可用时返回失败并释放本地图片地址', async () => {
  const badImage = cropAvatar(photo()); decoding[0].onerror()
  expect(await badImage).toBeNull()
  vi.mocked(document.createElement).mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement)
  const noCanvas = cropAvatar(photo()); decoding[1].onload()
  expect(await noCanvas).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
})

it('读图失败不会保存或覆盖已有头像，失败后允许重新选图', async () => {
  const onImage = vi.fn().mockResolvedValue(undefined)
  let tree = render({ onImage }); effects()
  tree.props.onPaste(event()); decoding[0].onerror()
  await vi.waitFor(() => expect(render({ onImage }).props['aria-busy']).toBe(false))
  expect(onImage).not.toHaveBeenCalled(); expect(currentImage(render({ onImage }))).toBe('old-avatar')
  expect(toast.error).toHaveBeenCalledWith('图片无法读取，请重新选择')
  tree = render({ onImage }); tree.props.onDrop(event()); decoding[1].onload()
  await vi.waitFor(() => expect(currentImage(render({ onImage }))).toBe('new-avatar'))
  expect(onImage).toHaveBeenCalledOnce()
})

it('服务器明确拒绝或请求抛错时，头像预览仍保留原图', async () => {
  const onImage = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('offline'))
  let tree = render({ onImage }); effects()
  tree.props.onPaste(event()); decoding[0].onload()
  await vi.waitFor(() => expect(render({ onImage }).props['aria-busy']).toBe(false))
  expect(currentImage(render({ onImage }))).toBe('old-avatar')
  tree = render({ onImage }); tree.props.onPaste(event()); decoding[1].onload()
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('头像未保存，请重试'))
  expect(currentImage(render({ onImage }))).toBe('old-avatar')
})

it('粘贴与拖放截断事件冒泡，解码及保存未完成时重复事件只保存一次', async () => {
  let finish!: () => void
  const onImage = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const tree = render({ onImage }); effects()
  const pasted = event(), dropped = event()
  tree.props.onPaste(pasted); tree.props.onDrop(dropped)
  expect(decoding).toHaveLength(1)
  decoding[0].onload()
  await vi.waitFor(() => expect(onImage).toHaveBeenCalledOnce())
  tree.props.onPaste(event())
  const fileInput = nodes(tree).find(node => node.type === 'input' && node.props.type === 'file')
  fileInput.props.onChange({ target: { files: [photo()], value: 'picked' } })
  expect(decoding).toHaveLength(1)
  for (const e of [pasted, dropped]) { expect(e.preventDefault).toHaveBeenCalledOnce(); expect(e.stopPropagation).toHaveBeenCalledOnce() }
  expect(render({ onImage }).props['aria-busy']).toBe(true)
  finish()
  await vi.waitFor(() => expect(render({ onImage }).props['aria-busy']).toBe(false))
  expect(onImage).toHaveBeenCalledOnce()
})

it('打开头像输入区后聚焦可见接收区，直接粘贴不会触发文件选择器', async () => {
  const tree = render({ autoFocus: true }), focus = vi.fn()
  expect(tree.props.role).toBe('group'); expect(tree.props.tabIndex).toBe(0)
  tree.props.ref.current = { focus }; effects()
  expect(focus).toHaveBeenCalledOnce()
  const pick = nodes(tree).find(node => node.type === 'input' && node.props.type === 'file'), click = vi.fn()
  pick.props.ref.current = { click }
  tree.props.onPaste(event())
  expect(click).not.toHaveBeenCalled()
  decoding[0].onerror()
  await vi.waitFor(() => expect(render({ autoFocus: true }).props['aria-busy']).toBe(false))
})

it('表格头像按钮粘贴不冒泡至行点击，读图失败不调用保存', async () => {
  const onPick = vi.fn(), tree = AvatarButton({ onPick, label: '给渠道换头像', children: '原头像' })
  const button = nodes(tree).find(node => node.type === 'button'), paste = event(), click = { stopPropagation: vi.fn() }
  button.props.onClick(click); button.props.onPaste(paste)
  expect(click.stopPropagation).toHaveBeenCalledOnce(); expect(paste.stopPropagation).toHaveBeenCalledOnce()
  decoding[0].onerror()
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('图片无法读取，请重新选择'))
  expect(onPick).not.toHaveBeenCalled()
})

it('点击头像白区后直接粘贴，一次图片只保存一次且不调用剪贴板读取接口', async () => {
  const onImage = vi.fn().mockResolvedValue(true), focus = vi.fn(), pickerClick = vi.fn(), read = vi.fn()
  vi.stubGlobal('navigator', { clipboard: { read } })
  const tree = render({ onImage }), target = { closest: vi.fn(() => null) }
  tree.props.ref.current = { focus }
  const pick = nodes(tree).find(node => node.type === 'input' && node.props.type === 'file')
  pick.props.ref.current = { click: pickerClick }
  effects()
  tree.props.onClick({ target, currentTarget: { focus }, stopPropagation: vi.fn() })
  expect(focus).toHaveBeenCalledOnce(); expect(pickerClick).not.toHaveBeenCalled()
  expect(tree.props['aria-keyshortcuts']).toBe('Meta+V Control+V')
  const file = photo(), paste = { ...event(), clipboardData: { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } }
  tree.props.onPaste(paste)
  expect(decoding).toHaveLength(1)
  decoding[0].onload()
  await vi.waitFor(() => expect(onImage).toHaveBeenCalledExactlyOnceWith('new-avatar'))
  expect(read).not.toHaveBeenCalled(); expect(pickerClick).not.toHaveBeenCalled()
  expect(paste.preventDefault).toHaveBeenCalledOnce(); expect(paste.stopPropagation).toHaveBeenCalledOnce()
})

it('点击头像弹层外围白区也聚焦图片接收区，表格行不会收到点击', () => {
  const tree = AvatarButton({ onPick: vi.fn(), label: '给渠道换头像', children: '原头像' })
  const content = nodes(tree).find(node => node.type === 'popover-content')
  const focus = vi.fn(), querySelector = vi.fn(() => ({ focus })), stopPropagation = vi.fn()
  content.props.onClick({ target: { closest: () => null }, currentTarget: { querySelector }, stopPropagation })
  expect(querySelector).toHaveBeenCalledWith('[data-avatar-input]')
  expect(focus).toHaveBeenCalledOnce(); expect(stopPropagation).toHaveBeenCalledOnce()
})

it('没有头像修改权限时只显示原头像，不提供粘贴拖放或选择入口', () => {
  const onPick = vi.fn(), tree = AvatarButton({ onPick, disabled: true, label: '给渠道换头像', children: '原头像' })
  expect(nodes(tree).some(node => node.type === 'button' || node.type === 'popover-content' || node.props.onPaste || node.props.onDrop)).toBe(false)
  expect(onPick).not.toHaveBeenCalled()
})
