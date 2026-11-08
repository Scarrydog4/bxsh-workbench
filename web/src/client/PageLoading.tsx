import type { Page } from './nav'
import { cn } from '@/lib/utils'

const titles: Record<Page, string> = {
  cases: '案例', talk: '话术', reviews: '复盘', home: '工作台', orders: '订单', channels: '渠道', settle: '工资结算', income: '收入',
  tasks: '任务', aftersales: '交付跟进', toolbox: '工具箱', forum: '论坛', dm: '私信',
  assistant: '智能助手', settings: '系统设置', roles: '角色与账号', audit: '审计日志', trash: '回收站',
}

/** Static shapes keep large tables cheap to paint; only the small loading indicator pulses. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-muted/60', className)} />
}

function ToolbarSkeleton() {
  return <div data-skeleton="toolbar" className="flex items-center gap-2 border-b p-3 sm:px-5">
    <SkeletonBlock className="h-9 w-full max-w-80" /><SkeletonBlock className="h-9 w-16 shrink-0" />
    <SkeletonBlock className="ml-auto hidden h-9 w-20 shrink-0 sm:block" />
  </div>
}

export function TableSkeleton({ channels = false }: { channels?: boolean }) {
  return <div data-skeleton="table" className="overflow-hidden rounded-xl border bg-card">
    <ToolbarSkeleton />
    <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] gap-4 border-b px-3 py-4 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] sm:px-5">
      {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} className={cn('h-3 w-14', i === 3 && 'hidden sm:block')} />)}
    </div>
    {Array.from({ length: 6 }, (_, i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-4 border-b px-3 py-4 last:border-b-0 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] sm:px-5">
      <div className="flex min-w-0 items-center gap-2">{channels && <SkeletonBlock className="h-8 w-8 shrink-0 rounded-full" />}<SkeletonBlock className={cn('h-4', i % 2 ? 'w-4/5' : 'w-3/5')} /></div>
      <SkeletonBlock className="h-4 w-12" /><SkeletonBlock className="h-4 w-14" /><SkeletonBlock className="hidden h-4 w-16 sm:block" />
    </div>)}
    <div className="border-t px-3 py-3 sm:px-5"><SkeletonBlock className="h-3 w-32" /></div>
  </div>
}

export function ChartSkeleton({ className }: { className?: string }) {
  return <div data-skeleton="chart" className={cn('flex min-h-28 flex-col justify-between rounded-md bg-muted/20 px-2 py-3', className)}>
    {[0, 1, 2].map(i => <div key={i} className="h-px w-full bg-muted" />)}
    <div className="flex justify-between"><SkeletonBlock className="h-2 w-8" /><SkeletonBlock className="h-2 w-8" /><SkeletonBlock className="h-2 w-8" /></div>
  </div>
}

function DashboardSkeleton() {
  return <div className="space-y-5">
    <div data-skeleton="metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="col-span-2 flex min-h-64 flex-col gap-4 rounded-xl border bg-card p-5 lg:row-span-2">
        <SkeletonBlock className="h-3 w-24" /><SkeletonBlock className="h-10 w-44" /><SkeletonBlock className="h-3 w-32" />
        <ChartSkeleton className="mt-auto h-36" />
      </div>
      {[0, 1, 2, 3].map(i => <div key={i} className="space-y-3 rounded-xl border bg-card p-4"><SkeletonBlock className="h-3 w-16" /><SkeletonBlock className="h-7 w-24 max-w-full" /><ChartSkeleton className="!min-h-14 h-14" /></div>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"><ChartSkeleton className="h-48 border bg-card" /><LoadingList rows={3} /></div>
  </div>
}

function IncomeSkeleton() {
  return <div className="space-y-4">
    <ToolbarSkeleton />
    <div data-skeleton="metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className={cn('space-y-3 rounded-xl border p-4', i === 2 && 'hidden sm:block')}><SkeletonBlock className="h-3 w-16" /><SkeletonBlock className="h-8 w-24" /></div>)}</div>
    <ChartSkeleton className="h-40 sm:h-48" /><TableSkeleton />
  </div>
}

/** Reused inside lists whose data arrives after the workspace shell. */
export function LoadingList({ rows = 4, detail = false }: { rows?: number; detail?: boolean }) {
  return <div data-skeleton={detail ? 'article' : 'list'} className="divide-y rounded-xl border bg-card">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="space-y-3 p-4 sm:p-5">
      <div className="flex items-center gap-3"><SkeletonBlock className="h-8 w-8 shrink-0 rounded-full" /><SkeletonBlock className="h-4 w-3/5" /></div>
      <SkeletonBlock className="h-3 w-11/12" /><SkeletonBlock className="h-3 w-3/4" />
      {detail && <><SkeletonBlock className="h-3 w-full" /><SkeletonBlock className="h-3 w-5/6" /><SkeletonBlock className="my-4 h-32 w-full" /></>}
    </div>)}
  </div>
}

