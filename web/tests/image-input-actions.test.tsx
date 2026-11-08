import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], effects: new Map<number, { deps: any[]; cleanup?: () => void }>(), queue: [] as (() => void)[], cursor: 0 }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => void | (() => void), deps: any[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((v, j) => v !== old.deps[j])) { h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) } },
}))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/image-input', async () => ({ ...await vi.importActual('@/client/image-input'), readClipboardImages: vi.fn() }))
vi.mock('@/client/ui', () => ({ inputCls: '' }))
vi.mock('@/client/files', () => ({ thumb: vi.fn(), hasFiles: (e: any) => !!e.dataTransfer?.files?.length || !!e.dataTransfer?.items?.some((x: any) => x.kind === 'file') }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
import { ImageInputActions, type ImageInputActionsProps } from '@/client/ImageInputActions'
import { SettlementNote } from '@/client/SettlementNote'
import { IMAGE_INPUT_EMPTY_MESSAGE, readClipboardImages } from '@/client/image-input'
import { thumb } from '@/client/files'
const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []
const button = (tree: any, label: string) => nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === label)
const image = () => new File(['picture'], 'shot.png', { type: 'image/png' })
const transfer = (file?: File) => ({ files: [], items: file ? [{ kind: 'file', type: file.type, getAsFile: () => file }] : [] })
const event = (data: any) => ({ clipboardData: data, dataTransfer: data, preventDefault: vi.fn(), stopPropagation: vi.fn() })
function render(props: ImageInputActionsProps) { h.cursor = 0; h.queue = []; return ImageInputActions(props) }
function effects() { h.queue.splice(0).forEach(fn => fn()) }
afterEach(() => { for (const effect of h.effects.values()) effect.cleanup?.(); h.slots = []; h.effects.clear(); h.queue = []; vi.resetAllMocks(); vi.unstubAllGlobals() })

it('安卓相册文件读成独立图片后才清空input，读取期间锁定并保留源引用', async () => {
  vi.stubGlobal('navigator', { userAgent: 'Android BxshAndroid/0.1.6' })
  const file = image(), onFiles = vi.fn(), props = { onFiles, pickerOnly: true }
  let finish!: (bytes: ArrayBuffer) => void
  vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const target = { files: [file], value: 'native-uri' }
  const pending = nodes(render(props)).find(n => n.type === 'input').props.onChange({ target })
  expect(target.value).toBe('native-uri')
  expect(button(render(props), '选图片').props.disabled).toBe(true)
  expect(onFiles).not.toHaveBeenCalled()
  finish(new TextEncoder().encode('picture').buffer)
  await pending
  expect(target.value).toBe('')
  expect(onFiles).toHaveBeenCalledOnce()
  const copied = onFiles.mock.calls[0][0][0]
  expect(copied).not.toBe(file)
  expect(await copied.text()).toBe('picture')
})

it('安卓文件读取失败停留在添加入口且能重选，不发起带失效引用的上传', async () => {
  vi.stubGlobal('navigator', { userAgent: 'Android BxshAndroid/0.1.6' })
  const file = image(), onFiles = vi.fn(), props = { onFiles, pickerOnly: true }
  vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new DOMException('temporary file gone', 'NotReadableError'))
  const target = { files: [file], value: 'native-uri' }
  await nodes(render(props)).find(n => n.type === 'input').props.onChange({ target })
  expect(target.value).toBe('')
  expect(onFiles).not.toHaveBeenCalled()
  expect(button(render(props), '选图片').props.disabled).toBe(false)
  expect(nodes(render(props)).find(n => n.props.role === 'status').props.children).toBe('图片添加失败，请重新选择')
})

