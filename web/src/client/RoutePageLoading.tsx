'use client'

import { usePathname } from 'next/navigation'
import { PageLoading } from './PageLoading'
import { pageFromPath } from './page-route'

/** The shared route boundary follows the URL, including a directly opened deep link. */
export function RoutePageLoading() {
  const pathname = usePathname()
  return <PageLoading page={pageFromPath(pathname || '/')} />
}
