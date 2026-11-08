import { Suspense, type ReactNode } from 'react'
import { WorkbenchRoot, WorkbenchLoading } from '@/client/WorkbenchRoot'

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<WorkbenchLoading />}><WorkbenchRoot>{children}</WorkbenchRoot></Suspense>
}
