'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type DialogRoute = {
  settings: string | null; dialog: string | null; get: (name: string) => string | null
  openSettings: (tab: string) => void; replaceSettings: (tab: string) => void; closeSettings: () => void
  openDialog: (kind: string, extra?: Record<string, string>) => void; closeDialog: () => void
}
const Context = createContext<DialogRoute | null>(null)
type Pending = { from: string; path: string; params: string; observed?: boolean }

/** One owner for query state keeps simultaneous header/keyboard actions from overwriting each other. */
export function DialogRouteProvider({ children }: { children: ReactNode }) {
  const router = useRouter(), pathname = usePathname() || '/', search = useSearchParams()
  const actual = search.toString(), key = pathname + '?' + actual
  const [pending, setPending] = useState<Pending | null>(null)
  const effective = pending && pending.path === pathname ? pending.params : actual
  const current = useRef({ path: pathname, params: effective, key })
  current.current = { path: pathname, params: effective, key }
  useEffect(() => {
    if (!pending) return
    if (pending.path !== pathname || (pending.params === actual && (pending.from !== key || pending.observed))) setPending(null)
    // A quick close may target the original URL before the preceding open navigation commits.
    else if (pending.from !== key && !pending.observed) setPending({ ...pending, observed: true })
  }, [pending, pathname, actual, key])
  useEffect(() => { const back = () => setPending(null); window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back) }, [])
  const update = useCallback((edit: (params: URLSearchParams) => void, replace = false) => {
    const before = current.current, params = new URLSearchParams(before.params)
    edit(params)
    const query = params.toString()
    if (query === before.params) return
    current.current = { ...before, params: query }
    setPending({ from: before.key, path: before.path, params: query })
    router[replace ? 'replace' : 'push'](before.path + (query ? '?' + query : ''), { scroll: false })
  }, [router])
  const value = useMemo<DialogRoute>(() => {
    const params = new URLSearchParams(effective)
    const settings = (tab: string, replace = false) => update(p => { p.delete('dialog'); p.delete('followupOrder'); p.delete('reimburseId'); p.set('settings', tab) }, replace)
    return {
      settings: params.get('settings'), dialog: params.has('settings') ? null : params.get('dialog'), get: name => params.get(name),
      openSettings: tab => settings(tab), replaceSettings: tab => settings(tab, true),
      closeSettings: () => update(p => p.delete('settings'), true),
      openDialog: (kind, extra = {}) => update(p => { p.delete('settings'); p.delete('followupOrder'); p.delete('reimburseId'); p.set('dialog', kind); for (const [key, value] of Object.entries(extra)) p.set(key, value) }),
      closeDialog: () => update(p => { p.delete('dialog'); p.delete('followupOrder'); p.delete('reimburseId') }, true),
    }
  }, [effective, update])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useDialogRoute() {
  const context = useContext(Context)
  if (!context) throw new Error('useDialogRoute requires DialogRouteProvider')
  return context
}
