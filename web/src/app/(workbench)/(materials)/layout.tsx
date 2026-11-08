'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { pageFromPath } from '@/client/page-route'
import { useSession } from '@/client/store'
import { WorkspaceHeading } from '@/client/WorkspaceHeading'

export default function MaterialsLayout({ children }: { children: ReactNode }) {
  const tab = pageFromPath(usePathname())
  const { can } = useSession()
  if (!can('order.view')) return null
  return <section className={'mx-auto w-full space-y-4 '+(tab === 'talk' ? 'max-w-[1240px]' : 'max-w-[1480px]')}>
    <WorkspaceHeading title={tab === 'talk' ? '话术' : '案例'}/>
    {children}
  </section>
}
