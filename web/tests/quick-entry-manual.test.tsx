import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, session: {} as any, effects: [] as (() => void)[] }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
  useEffect: (fn: () => void) => { h.effects.push(fn) }, useMemo: (fn: () => unknown) => fn(),
}))
vi.mock('motion/react', async () => ({ ...await vi.importActual('motion/react'), useReducedMotion: () => false }))
vi.mock('@/client/store', () => ({ useSession: () => h.session, createOrder: vi.fn(), uploadFiles: vi.fn(), addPayment: vi.fn(), salesPeople: () => h.session.s.users, createChannel: vi.fn() }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
vi.mock('@/client/prefs', () => ({ usePref: () => [false, vi.fn()] }))
vi.mock('@/client/fresh', () => ({ markFresh: vi.fn() }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/client/ui', () => ({ Avatar: 'avatar', ChannelAvatar: 'channel-avatar', Combobox: 'combo', Field: 'field', inputCls: '' }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
import { QuickEntry } from '@/client/QuickEntry'
import { PersonChoice } from '@/client/PersonChoice'
import { IntakePayment } from '@/client/IntakePayment'
import { WriterSelect } from '@/client/WriterSelect'
import { createChannel, createOrder } from '@/client/store'
import { toast } from 'sonner'
import { Popover } from '@/components/ui/popover'
import { deadlineFrom, iso, today } from '@/shared/format'
import * as format from '@/shared/format'
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const render = () => { h.cursor = 0; return QuickEntry({ open: true, onOpenChange: vi.fn() }) }
const find = (id: string) => nodes(render()).find(n => n.props.id === id)
const button = (label: string) => nodes(render()).find(n => n.type === 'button' && text(n).includes(label))
beforeEach(() => {
  const boss = { id: 'boss', name: '老板', salesMode: 'commission' }, cost = { id: 'cost', name: '底价销售', salesMode: 'cost' }
  h.session = { me: boss, s: { users: [boss, cost], channels: [{ id: 'c', name: '销售渠道', ownerId: 'cost' }], types: ['论文'] }, can: () => true, role: { locked: true }, adminIds: new Set(['boss']), views: [] }
})
afterEach(() => { h.slots = []; h.effects = []; vi.clearAllMocks(); vi.restoreAllMocks() })
it('默认老板和今天，备注类型和模式均折叠且无AI首屏', () => {
  const tree = render(), all = nodes(tree)
  expect(h.slots[0]).toMatchObject({ ownerId: 'boss', orderDate: iso(today()), salesMode: 'commission' })
  expect(find('q-note')).toBeUndefined(); expect(find('q-type')).toBeUndefined(); expect(find('q-mode')).toBeUndefined()
  expect(text(tree)).not.toMatch(/识别|AI|渠道消息/)
  expect(all.find(n => n.type === Popover).props.open).toBe(false)
  button('更多信息').props.onClick()
  expect(find('q-note')).toBeDefined(); expect(find('q-type')).toBeDefined(); expect(find('q-mode')).toBeDefined()
  expect(nodes(render()).some(n => n.props['aria-label'] === '上传补充截图')).toBe(true)
  expect(nodes(render()).some(n => n.props['aria-label']?.includes('粘贴图片'))).toBe(false)
})
it('换渠道不换老板；显式换销售使用账号模式且清除旧口径金额', () => {
  find('q-channel-search').props.onChange('c')
  expect(h.slots[0]).toMatchObject({ ownerId: 'boss', channelId: 'c', salesMode: 'commission' })
  find('q-price').props.onChange({ target: { value: '500' } })
  nodes(render()).find(n => n.type === IntakePayment).props.onChange('100', '定金')
  button('更换').props.onClick?.()
  nodes(render()).find(n => n.type === PersonChoice).props.onChange('cost')
  expect(h.slots[0]).toMatchObject({ ownerId: 'cost', salesMode: 'cost', basePrice: '', paidAmount: '' })
  expect(find('q-channel')).toBeUndefined()
  expect(nodes(render()).find(n => n.props.htmlFor === 'q-price').props.label).toBe('销售应付底价')
})

it('渠道平时只展示头像姓名，展开后聚焦搜索并保留新建入口', async () => {
  expect(find('q-channel').type).toBe('button')
  expect(text(find('q-channel'))).toContain('选择渠道')
  const combo = find('q-channel-search')
  expect(combo.props).toMatchObject({ autoFocus: true, inlineList: true })
  combo.props.onChange('c')
  expect(text(find('q-channel'))).toBe('销售渠道更换')
  expect(nodes(find('q-channel')).some(n => n.type === 'channel-avatar')).toBe(true)
  vi.mocked(createChannel).mockResolvedValueOnce({ id: 'new-channel' } as any)
  expect(await find('q-channel-search').props.onCreate('新客户')).toBe('new-channel')
  expect(createChannel).toHaveBeenCalledWith('新客户', 'boss')
  expect(h.slots[0].ownerId).toBe('boss')
})

it('多人手填工资各自保留，新增写手套用默认比例', () => {
  vi.spyOn(format, 'today').mockReturnValue(new Date('2026-10-15T00:00:00'))
  h.session.s.users = [{ id: 'boss', name: '老板', canWrite: true }, { id: 'xiao', name: '肖森凯', canWrite: true }, { id: 'gold', name: 'goldcode', canWrite: true }]
  h.session.s.defaultWriterId = 'xiao'
  const writers = () => nodes(render()).find(n => n.type === WriterSelect)
  const payInput = (id: string) => nodes(writers().props.renderPay(h.session.s.users.find((u: any) => u.id === id))).find(n => n.type === 'input' && n.props['aria-label']?.endsWith('写手工资'))
  payInput('xiao').props.onChange({ target: { value: '80' } })
  writers().props.onToggle('boss')
  writers().props.onToggle('gold')
  payInput('gold').props.onChange({ target: { value: '120' } })
  expect(payInput('boss')).toBeDefined()
  expect(h.slots[0].rows).toEqual([{ userId: 'xiao', pay: '80', rate: null }, { userId: 'boss', pay: '0', rate: '20' }, { userId: 'gold', pay: '120', rate: null }])
  writers().props.onToggle('xiao')
  expect(h.slots[0].rows).toEqual([{ userId: 'boss', pay: '0', rate: '20' }, { userId: 'gold', pay: '120', rate: null }])
  writers().props.onToggle('xiao')
  expect(payInput('xiao').props.value).toBe('')
  expect(payInput('gold').props.value).toBe('120')
})
it('底价销售自身录单直接为底价，且不能切换归属', () => {
  h.session.me = h.session.s.users[1]; h.session.role.locked = false; h.session.can = (p: string) => p !== 'order.assign'
  expect(nodes(render()).some(n => n.type === PersonChoice)).toBe(false)
  expect(h.slots[0]).toMatchObject({ ownerId: 'cost', salesMode: 'cost' })
  expect(find('q-channel')).toBeUndefined()
})
it('金额相邻，快捷截止仅1/7/15/30天且按下单日期计算', () => {
  const all = nodes(render()), payment = all.find(n => n.type === IntakePayment)
  expect(payment.props).toMatchObject({ id: 'q-paid', stacked: true, quickPercentages: true, label: '已收定金' })
  expect(all.findIndex(n => n.props.id === 'q-price')).toBeLessThan(all.indexOf(payment))
  const chips = all.filter(n => Array.isArray(n.props.children) && n.props.children[1] === ' 天')
  expect(chips.map(n => n.props.children[0])).toEqual([1, 7, 15, 30])
  chips[0].props.onClick()
  expect(h.slots[0].dueDate).toBe(deadlineFrom(h.slots[0].orderDate, 1))
})

it('下单日期保持可改并使用原默认截止算法，折叠备注不清空内容', () => {
  find('q-date').props.onChange({ target: { value: '2026-10-05' } })
  expect(h.slots[0]).toMatchObject({ orderDate: '2026-10-05', dueDate: deadlineFrom('2026-10-05') })
  button('更多信息').props.onClick()
  find('q-note').props.onChange({ target: { value: '保留客户要求' } })
  button('更多信息').props.onClick()
  expect(find('q-note')).toBeUndefined()
  button('更多信息').props.onClick()
  expect(find('q-note').props.value).toBe('保留客户要求')
})

it('旧制度非法工资不会被转换为零提交，空工资仍作为未定提交', async () => {
  vi.spyOn(format, 'today').mockReturnValue(new Date('2026-10-15T00:00:00'))
  h.session.s.users.push({ id: 'writer', name: '写手', canWrite: true })
  render()
  h.slots[0] = { ...h.slots[0], title: '订单', channelId: 'c', basePrice: '500', rows: [{ userId: 'writer', pay: '80..5', rate: null }] }
  await button('保存').props.onClick()
  expect(createOrder).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith('写手的工资格式不正确，最多两位小数')
  h.slots[0].rows[0].pay = ''
  await button('保存').props.onClick()
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ assignees: [{ userId: 'writer', pay: null, rate: null }] }), undefined, expect.objectContaining({ onResult: expect.any(Function) }))
})

it('多人按各自默认比例计价，可单独覆盖比例或金额且不重分其他人', () => {
  h.session.s.users = [{id:'boss',name:'老板',canWrite:true,writerRate:.1},{id:'xiao',name:'肖森凯',canWrite:true,writerRate:.25},{id:'gold',name:'goldcode',canWrite:true}]
  h.session.s.defaultWriterId = 'xiao'
  const writers = () => nodes(render()).find(n => n.type === WriterSelect)
  const input = (id: string, suffix: string) => nodes(writers().props.renderPay(h.session.s.users.find((u: any) => u.id === id))).find(n => n.type === 'input' && n.props['aria-label'].endsWith(suffix))
  find('q-price').props.onChange({target:{value:'1000'}})
  expect(text(render())).toContain('合计 ¥250')
  writers().props.onToggle('boss')
  expect(h.slots[0].rows).toEqual([{userId:'xiao',pay:'250',rate:'25'},{userId:'boss',pay:'100',rate:'10'}])
  input('xiao', '写手比例').props.onChange({target:{value:'30'}})
  expect(input('xiao', '写手工资').props.value).toBe('300')
  expect(input('boss', '写手工资').props.value).toBe('100')
  input('boss', '写手工资').props.onChange({target:{value:'80'}})
  find('q-price').props.onChange({target:{value:'1200'}})
  expect(h.slots[0].rows).toEqual([{userId:'xiao',pay:'360',rate:'30'},{userId:'boss',pay:'80',rate:null}])
  writers().props.onToggle('boss')
  expect(input('xiao', '写手工资').props.value).toBe('360')
})

it('历史工资占10%也不再提示新单选10%，录单和提交直接采用20%', async () => {
  vi.spyOn(format, 'today').mockReturnValue(new Date('2026-10-16T00:00:00'))
  h.session.s.users.push({ id: 'writer', name: '写手', canWrite: true })
  h.session.s.defaultWriterId = 'writer'
  h.session.views = [{ salesMode: 'commission', basePrice: 1000, assignees: [{ userId: 'writer', pay: 100 }] }]
  find('q-title').props.onChange({ target: { value: '按新制度录单' } })
  find('q-channel-search').props.onChange('c')
  find('q-price').props.onChange({ target: { value: '1000' } })
  expect(text(render())).not.toContain('建议工资')
  expect(text(render())).toContain('合计 ¥200')
  expect(h.slots[0].rows).toEqual([{ userId: 'writer', pay: '200', rate: '20' }])
  await button('保存').props.onClick()
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ basePrice: 1000, assignees: [{ userId: 'writer', pay: 200, rate: .2 }] }), undefined, expect.objectContaining({ onResult: expect.any(Function) }))
})

