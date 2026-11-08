import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OrderView } from '@/shared/types'
import { needsDeadline } from '@/shared/order-deadline'

const session = vi.hoisted(() => ({ orders: [] as OrderView[] }))
vi.mock('@/client/store', () => ({ useSession: () => ({ s: { orders: session.orders, users: [], cardFields: [] }, views: session.orders, me: { id: 'writer' }, can: () => false, user: () => undefined, channel: () => undefined }) }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn() }) }))
import { DueBadge } from '@/client/OrderDrawer'
import { OrderCard } from '@/client/Cards'
import { ReqCardTab } from '@/client/OrderTabs'
import { AssistantReply } from '@/client/AssistantReply'
import { Due } from '@/client/Due'
import { matchesOrderView } from '@/client/OrdersPage'
import { useTodos } from '@/client/AfterSale'

afterEach(() => vi.useRealTimers())

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return node && typeof node === 'object' && 'props' in node ? text((node as { props: { children?: unknown } }).props.children) : ''
}
function order(status: string, dueDate: string | null = null) {
  return { id: 'historical', no: 'DD2608010001', title: '历史订单', orderDate: '2026-08-01', status, dueDate, assignees: [], afterSales: [], req: {}, attachments: [] } as unknown as OrderView
}

it('截止未填计数及筛选只包含进行中的空日期订单，并保留原空值', () => {
  const rows = ['未交付', '已发演示', '已交付', '退单'].map(status => order(status))
  rows.push(order('未交付', '2026-10-20'))
  expect(rows.filter(needsDeadline).map(row => row.status)).toEqual(['未交付'])
  expect(rows.slice(0, 4).every(row => row.dueDate === null)).toBe(true)
})

it.each(['已发演示', '已交付', '退单'])('%s的空截止在详情、订单卡、需求卡和问答中不再提示补日期', status => {
  const v = order(status)
  session.orders = [v]
  const badge = DueBadge({ date: null, status, onClick: vi.fn() })
  expect(badge.type).toBe('span')
  expect(text(badge)).toBe('—')
  expect(text(OrderCard({ v }))).not.toContain('未定截止日期')
  expect(text(ReqCardTab({ v }))).toContain('截止 —')
  expect(text(AssistantReply({ question: '查历史订单', answer: { answer: '已找到', orders: [{ id: v.id, no: v.no, title: v.title }], scopes: [] } }))).toContain('截止 —')
  expect(v.dueDate).toBeNull()
})

it('发出演示后表格、详情和订单卡保留原截止日期，但不再突出逾期或列入即将截止', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T08:00:00+08:00'))
  const pending = order('未交付', '2026-11-01')
  const demo = { ...pending, status: '已发演示' }
  expect(text(Due({ date: pending.dueDate, status: pending.status }))).toContain('逾期')
  expect(text(DueBadge({ date: pending.dueDate, status: pending.status }))).toContain('逾期')
  expect(text(Due({ date: demo.dueDate, status: demo.status }))).toBe('11月1日')
  expect(text(DueBadge({ date: demo.dueDate, status: demo.status }))).toBe('截止 11月1日')
  expect(renderToStaticMarkup(<OrderCard v={pending}/>)).toContain('data-k="late"')
  expect(renderToStaticMarkup(<OrderCard v={demo}/>)).not.toContain('data-k="late"')
  expect(matchesOrderView(pending, { id: 'due', name: '即将截止', due: true })).toBe(true)
  expect(matchesOrderView(demo, { id: 'due', name: '即将截止', due: true })).toBe(false)
  expect(demo.status).toBe('已发演示')
  expect(demo.dueDate).toBe('2026-11-01')
})

it('已发演示的写手待办取消原单逾期，仍保留独立跟进逾期', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T08:00:00+08:00'))
  session.orders = [{ ...order('已发演示', '2026-11-01'), writerPayPlan: 'staged', assignees: [{ userId: 'writer', pay: 100 }], afterSales: [{ id: 'followup', writerId: 'writer', round: 1, start: '2026-11-01T00:00:00+08:00', due: '2026-11-02T00:00:00+08:00', confirmedAt: '2026-11-01T01:00:00+08:00' }] } as unknown as OrderView]
  function TodoProbe() { return <>{useTodos('mine').map(todo => `${todo.kind}:${todo.label}`).join('|')}</> }
  const rendered = renderToStaticMarkup(<TodoProbe/>)
  expect(rendered).not.toContain('初稿:')
  expect(rendered).toContain('跟进:')
  expect(rendered).toContain('逾期')
})

it('进行中仍保留补截止入口和文案，已有历史截止不被隐藏', () => {
  const v = order('未交付')
  const badge = DueBadge({ date: null, status: v.status })
  expect(badge.type).toBe('button')
  expect(text(badge)).toContain('截止未定')
  expect(text(OrderCard({ v }))).toContain('未定截止日期')
  expect(text(DueBadge({ date: '2026-08-10', status: '已交付' }))).toContain('截止 ')
})
