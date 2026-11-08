import { createContext, useContext } from 'react'
import type { Prefill } from '@/shared/parse'
import type { CardKind } from './Cards'

export type Page = 'cases' | 'talk' | 'reviews' | 'home' | 'tasks' | 'aftersales' | 'orders' | 'channels' | 'toolbox' | 'income' | 'roles' | 'audit' | 'trash' | 'assistant' | 'settle' | 'settings' | 'forum' | 'dm'

export interface Nav {
  page: Page
  go: (p: Page) => void
  preload?: (p: Page) => void
  /** Link navigation prepares immediate feedback without starting a second router navigation. */
  prepare?: (p: Page) => void
  openChannel: (id:string)=>void
  afterSale: (id?: string) => void
  openOrder: (id: string, list?: string[], tab?: string, field?: string) => void
  newOrder: (prefill?: Prefill) => void
  palette: () => void
  cards: (orderIds: string[], kind?: CardKind) => void
  rewrite: (orderId: string, attachmentId: string) => void
}

export const NavContext = createContext<Nav>(null as unknown as Nav)
export const useNav = () => useContext(NavContext)