function TasksSkeleton() {
  return <div data-skeleton="tasks" className="space-y-4">
    <div className="flex gap-2">{[0, 1, 2].map(i => <SkeletonBlock key={i} className="h-8 w-24" />)}</div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"><LoadingList rows={4} /><div className="hidden lg:block"><LoadingList rows={3} /></div></div>
  </div>
}

function ToolboxSkeleton() {
  return <div data-skeleton="toolbox" className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
    <div className="flex items-center gap-3"><SkeletonBlock className="h-12 w-12" /><div className="flex-1 space-y-3"><SkeletonBlock className="h-5 w-40" /><SkeletonBlock className="h-3 w-3/4" /></div></div>
    <SkeletonBlock className="h-12 w-full" />
    <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="space-y-2"><SkeletonBlock className="h-3 w-20" /><SkeletonBlock className="h-11 w-full" /></div>)}</div>
    <div className="flex h-48 flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-muted/20 sm:h-64"><SkeletonBlock className="h-10 w-10 rounded-full" /><SkeletonBlock className="h-4 w-2/3 max-w-72" /><SkeletonBlock className="h-3 w-1/2 max-w-56" /></div>
    <div className="flex items-center justify-between gap-4 border-t pt-4"><SkeletonBlock className="h-7 w-24" /><SkeletonBlock className="h-11 w-40" /></div>
  </div>
}

function FormSkeleton() {
  return <div data-skeleton="settings" className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
    <div className="flex gap-2 sm:flex-col">{[0, 1, 2].map(i => <SkeletonBlock key={i} className="h-9 w-full" />)}</div>
    <div className="space-y-5 rounded-xl border bg-card p-5">{[0, 1, 2, 3].map(i => <div key={i} className="space-y-2"><SkeletonBlock className="h-3 w-24" /><SkeletonBlock className="h-10 w-full" /></div>)}<SkeletonBlock className="h-9 w-20" /></div>
  </div>
}

function PageSkeleton({ page }: { page: Page }) {
  if (page === 'home') return <DashboardSkeleton />
  if (page === 'income') return <IncomeSkeleton />
  if (page === 'tasks' || page === 'aftersales') return <TasksSkeleton />
  if (page === 'toolbox') return <ToolboxSkeleton />
  if (page === 'settings') return <FormSkeleton />
  if (page === 'forum' || page === 'dm') return <div className="space-y-4"><ToolbarSkeleton /><div className="grid gap-4 lg:grid-cols-[minmax(260px,2fr)_minmax(0,3fr)]"><LoadingList /><div className="hidden lg:block"><LoadingList rows={1} detail /></div></div></div>
  if (page === 'assistant') return <div data-skeleton="assistant" className="flex min-h-[420px] flex-col gap-4 rounded-xl border bg-card p-5"><SkeletonBlock className="h-8 w-40" /><SkeletonBlock className="h-20 w-4/5" /><SkeletonBlock className="ml-auto h-14 w-3/5" /><SkeletonBlock className="mt-auto h-14 w-full" /></div>
  return <TableSkeleton channels={page === 'channels' || page === 'roles'} />
}

export function PageLoading({ page = 'orders', title, error, onRetry }: { page?: Page; title?: string; error?: boolean; onRetry?: () => void }) {
  return <div role={error ? 'alert' : 'status'} aria-busy={!error} data-page-loading={page} className="w-full min-w-0">
    {error ? <div className="grid min-h-[220px] place-content-center justify-items-center gap-4 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
      <p>数据加载失败，请重试</p><button className="rounded-md border px-3 py-2 text-foreground" onClick={onRetry}>重新加载</button>
    </div> : <>
      <span className="sr-only">正在加载{title ?? titles[page]}…</span>
      <div aria-hidden="true" className="space-y-4">
        <div className="flex h-7 items-center gap-3"><SkeletonBlock className="h-5 w-28" /><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/35 motion-safe:animate-pulse" /></div>
        <PageSkeleton page={page} />
      </div>
    </>}
  </div>
}
