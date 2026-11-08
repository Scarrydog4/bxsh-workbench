import type { ReactNode } from 'react'

/** 列表标题旁放发布入口；数据页保留横向空间给报表页签。 */
export function WorkspaceHeading({ title, description, children, data = false }: {
  title: string; description?: string; children?: ReactNode; data?: boolean
}) {
  return <header className={'flex shrink-0 flex-wrap items-center gap-3 '+(data ? 'border-b px-3 py-2 sm:px-4' : 'justify-between')}>
    <div><h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>{children}
  </header>
}
export const pageAction = 'inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-primary/35 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10'
