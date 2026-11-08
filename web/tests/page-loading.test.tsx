import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageLoading } from '@/client/PageLoading'
import type { Page } from '@/client/nav'

const h = vi.hoisted(() => ({ path: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => h.path }))
import { RoutePageLoading } from '@/client/RoutePageLoading'

it.each<[Page, string]>([
  ['home', 'metrics'], ['orders', 'table'], ['channels', 'table'], ['settle', 'table'],
  ['income', 'chart'], ['tasks', 'tasks'], ['aftersales', 'tasks'], ['toolbox', 'toolbox'],
  ['forum', 'list'], ['dm', 'list'], ['assistant', 'assistant'], ['settings', 'settings'],
  ['roles', 'table'], ['audit', 'table'], ['trash', 'table'],
])('%s 加载时显示对应布局，不伪造金额、单数或大量动画', (page, layout) => {
  const html = renderToStaticMarkup(<PageLoading page={page} />)
  expect(html).toContain(`data-page-loading="${page}"`)
  expect(html).toContain(`data-skeleton="${layout}"`)
  expect(html).toContain('aria-busy="true"')
  expect(html).not.toMatch(/¥0|0 单|0 个帖子/)
  expect(html.match(/animate-pulse/g)).toHaveLength(1)
})

it.each([
  ['/orders', 'orders'], ['/tools', 'toolbox'], ['/forum/a-post', 'forum'], ['/admin/accounts', 'roles'], ['/payroll', 'settle'],
])('直接打开 %s 时首屏骨架匹配路由', (path, page) => {
  h.path = path
  expect(renderToStaticMarkup(<RoutePageLoading />)).toContain(`data-page-loading="${page}"`)
})

it('失败后移除加载占位并保留可点击重试', () => {
  const retry = vi.fn(), tree = PageLoading({ page: 'orders', error: true, onRetry: retry })
  const html = renderToStaticMarkup(tree)
  expect(html).toContain('role="alert"')
  expect(html).toContain('aria-busy="false"')
  expect(html).not.toContain('data-skeleton')
  const body = tree.props.children as any
  body.props.children[1].props.onClick()
  expect(retry).toHaveBeenCalledOnce()
})