it('底价订单保留手填工资，不显示固定20%或重新分配工资', () => {
  vi.spyOn(format, 'today').mockReturnValue(new Date('2026-10-16T00:00:00'))
  h.session.s.users.push({ id: 'writer', name: '写手', canWrite: true })
  h.session.s.defaultWriterId = 'writer'
  nodes(render()).find(n => n.type === PersonChoice).props.onChange('cost')
  find('q-price').props.onChange({ target: { value: '500' } })
  const writers = nodes(render()).find(n => n.type === WriterSelect)
  const input = nodes(writers.props.renderPay(h.session.s.users.find((u: any) => u.id === 'writer'))).find(n => n.type === 'input' && n.props['aria-label']?.endsWith('写手工资'))
  input.props.onChange({ target: { value: '80' } })
  find('q-price').props.onChange({ target: { value: '600' } })
  expect(h.slots[0].rows).toEqual([{ userId: 'writer', pay: '80', rate: null }])
  expect(text(render())).toContain('合计 ¥80')
})

it('新制度销售复制不同结算模式旧单时使用账号模式，并清空不同口径金额', () => {
  vi.spyOn(format, 'today').mockReturnValue(new Date('2026-10-16T00:00:00'))
  h.session.role.locked = false; h.session.can = (p: string) => p !== 'order.assign'
  h.cursor = 0
  QuickEntry({open:true,onOpenChange:vi.fn(),prefill:{title:'复制底价单',salesMode:'cost',basePrice:'500'}})
  h.effects.forEach(effect => effect())
  expect(h.slots[0]).toMatchObject({title:'复制底价单',salesMode:'commission',basePrice:'',paidAmount:''})
})
