'use client'

import { useEffect, type ReactNode } from 'react'
import { connectLive, refresh, useBootStatus } from '@/client/store'
import AppShell from '@/client/AppShell'
import { DialogRouteProvider } from './useDialogRoute'
import { MustChange } from '@/client/Login'
import { RoutePageLoading } from './RoutePageLoading'
import { SkeletonBlock } from './PageLoading'

export function WorkbenchRoot({ children }: { children: ReactNode }) {
  const status = useBootStatus()
  useEffect(() => {
    void refresh().then(connectLive)
  }, [])
  useEffect(() => {
    // 带着原地址去登录（比如扫卡片二维码进来的），登录完回到这一单
    if (status === 'login') location.replace((location.pathname !== '/' || location.search) ? `/login?next=${encodeURIComponent(location.pathname + location.search)}` : '/login')
  }, [status])
  if (status === 'ready') return <DialogRouteProvider><AppShell>{children}</AppShell></DialogRouteProvider>
  if (status === 'mustChange') return <MustChange />
  if (status === 'error')
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <div className="grid justify-items-center gap-3">
          连不上服务器
          <button className="rounded-md border px-3 py-1.5 text-foreground" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      </div>
    )
  return <WorkbenchLoading />
}

export function WorkbenchLoading() {
  return (
    <div className="flex h-full min-w-0">
      <div aria-hidden="true" className="hidden w-56 shrink-0 space-y-5 border-r bg-sidebar p-5 md:block">
        <SkeletonBlock className="mb-10 h-8 w-28" />
        {[0, 1, 2, 3, 4, 5].map(i => <SkeletonBlock key={i} className="h-5 w-32" />)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div aria-hidden="true" className="flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:px-6">
          <SkeletonBlock className="h-8 w-full max-w-80" /><SkeletonBlock className="ml-auto h-8 w-8 shrink-0 rounded-full" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6"><RoutePageLoading /></div>
      </div>
    </div>
  )
}
