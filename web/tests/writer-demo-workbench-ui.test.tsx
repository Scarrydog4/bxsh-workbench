import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OrderView } from '@/shared/types'

const h = vi.hoisted(() => ({ orders: [] as OrderView[] }))
vi.mock('@/client/store', () => ({ useSession: () => ({
  views: h.orders, me: { id: 'mine' }, channel: () => undefined, can: () => true,
}) }))
vi.mock('@/client/nav', () => ({ useNav: () => ({ openOrder: vi.fn(), go: vi.fn() }) }))
vi.mock('@/client/after-sale-data', () => ({ useAfterSaleTasks: () => ({ tasks: [], loading: false, error: null }) }))
vi.mock('@/client/TasksPage', () => ({ AfterSaleColumn: () => null }))
vi.mock('@/client/table-kit', () => ({
  TablePageHeader: ({ title, summary, children }: any) => <header>{title}{summary}{children}</header>,
  TableFooter: ({ children }: any) => <footer>{children}</footer>,
  DataTable: ({ rows, cols }: any) => <div>{rows.map((row: any) => <article key={row.order.id}>{row.order.title}{cols.filter((col: any) => ['stage', 'deadline', 'actions'].includes(col.id)).map((col: any) => <div key={col.id}>{col.cell(row)}</div>)}</article>)}</div>,
}))
vi.mock('@/client/controls', () => ({ Segmented: () => null }))
vi.mock('@/client/DeliverButton', () => ({ DeliverButton: () => <button>交付</button> }))
vi.mock('@/client/OrderProgress', () => ({ OrderProgress: () => null }))
vi.mock('@/client/OrderUrgency', () => ({ OrderBadges: () => null }))
import { WriterDashboard } from '@/client/WriterDashboard'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T10:00:00+08:00'))
  h.orders = [{
    id: 'demo', no: 'demo', title: '演示已发送的订单', orderDate: '2026-11-01', dueDate: '2026-11-02', status: '已发演示',
    assignees: [{ userId: 'mine' }], afterSales: [], writerProgress: [{ userId: 'mine', completedAt: null, completedProofIds: [], groupSentAt: null, groupProofIds: [] }],
  } as unknown as OrderView]
})
afterEach(() => vi.useRealTimers())

it('写手大表不把演示状态强行当成未交付逾期，仍保留正式交付入口', () => {
  const html = renderToStaticMarkup(<WriterDashboard/> )
  expect(html).toContain('演示已发送的订单')
  expect(html).toContain('待正式交付')
  expect(html).toContain('<button>交付</button>')
  expect(html).not.toContain('逾期')
  expect(html).not.toContain('逾 2 天')
  h.orders[0].status = '未交付'
  expect(renderToStaticMarkup(<WriterDashboard/>)).toContain('逾期')
})