it('简洁入口只有上传图标，不触发剪贴板权限，选图期间继续锁定', async () => {
  let finish!: () => void
  const onFiles = vi.fn(() => new Promise<void>(resolve => { finish = resolve })), onReading = vi.fn()
  const props = { onFiles, onReading, pickerOnly: true, pickLabel: '上传截图' }
  const tree = render(props), buttons = nodes(tree).filter(n => n.type === 'button')
  expect(buttons).toHaveLength(1)
  expect(button(tree, '粘贴图片')).toBeUndefined()
  const input = nodes(tree).find(n => n.type === 'input')
  input.props.onChange({ target: { files: [image()], value: 'picked' } })
  expect(button(render(props), '上传截图').props.disabled).toBe(true)
  expect(onReading).toHaveBeenLastCalledWith(true)
  expect(readClipboardImages).not.toHaveBeenCalled()
  finish()
  await vi.waitFor(() => expect(button(render(props), '上传截图').props.disabled).toBe(false))
  expect(onReading).toHaveBeenLastCalledWith(false)
})

it('显式文件按钮打开选择框，单图模式仅取第一张，附件模式保留文档', async () => {
  const onFiles = vi.fn(), files = [image(), image()]
  let tree = render({ onFiles, multiple: false }); const input = nodes(tree).find(n => n.type === 'input'), click = vi.fn()
  input.props.ref.current = { click }
  button(tree, '选图片').props.onClick({ stopPropagation: vi.fn() }); expect(click).toHaveBeenCalledOnce()
  input.props.onChange({ target: { files, value: 'picked' } })
  await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([files[0]]))
  const pdf = new File(['document'], 'bill.pdf', { type: 'application/pdf' })
  tree = render({ onFiles, accept: '*', pickLabel: '上传文件' })
  expect(button(tree, '上传文件')).toBeDefined()
  nodes(tree).find(n => n.type === 'input').props.onChange({ target: { files: [pdf], value: 'picked' } })
  await vi.waitFor(() => expect(onFiles).toHaveBeenLastCalledWith([pdf]))
})
it('剪贴板读取全程锁定，父级禁用后仍完成当前图片，连续点击不重复添加', async () => {
  let finish!: (files: File[]) => void
  vi.mocked(readClipboardImages).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const onFiles = vi.fn(), onReading = vi.fn(), file = image(), props = { onFiles, onReading }
  const tree = render(props), paste = button(tree, '粘贴图片')
  paste.props.onClick({ stopPropagation: vi.fn() }); paste.props.onClick({ stopPropagation: vi.fn() })
  expect(readClipboardImages).toHaveBeenCalledOnce(); expect(onReading).toHaveBeenCalledWith(true)
  expect(button(render({ ...props, disabled: true }), '粘贴图片').props.disabled).toBe(true)
  finish([file]); await vi.waitFor(() => expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]))
  expect(onReading).toHaveBeenLastCalledWith(false)
})
it('剪贴板权限失败显示并聚焦可见粘贴区，items 图片只接收一次', async () => {
  vi.mocked(readClipboardImages).mockRejectedValue(new Error('请按 ⌘V 粘贴，或选图片'))
  const onFiles = vi.fn(), props = { onFiles }
  button(render(props), '粘贴图片').props.onClick({ stopPropagation: vi.fn() })
  await vi.waitFor(() => expect(nodes(render(props)).some(n => n.props.role === 'status')).toBe(true))
  const tree = render(props), fallback = nodes(tree).find(n => n.props['aria-label'] === '粘贴图片区域'), focus = vi.fn()
  fallback.props.ref.current = { focus }; effects()
  // The pending effect belongs to the render that first observed the hint.
  if (!focus.mock.calls.length) { h.effects.clear(); render(props); effects() }
  expect(focus).toHaveBeenCalledOnce(); expect(fallback.props.tabIndex).toBe(0)
  const file = image(), paste = event(transfer(file))
  fallback.props.onPaste(paste)
  await vi.waitFor(() => expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]))
  expect(paste.preventDefault).toHaveBeenCalled(); expect(paste.stopPropagation).toHaveBeenCalled()
})
it('空格式和添加失败都有反馈，失败后可继续选择', async () => {
  vi.mocked(readClipboardImages).mockRejectedValue(new Error('剪贴板未提供图片'))
  const onFiles = vi.fn().mockRejectedValueOnce(new Error('failed')), props = { onFiles }
  button(render(props), '粘贴图片').props.onClick({ stopPropagation: vi.fn() })
  await vi.waitFor(() => expect(nodes(render(props)).some(n => n.props.role === 'status')).toBe(true))
  let fallback = nodes(render(props)).find(n => n.props['aria-label'] === '粘贴图片区域')
  fallback.props.onPaste(event(transfer()))
  expect(nodes(render(props)).find(n => n.props.role === 'status').props.children).toBe(IMAGE_INPUT_EMPTY_MESSAGE)
  fallback.props.onDrop(event(transfer(image())))
  await vi.waitFor(() => expect(nodes(render(props)).find(n => n.props.role === 'status').props.children).toBe('图片添加失败，请重新选择'))
  expect(button(render(props), '选图片').props.disabled).toBe(false)
})
it.each(['png', 'tiff'])('备注从 items 接收 %s 且保留文字，读取期间不重复处理；普通文字粘贴保持原行为', async format => {
  const file = new File(['picture'], `shot.${format}`, { type: `image/${format}` }), onShots = vi.fn(), onReading = vi.fn()
  let finish!: (url: string) => void
  vi.mocked(thumb).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const renderNote = () => { h.cursor = 0; return SettlementNote({ note: '原备注', shots: ['old'], onNote: vi.fn(), onShots, onReading }) }
  const tree = renderNote(), paste = event(transfer(file))
  tree.props.onPaste(paste); tree.props.onPaste(paste)
  nodes(tree).find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [file], value: 'photo' } })
  expect(thumb).toHaveBeenCalledOnce(); expect(paste.stopPropagation).toHaveBeenCalled()
  expect(nodes(renderNote()).find(n => n.type === 'textarea').props.value).toBe('原备注')
  finish('data:image/png;base64,new'); await vi.waitFor(() => expect(onShots).toHaveBeenCalledWith(['old', 'data:image/png;base64,new']))
  expect(onReading).toHaveBeenLastCalledWith(false)
  const textPaste = event(transfer()); renderNote().props.onPaste(textPaste)
  expect(textPaste.preventDefault).not.toHaveBeenCalled()
})

