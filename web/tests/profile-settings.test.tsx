import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: new Map<number, { deps: any[]; cleanup?: () => void }>(), queue: [] as (() => void)[], prefs: {} as Record<string, any>, session: {} as any }))
vi.mock('react', async () => ({ ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => void | (() => void), deps: any[]) => { const i = h.cursor++, old = h.effects.get(i); if (!old || deps.some((value, j) => value !== old.deps[j])) h.queue.push(() => { old?.cleanup?.(); h.effects.set(i, { deps, cleanup: fn() || undefined }) }) },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, setUserFrame: vi.fn(), setUserAvatar: vi.fn(), updateMe: vi.fn() }))
vi.mock('@/client/prefs', () => ({ usePref: (key: string, fallback: any) => [h.prefs[key] ?? fallback, (value: any) => { h.prefs[key] = value }] }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'p', DialogOverlay: 'overlay', DialogPortal: 'portal' }))
vi.mock('@/components/ui/app-dialog', async () => ({ ...await vi.importActual('@/components/ui/app-dialog'), AppDialogContent: 'dialog-content', AppDialogBody: 'div' }))
vi.mock('@/components/ui/tabs', () => ({ Tabs: 'tabs', TabsContent: 'tab-content', TabsList: 'tabs-list', TabsTrigger: 'tabs-trigger' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/ui', () => ({ Avatar: 'avatar', cropAvatar: vi.fn(), SkeletonRows: 'skeleton', inputCls: '' }))
vi.mock('@/client/AvatarFrames', () => ({ AvatarFramePicker: 'frame-picker' }))
vi.mock('sonner', () => ({ toast: { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }))

import { PasswordForm, ProfileAvatarUpload, ProfileDialog } from '@/client/Profile'
import { cropAvatar } from '@/client/ui'
import { setUserAvatar } from '@/client/store'
import { toast } from 'sonner'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : node?.props ? text(node.props.children) : ''
const find = (tree: any, id: string) => nodes(tree).find(node => node.props.id === id)
const submit = (tree: any) => nodes(tree).find(node => node.type === 'button' && node.props.type === 'submit')
function render(component: () => any) { h.cursor = 0; h.queue = []; const tree = component(); h.queue.forEach(effect => effect()); return tree }
beforeEach(() => {
  h.session = { me: { id: 'writer', name: '写手', account: 'writer', hue: 150, frame: 'none' }, role: { name: '写手' } }
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
})
afterEach(() => { h.effects.forEach(effect => effect.cleanup?.()); h.slots = []; h.cursor = 0; h.queue = []; h.effects.clear(); h.prefs = {}; vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('设置记住四个个人标签，外部深链接可切换且用户切换通知路由', () => {
  h.prefs['profile-tab'] = 'password'
  const onTabChange = vi.fn(), onOpenChange = vi.fn()
  let initialTab: string | undefined
  const draw = () => render(() => ProfileDialog({ open: true, onOpenChange, onTabChange, initialTab, resources: <div>原有收款码</div> }))
  let tree = draw()
  expect(nodes(tree).filter(node => node.type === 'tabs-trigger').map(node => node.props.value)).toEqual(['profile', 'password', 'sessions', 'resources'])
  expect(nodes(tree).find(node => node.type === 'tabs').props.value).toBe('password')
  initialTab = 'resources'; draw(); tree = draw()
  expect(nodes(tree).find(node => node.type === 'tabs').props.value).toBe('resources')
  expect(text(tree)).toContain('原有收款码')
  nodes(tree).find(node => node.type === 'tabs').props.onValueChange('profile')
  expect(h.prefs['profile-tab']).toBe('profile'); expect(onTabChange).toHaveBeenLastCalledWith('profile')
  expect(fetch).not.toHaveBeenCalled()
})

it('未保存姓名通过统一关闭确认，继续填写保留内容，放弃后清空再关闭', () => {
  const onOpenChange = vi.fn(), draw = () => render(() => ProfileDialog({ open: true, onOpenChange }))
  let tree = draw()
  find(tree, 'pf-name').props.onChange({ target: { value: '还没保存' } }); tree = draw()
  nodes(tree).find(node => node.type === 'dialog').props.onOpenChange(false)
  tree = draw(); expect(onOpenChange).not.toHaveBeenCalled()
  expect(nodes(tree).filter(node => node.type === 'dialog')[1].props.open).toBe(true)
  nodes(tree).find(node => node.type === 'button' && text(node) === '继续填写').props.onClick()
  tree = draw(); expect(find(tree, 'pf-name').props.value).toBe('还没保存')
  nodes(tree).find(node => node.type === 'dialog').props.onOpenChange(false); tree = draw()
  nodes(tree).find(node => node.type === 'button' && text(node) === '放弃并关闭').props.onClick()
  expect(onOpenChange).toHaveBeenLastCalledWith(false)
  expect(find(draw(), 'pf-name').props.value).toBe('写手')
})

it('密码规则与确认输入控制提交，三个眼睛独立切换，成功清空输入并解除脏状态', async () => {
  const onDirtyChange = vi.fn(), onDone = vi.fn(), draw = () => render(() => PasswordForm({ onDirtyChange, onDone }))
  let tree = draw()
  expect(submit(tree).props.disabled).toBe(true)
  find(tree, 'pw-cur').props.onChange({ target: { value: 'old12345' } })
  find(tree, 'pw-new').props.onChange({ target: { value: 'password' } })
  find(tree, 'pw-again').props.onChange({ target: { value: 'password' } })
  tree = draw(); expect(submit(tree).props.disabled).toBe(true); expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  find(tree, 'pw-new').props.onChange({ target: { value: 'new12345' } }); tree = draw()
  expect(text(tree)).toContain('两次输入的新密码不一致')
  find(tree, 'pw-again').props.onChange({ target: { value: 'new12345' } }); tree = draw()
  expect(submit(tree).props.disabled).toBe(false)
  for (const label of ['当前密码', '新密码', '确认新密码']) nodes(tree).find(node => node.props['aria-label'] === `显示${label}`).props.onClick()
  tree = draw(); expect(['pw-cur', 'pw-new', 'pw-again'].map(id => find(tree, id).props.type)).toEqual(['text', 'text', 'text'])
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: true }))
  await tree.props.onSubmit({ preventDefault: vi.fn() }); tree = draw()
  expect(['pw-cur', 'pw-new', 'pw-again'].map(id => find(tree, id).props.value)).toEqual(['', '', ''])
  expect(onDirtyChange).toHaveBeenLastCalledWith(false); expect(onDone).toHaveBeenCalledOnce()
  expect(toast.success).toHaveBeenCalledWith('密码已修改', expect.any(Object))
})

it('新头像布局保留剪贴板图片接收和已有裁剪保存流程', async () => {
  vi.mocked(cropAvatar).mockResolvedValue('data:image/jpeg;base64,avatar')
  vi.mocked(setUserAvatar).mockResolvedValue(true)
  const tree = render(() => ProfileAvatarUpload({ user: h.session.me }))
  const photo = new File(['test'], 'avatar.png', { type: 'image/png' })
  const event = { clipboardData: { files: [photo], items: [] }, preventDefault: vi.fn(), stopPropagation: vi.fn() }
  tree.props.onPaste(event)
  await vi.waitFor(() => expect(setUserAvatar).toHaveBeenCalledWith('writer', 'data:image/jpeg;base64,avatar'))
  expect(cropAvatar).toHaveBeenCalledWith(photo); expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(nodes(tree).find(node => node.type === 'avatar').props.size).toBe(96)
})

it('登录记录只展示最近30天服务器字段，保留失败原因且不推测城市或本机', async () => {
  h.prefs['profile-tab'] = 'sessions'
  vi.mocked(fetch).mockResolvedValueOnce(Response.json([
    { at: new Date().toISOString(), ok: false, reason: '密码错误', ip: '192.0.2.1', ua: 'Mozilla/5.0 (Mac OS X) Safari/605.1' },
    { at: new Date(Date.now() - 31 * 86_400_000).toISOString(), ok: true, reason: null, ip: '192.0.2.2', ua: 'Old browser' },
  ]))
  const draw = () => render(() => ProfileDialog({ open: true, onOpenChange: vi.fn() }))
  draw(); await vi.waitFor(() => expect(text(draw())).toContain('192.0.2.1'))
  const result = text(draw())
  expect(result).toContain('Mac · Safari'); expect(result).toContain('密码错误')
  expect(result).not.toContain('192.0.2.2'); expect(result).not.toContain('本机')
})
