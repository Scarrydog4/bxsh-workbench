import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, session: {} as any }))
vi.mock('react', async () => ({ ...await vi.importActual('react'), useEffect: () => {}, useMemo: (fn: () => unknown) => fn(),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
}))
vi.mock('@/client/store', () => ({ useSession: () => h.session, salesPeople: (s: any) => s.users, act: vi.fn(), createChannel: vi.fn(), deleteChannel: vi.fn(), setChannelAvatar: vi.fn(), updateChannel: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/table-kit', () => ({ DataTable: 'table', TablePageHeader: 'header', TableFooter: 'footer' }))
vi.mock('@/client/ui', () => ({ AvatarButton: 'avatar-button', ChannelAvatar: 'channel-avatar', StatusPill: 'status', Combobox: 'combo', ImageDrop: 'image-drop', Money: 'money', Person: 'person', Avatar: 'avatar', inputCls: '' }))
vi.mock('@/client/ChannelExport', () => ({ ChannelExport: 'export' }))
vi.mock('@/client/Statement', () => ({ StatementDialog: 'statement' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/select', () => ({ Select: 'select', SelectContent: 'select-content', SelectItem: 'option', SelectTrigger: 'select-trigger' }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'h1', DialogDescription: 'description' }))
vi.mock('@/components/ui/dropdown-menu', () => ({ DropdownMenu: 'menu', DropdownMenuContent: 'menu-content', DropdownMenuItem: 'menu-item', DropdownMenuTrigger: 'menu-trigger' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { ChannelsPage } from '@/client/ChannelsPage'
import { createChannel, setChannelAvatar } from '@/client/store'
const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : n?.props ? text(n.props.children) : ''
const button = (tree: any, label: string) => nodes(tree).find(n => n.type === 'button' && text(n).trim() === label)
const own = { id: 'mine', ownerId: 'sales', name: '自己渠道' }, other = { id: 'other', ownerId: 'other-sales', name: '别人渠道' }
function setup(admin = false) {
  const me = { id: 'sales', isAdmin: admin }
  h.session = { me, role: { locked: admin, fields: { sales: 'own' } }, can: () => true, adminIds: new Set(), user: (id: string) => ({ id, name: id }), views: [], s: { channels: [own, other], trash: [], users: [{ id: 'sales', name: '销售', isSales: true }] } }
}
function render() { h.cursor = 0; return ChannelsPage({}) }
const table = (tree: any) => nodes(tree).find(n => n.type === 'table' && n.props.id === 'channels')
afterEach(() => { h.slots = []; vi.resetAllMocks() })
it('自定义销售即使勾选管理权限也只看自己渠道，可创建和改自己头像，不能迁移删除', async () => {
  setup(); let tree = render(), grid = table(tree)
  expect(grid.props.rows).toEqual([own])
  expect(nodes(tree).some(n => n.props['aria-label'] === '渠道归属')).toBe(false)
  const owner = grid.props.cols.find((col: any) => col.id === 'owner').cell(own)
  expect(owner.type).toBe('person')
  const actions = grid.props.cols.find((col: any) => col.id === 'actions')
  expect(nodes(actions?.cell(own)).some(n => n.type === 'menu-item')).toBe(false)
  const avatar = (channel: any) => nodes(grid.props.cols.find((col: any) => col.id === 'name').cell(channel)).find(n => n.type === 'avatar-button')
  vi.mocked(setChannelAvatar).mockResolvedValue(true)
  expect(avatar(own).props.disabled).toBe(false); await avatar(own).props.onPick('picture')
  expect(setChannelAvatar).toHaveBeenCalledExactlyOnceWith('mine', 'picture')
  expect(avatar(other).props.disabled).toBe(true); await avatar(other).props.onPick('picture')
  expect(setChannelAvatar).toHaveBeenCalledTimes(1)
  button(tree, '新建渠道').props.onClick(); tree = render()
  expect(nodes(nodes(tree).find(n => n.type === 'form')).filter(n => n.type === 'combo')).toHaveLength(0)
  nodes(tree).find(n => n.type === 'input' && n.props.id === 'ch-name').props.onChange({ target: { value: '新建自己渠道' } })
  vi.mocked(createChannel).mockResolvedValue({ id: 'new' } as any)
  await nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault: vi.fn() })
  expect(createChannel).toHaveBeenCalledWith('新建自己渠道', 'sales', undefined)
})
it('管理员保留渠道归属、删除与所有人筛选入口', () => {
  setup(true); const tree = render(), grid = table(tree)
  expect(nodes(tree).some(n => n.props.label === '渠道归属')).toBe(true)
  expect(nodes(grid.props.cols.find((col: any) => col.id === 'owner').cell(own)).some(n => n.type === 'select')).toBe(true)
  expect(nodes(grid.props.cols.find((col: any) => col.id === 'actions').cell(own)).some(n => n.type === 'menu-item' && text(n).includes('删除渠道'))).toBe(true)
})
