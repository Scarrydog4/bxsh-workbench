import { prefetchIncomeReport } from './report-cache'
import { getState } from './store'
import { memo } from 'react'
import type { Page } from './nav'
export const pageLoaders = {
  cases: () => import('./work-materials/Library').then(m => m.Library),
  talk: () => import('./work-materials/Library').then(m => m.Library),
  reviews: () => import('./work-materials/Reviews').then(m => m.Reviews),
  aftersales: () => import('./AfterSalesPage').then(m => m.AfterSalesPage),
  orders: () => import('./OrdersPage').then(m => memo(m.OrdersPage)),
  channels: () => import('./ChannelsPage').then(m => m.ChannelsPage),
  income: () => import('./IncomePage').then(m => m.IncomePage),
  forum: () => import('./forum/ForumPage').then(m => m.ForumPage),
  dm: () => import('./forum/DmPage').then(m => m.DmPage),
  toolbox: () => import('./ToolboxPage').then(m => m.ToolboxPage),
  settle: () => import('./PayrollPage').then(m => m.PayrollPage),
  settings: () => import('./SettingsPage').then(m => m.SettingsPage),
  roles: () => import('./RolesPage').then(m => m.RolesPage),
  audit: () => import('./AdminPages').then(m => m.AuditPage),
  trash: () => import('./AdminPages').then(m => m.TrashPage),
  assistant: () => import('./AssistantPage').then(m => m.AssistantPage),
}
export function preloadPage(page: Page) {
  const state = getState()
  if (page === 'income' && state) prefetchIncomeReport(state)
  if (page in pageLoaders) void pageLoaders[page as keyof typeof pageLoaders]().catch(() => {})
}