it('聚焦备注区收到真实图片后清除旧提示，保留原粘贴处理，不监听页面其它位置', async () => {
  vi.mocked(readClipboardImages).mockRejectedValue(new Error('没有图片'))
  const listeners = new Map<string, (event: any) => void>()
  const target = { focus: vi.fn(), addEventListener: vi.fn((type, fn) => listeners.set(type, fn)), removeEventListener: vi.fn((type) => listeners.delete(type)) }
  const props = { onFiles: vi.fn(), pasteTargetRef: { current: target as any } }
  button(render(props), '粘贴图片').props.onClick({ stopPropagation: vi.fn() })
  await vi.waitFor(() => expect(nodes(render(props)).some(n => n.props.role === 'status')).toBe(true))
  render(props); effects(); expect(target.focus).toHaveBeenCalled()
  listeners.get('paste')!(event(transfer()))
  expect(nodes(render(props)).some(n => n.props.role === 'status')).toBe(true)
  const paste = event(transfer(image())); listeners.get('paste')!(paste)
  render(props); effects()
  expect(nodes(render(props)).some(n => n.props.role === 'status')).toBe(false)
  expect(paste.preventDefault).not.toHaveBeenCalled(); expect(paste.stopPropagation).not.toHaveBeenCalled(); expect(props.onFiles).not.toHaveBeenCalled()
  expect(target.removeEventListener).toHaveBeenCalled(); expect(listeners.size).toBe(0)
})
