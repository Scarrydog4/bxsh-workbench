import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SettingsSection({ title, desc, children, className }: { title: string; desc?: ReactNode; children: ReactNode; className?: string }) {
  return <section aria-label={title} className={cn('[&+section]:mt-6 [&+section]:border-t [&+section]:pt-6', className)}>
    <div className="mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-sm leading-5 text-muted-foreground">{desc}</p>}
    </div>
    {children}
  </section>
}
