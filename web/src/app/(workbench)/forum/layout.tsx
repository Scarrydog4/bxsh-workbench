import type { ReactNode } from 'react'
import { WorkspacePage } from '@/client/WorkspacePage'

export default function ForumLayout({ children }: { children: ReactNode }) { return <><WorkspacePage page='forum' />{children}</> }
