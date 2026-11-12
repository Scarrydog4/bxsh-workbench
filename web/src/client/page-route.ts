'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { Page } from './nav'

export const PAGE_PATHS: Record<Page, string> = {
  inquiries: '/inquiries', contractors: '/contractors', cases: '/cases', talk: '/talk', reviews: '/reviews', home: '/', orders: '/orders', tasks: '/tasks', aftersales: '/follow-ups', channels: '/channels',
  income: '/income', settle: '/payroll', toolbox: '/tools', forum: '/forum', dm: '/messages',
  assistant: '/assistant', settings: '/admin/settings', roles: '/admin/accounts', audit: '/admin/audit', trash: '/admin/trash',
}
export const ADMIN_PAGES: Page[] = ['settings', 'roles', 'audit', 'trash', 'contractors']
export function sidebarPage(page: Page): Page {
  if (page === 'aftersales') return 'tasks'
  return page
}
export function pageFromPath(path: string): Page {
  const normalized = path.replace(/\/$/, '') || '/'
  if (normalized.startsWith('/forum/')) return 'forum'
  return (Object.keys(PAGE_PATHS) as Page[]).find(page => PAGE_PATHS[page] === normalized) ?? 'home'
}
export function forumPostPath(id: string) { return `/forum/${encodeURIComponent(id)}` }
export function forumPostFromPath(path: string) {
  const match = /^\/forum\/([^/]+)\/?$/.exec(path)
  if (!match) return null
  try { return decodeURIComponent(match[1]) } catch { return null }
}

/** Next owns URLs and history; authorized client views can follow the target while the route is pending. */
export function usePageRoute() {
  const pathname = usePathname() || '/'
  const router = useRouter()
  const [target, setTarget] = useState<{ page: Page; from: string; to: string } | null>(null)
  useEffect(() => { if (target && pathname !== target.from) setTarget(null) }, [pathname, target])
  const prepare = useCallback((page: Page) => {
    const to = PAGE_PATHS[page]
    setTarget(pathname === to ? null : { page, from: pathname, to })
  }, [pathname])
  const go = useCallback((page: Page, replace = false) => {
    prepare(page)
    router[replace ? 'replace' : 'push'](PAGE_PATHS[page], { scroll: false })
  }, [prepare, router])
  const pending = !!target && pathname === target.from && pathname !== target.to
  return [pending ? target!.page : pageFromPath(pathname), go, { pending, prepare, pathname }] as const
}
