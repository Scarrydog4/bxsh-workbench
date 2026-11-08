import type { Boot } from '@/server/bootstrap'
import { businessDate } from '@/shared/format'

type Entry = { at: number; data?: unknown; pending?: Promise<unknown> }
const reports = new Map<string, Entry>()
const MAX_AGE = 30_000

export function clearReportCache() { reports.clear() }

export function reportScope(state: Pick<Boot, 'me' | 'role' | 'version'>) {
  return JSON.stringify([state.me.id, state.role, state.version, businessDate(new Date())])
}
export function cachedReport<T>(key: string): T | undefined {
  const entry = reports.get(key)
  return entry && Date.now() - entry.at < MAX_AGE ? entry.data as T | undefined : undefined
}
export function requestReport<T>(url: string, key: string): Promise<T> {
  const old = reports.get(key)
  if (old?.pending) return old.pending as Promise<T>
  if (old && Date.now() - old.at < MAX_AGE && old.data !== undefined) return Promise.resolve(old.data as T)
  const entry: Entry = { at: Date.now() }
  const pending = fetch(url).then(async response => {
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '收入统计暂时无法加载')
    entry.data = data
    entry.at = Date.now()
    return data as T
  }).catch(error => {
    if (reports.get(key) === entry) reports.delete(key)
    throw error
  }).finally(() => { entry.pending = undefined })
  entry.pending = pending
  reports.set(key, entry)
  if (reports.size > 24) reports.delete(reports.keys().next().value!)
  return pending
}
export function prefetchIncomeReport(state: Boot) {
  const today = businessDate(new Date())
  const path = state.role.locked ? 'income' : 'personal-income'
  const url = `/api/reports/${path}?from=${today.slice(0, 7)}-01&to=${today}&granularity=day`
  void requestReport(url, reportScope(state) + url).catch(() => {})
}
