'use client'

import { createContext, useContext } from 'react'
import dynamic from 'next/dynamic'
import { pageLoaders } from './page-loaders'
import { PageLoading } from './PageLoading'
import type { Page } from './nav'
import { Dashboard } from './Dashboard'
import { IncomePage } from './IncomePage'
import { WorkspaceHeading } from './WorkspaceHeading'
import { TasksPage, TaskTabs } from './TasksPage'
import { useSession } from './store'
import { ADMIN_PAGES } from './page-route'

const Library = dynamic(pageLoaders.cases)
const Reviews = dynamic(pageLoaders.reviews)
const AfterSalesPage = dynamic(pageLoaders.aftersales, { loading: () => <PageLoading page="aftersales" /> })
const OrdersPage = dynamic(pageLoaders.orders, { loading: () => <PageLoading page="orders" /> })
const InquiriesPage = dynamic(pageLoaders.inquiries, { loading: () => <PageLoading page="inquiries" /> })
const ContractorsPage = dynamic(pageLoaders.contractors, { loading: () => <PageLoading page="contractors" /> })
const ChannelsPage = dynamic(pageLoaders.channels, { loading: () => <PageLoading page="channels" /> })
const ForumPage = dynamic(pageLoaders.forum, { loading: () => <PageLoading page="forum" /> })
const DmPage = dynamic(pageLoaders.dm, { loading: () => <PageLoading page="dm" /> })
const ToolboxPage = dynamic(pageLoaders.toolbox, { loading: () => <PageLoading page="toolbox" /> })
const PayrollPage = dynamic(pageLoaders.settle, { loading: () => <PageLoading page="settle" /> })
const SettingsPage = dynamic(pageLoaders.settings, { loading: () => <PageLoading page="settings" /> })
const RolesPage = dynamic(pageLoaders.roles, { loading: () => <PageLoading page="roles" /> })
const AuditPage = dynamic(pageLoaders.audit, { loading: () => <PageLoading page="audit" /> })
const TrashPage = dynamic(pageLoaders.trash, { loading: () => <PageLoading page="trash" /> })

type RouteState = {
  channelId: string | null; channelFocus: number
  afterSaleId: string | null; setAfterSaleId: (id: string | null) => void
  rewriteSeed: { orderId: string; attachmentId: string } | null; clearRewriteSeed: () => void
}
export const WorkspacePageContext = createContext<RouteState>({ channelId: null, channelFocus: 0, afterSaleId: null, setAfterSaleId: () => {}, rewriteSeed: null, clearRewriteSeed: () => {} })

/** Internal navigation can render the authorized client view before the route response arrives. */
export function WorkspaceView({ page }: { page: Page }) {
  if (page === 'cases' || page === 'talk') return <section className={'mx-auto w-full space-y-4 ' + (page === 'talk' ? 'max-w-[1240px]' : 'max-w-[1480px]')}>
    <WorkspaceHeading title={page === 'talk' ? '话术' : '案例'} /><WorkspacePage page={page} />
  </section>
  return <WorkspacePage page={page} />
}

export function WorkspacePage({ page }: { page: Page }) {
  const state = useContext(WorkspacePageContext)
  const { role, me, can } = useSession()
  if (ADMIN_PAGES.includes(page) && !role.locked) return <PageLoading page={page} />
  switch (page) {
    case 'cases':
    case 'talk': return can('order.view') ? <Library key={me.id + page} kind={page === 'cases' ? 'case' : 'talk'} /> : null
    case 'reviews': return role.locked || (can('order.view') && me.canWrite) ? <Reviews key={me.id} /> : null
    case 'home': return <Dashboard />
    case 'tasks': return <TasksPage />
    case 'aftersales': return <AfterSalesPage selectedId={state.afterSaleId} onSelect={state.setAfterSaleId} tabs={<TaskTabs view="aftersales" />} />
    case 'orders': return <OrdersPage />
    case 'inquiries': return <InquiriesPage />
    case 'contractors': return role.locked ? <ContractorsPage /> : null
    case 'channels': return <ChannelsPage initialId={state.channelId} focusToken={state.channelFocus} />
    case 'income': return <IncomePage />
    case 'forum': return <ForumPage />
    case 'dm': return <DmPage />
    case 'toolbox': return <ToolboxPage seed={state.rewriteSeed} clearSeed={state.clearRewriteSeed} />
    case 'settle': return <PayrollPage />
    case 'settings': return <SettingsPage />
    case 'roles': return <RolesPage />
    case 'audit': return <AuditPage />
    case 'trash': return <TrashPage />
    // The assistant stays mounted in the shared shell so a route change never discards its conversation.
    case 'assistant': return null
  }
}
