import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, session: {} as any, readers: [] as any[] }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: () => {}, useMemo: (fn: () => unknown) => fn(),
}))
vi.mock('motion/react', async () => ({ ...await vi.importActual('motion/react'), useReducedMotion: () => false }))
vi.mock('@/client/store', () => ({ useSession: () => h.session, createOrder: vi.fn(), uploadFiles: vi.fn(), addPayment: vi.fn(), salesPeople: () => [], createChannel: vi.fn() }))
vi.mock('@/client/store-p2', () => ({ addComment: vi.fn(), fetchComments: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/prefs', () => ({ usePref: () => [true, vi.fn()] }))
vi.mock('@/client/files', () => ({ thumb: vi.fn() }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/ImageInputActions', () => ({ ImageInputActions: 'image-actions' }))
vi.mock('@/client/ui', () => ({ Avatar: 'avatar', ChannelAvatar: 'channel-avatar', Combobox: 'combo', Field: 'field', Empty: 'empty', Money: 'money', SkeletonRows: 'skeleton', inputCls: '' }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
import { QuickEntry } from '@/client/QuickEntry'
import { CommentsTab } from '@/client/OrderTabs'
import { addComment, fetchComments } from '@/client/store-p2'
import { createOrder } from '@/client/store'
import { thumb } from '@/client/files'
import { toast } from 'sonner'
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : node?.props ? text(node.props.children) : ''
const button = (tree: any, label: string) => nodes(tree).find(node => node.type === 'button' && text(node).trim().startsWith(label))
function setup() {
  h.session = { s: { users: [], channels: [], types: [] }, me: { id: 'boss' }, can: () => false, role: { locked: true }, adminIds: new Set(), views: [], user: () => null }
  vi.mocked(fetchComments).mockResolvedValue([])
  vi.mocked(addComment).mockResolvedValue({ mentions: [] } as any)
}
const renderComment = () => { h.cursor = 0; return CommentsTab({ v: { id: 'o1' } as any }) }
const renderEntry = () => { h.cursor = 0; return QuickEntry({ open: true, onOpenChange: vi.fn() }) }
const image = () => new File(['image'], 'shot.png', { type: 'image/png' })
const transfer = (file: File) => ({ files: [], items: [{ kind: 'file', type: file.type, getAsFile: () => file }], getData: () => '' })
const event = (data: any) => ({ clipboardData: data, dataTransfer: data, preventDefault: vi.fn(), stopPropagation: vi.fn() })
const zone = (tree: any) => nodes(tree).find(node => node.props.onDrop)
afterEach(() => { h.slots = []; h.readers = []; vi.resetAllMocks(); vi.unstubAllGlobals() })
it('评论从 items 接图，读取期间快捷发送不丢图，完成后带图发送', async () => {
  setup(); let finish!: (value: string) => void
  vi.mocked(thumb).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  let tree = renderComment()
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: '修改意见', selectionStart: 4 } })
  tree = renderComment(); const paste = event(transfer(image()))
  zone(tree).props.onPaste(paste)
  expect(paste.stopPropagation).toHaveBeenCalled()
  await button(tree, '发送').props.onClick()
  expect(addComment).not.toHaveBeenCalled()
  expect(button(renderComment(), '发送').props.disabled).toBe(true)
  finish('data:image/png;base64,picture')
  await vi.waitFor(() => expect(button(renderComment(), '发送').props.disabled).toBe(false))
  await button(renderComment(), '发送').props.onClick()
  expect(addComment).toHaveBeenCalledWith('o1', '修改意见', ['data:image/png;base64,picture'], [])
})
it('评论拖图阻止父级订单附件接收；失败保留文字并可重试', async () => {
  setup(); vi.mocked(thumb).mockResolvedValueOnce(undefined).mockResolvedValueOnce('data:image/png;base64,ok')
  let tree = renderComment()
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: '保留意见', selectionStart: 4 } })
  const drop = event(transfer(image())); zone(renderComment()).props.onDrop(drop)
  expect(drop.preventDefault).toHaveBeenCalled(); expect(drop.stopPropagation).toHaveBeenCalled()
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
  expect(nodes(renderComment()).find(node => node.type === 'textarea').props.value).toBe('保留意见')
  await nodes(renderComment()).find(node => node.type === 'image-actions').props.onFiles([image()])
  await button(renderComment(), '发送').props.onClick()
  expect(addComment).toHaveBeenCalledWith('o1', '保留意见', ['data:image/png;base64,ok'], [])
})
it('评论普通文本粘贴不被拦截', () => {
  setup(); const paste = event({ files: [], items: [], getData: () => '普通文字' })
  zone(renderComment()).props.onPaste(paste)
  expect(paste.preventDefault).not.toHaveBeenCalled(); expect(thumb).not.toHaveBeenCalled()
})
it('录单从 items 粘图或拖图，未读完无法保存，失败解锁且保留已有图', async () => {
  setup()
  vi.stubGlobal('FileReader', class { result = ''; onload?: () => void; onerror?: () => void; readAsDataURL() { h.readers.push(this) } })
  renderEntry()
  h.slots[0] = { ...h.slots[0], title: '测试订单', channelId: 'channel', basePrice: '100' }
  const tree = renderEntry(); const paste = event(transfer(image()))
  zone(tree).props.onPaste(paste)
  await button(tree, '保存').props.onClick()
  expect(createOrder).not.toHaveBeenCalled(); expect(button(renderEntry(), '保存').props.disabled).toBe(true)
  h.readers[0].result = 'data:image/png;base64,first'; h.readers[0].onload()
  await vi.waitFor(() => expect(button(renderEntry(), '保存').props.disabled).toBe(false))
  const drop = event(transfer(image())); zone(renderEntry()).props.onDrop(drop)
  expect(drop.stopPropagation).toHaveBeenCalled()
  h.readers[1].onerror()
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
  expect(button(renderEntry(), '保存').props.disabled).toBe(false)
  expect(nodes(renderEntry()).find(node => node.props.pics).props.pics).toEqual([{ src: 'data:image/png;base64,first', name: '录单截图1' }])
})
it('录单备注允许图片交给弹窗接收，普通长文本不触发识别', () => {
  setup(); vi.stubGlobal('FileReader', class { readAsDataURL() {} }); const source = zone(renderEntry())
  const pasteImage = event(transfer(image())); source.props.onPaste(pasteImage)
  expect(pasteImage.stopPropagation).toHaveBeenCalled()
  const pasteText = event({ files: [], items: [], getData: () => '订单原文\n客户金额200\n这里保留备注，不自动覆盖字段' }); source.props.onPaste(pasteText)
  expect(pasteText.preventDefault).not.toHaveBeenCalled(); expect(pasteText.stopPropagation).not.toHaveBeenCalled()
})
it.each(['评论'])('%s 在剪贴板权限/读取等待时锁提交且允许读取结果入表', async name => {
  setup(); vi.mocked(thumb).mockResolvedValue('data:image/png;base64,ok')
  const render = name === '录单' ? renderEntry : renderComment
  render()
  if (name === '录单') h.slots[0] = { ...h.slots[0], title: '测试订单', channelId: 'channel', basePrice: '100' }
  else nodes(render()).find(node => node.type === 'textarea').props.onChange({ target: { value: '意见', selectionStart: 2 } })
  const actions = nodes(render()).find(node => node.type === 'image-actions')
  actions.props.onReading(true)
  const label = name === '录单' ? '保存' : '发送'
  expect(button(render(), label).props.disabled).toBe(true)
  await button(render(), label).props.onClick()
  expect(createOrder).not.toHaveBeenCalled(); expect(addComment).not.toHaveBeenCalled()
  if (name === '评论') { await actions.props.onFiles([image()]); expect(thumb).toHaveBeenCalledOnce() }
  actions.props.onReading(false)
  expect(button(render(), label).props.disabled).toBe(false)
})

it('录单展开备注仅图标选图，读图时禁止保存，文字仍保留', async () => {
  setup(); vi.stubGlobal('FileReader', class { result = ''; onload?: () => void; readAsDataURL() { h.readers.push(this) } })
  renderEntry(); h.slots[0] = { ...h.slots[0], title: '测试订单', channelId: 'channel', basePrice: '100' }
  expect(nodes(renderEntry()).some(n => n.props.id === 'q-note')).toBe(false)
  button(renderEntry(), '更多信息').props.onClick()
  let tree = renderEntry(), textarea = nodes(tree).find(n => n.props.id === 'q-note')
  textarea.props.onChange({ target: { value: '保留文字要求' } })
  const fileInput = nodes(tree).find(n => n.props['aria-label'] === '补充截图文件'), click = vi.fn()
  fileInput.props.ref.current = { click }
  nodes(tree).find(n => n.props['aria-label'] === '上传补充截图').props.onClick(); expect(click).toHaveBeenCalledOnce()
  fileInput.props.onChange({ target: { files: [image()], value: 'picked' } })
  await button(tree, '保存').props.onClick(); expect(createOrder).not.toHaveBeenCalled()
  expect(button(renderEntry(), '保存').props.disabled).toBe(true)
  h.readers[0].result = 'data:image/png;base64,screenshot'; h.readers[0].onload()
  await vi.waitFor(() => expect(button(renderEntry(), '保存').props.disabled).toBe(false))
  tree = renderEntry(); expect(nodes(tree).find(n => n.props.id === 'q-note').props.value).toBe('保留文字要求')
  expect(nodes(tree).some(n => n.type === 'image-actions')).toBe(false)
})

it('录单可逐张移除误贴截图，读取中保留原截图并锁定删除', async () => {
  setup(); vi.stubGlobal('FileReader', class { result = ''; onload?: () => void; readAsDataURL() { h.readers.push(this) } })
  zone(renderEntry()).props.onPaste(event(transfer(image())))
  h.readers[0].result = 'data:image/png;base64,first'; h.readers[0].onload()
  await vi.waitFor(() => expect(button(renderEntry(), '保存').props.disabled).toBe(false))
  const noteField = nodes(renderEntry()).find(n => n.props.htmlFor === 'q-note')
  expect(nodes(noteField).some(n => n.props.id === 'q-shots')).toBe(true)
  const remove = () => nodes(renderEntry()).find(n => n.props['aria-label'] === '移除录单截图 1')
  zone(renderEntry()).props.onPaste(event(transfer(image())))
  expect(remove().props.disabled).toBe(true)
  remove().props.onClick()
  expect(nodes(renderEntry()).filter(n => n.props.pics)).toHaveLength(1)
  h.readers[1].result = 'data:image/png;base64,second'; h.readers[1].onload()
  await vi.waitFor(() => expect(remove().props.disabled).toBe(false))
  remove().props.onClick()
  expect(nodes(renderEntry()).filter(n => n.props.pics).flatMap(n => n.props.pics).map(p => p.src)).toEqual(['data:image/png;base64,second'])
  remove().props.onClick()
  expect(nodes(renderEntry()).some(n => n.props.pics)).toBe(false)
  expect(text(renderEntry())).not.toContain('截图已附加')
})

it('讨论白区点击聚焦输入框，上传入口仅图标', () => {
  setup()
  const tree = renderComment(), wrapper = zone(tree), input = nodes(tree).find(n => n.type === 'textarea'), focus = vi.fn()
  input.props.ref.current = { focus }
  wrapper.props.onClick({ target: { closest: () => null } })
  expect(focus).toHaveBeenCalledOnce()
  expect(nodes(tree).find(n => n.type === 'image-actions').props.pickerOnly).toBe(true)
})
