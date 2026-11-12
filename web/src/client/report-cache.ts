import type { Boot } from '@/server/bootstrap'
import { businessDate } from '@/shared/format'
import { READ_STALE_TIME, readQueryClient, reportQueryKey } from './query-client'

export function clearReportCache() { readQueryClient.clear() }
export function invalidateReport(key: string) {
  const filter = { queryKey: reportQueryKey(key), exact: true }
  void readQueryClient.cancelQueries(filter)
  void readQueryClient.invalidateQueries({ ...filter, refetchType: 'none' })
}
export function reportScope(state: Pick<Boot, 'me' | 'role' | 'version'>) {
  return JSON.stringify([state.me.id, state.role, state.version, businessDate(new Date())])
}
export function cachedReport<T>(key: string): T | undefined {
  const state = readQueryClient.getQueryState<T>(reportQueryKey(key))
  return state && !state.isInvalidated && Date.now() - state.dataUpdatedAt < READ_STALE_TIME ? state.data : undefined
}
export async function fetchRead<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '数据暂时无法加载，请重试')
  return data as T
}
export function requestReport<T>(url: string, key: string): Promise<T> {
  return readQueryClient.fetchQuery({ queryKey: reportQueryKey(key), queryFn: ({ signal }) => fetchRead<T>(url, signal) })
}
export function prefetchIncomeReport(state: Boot) {
  const today = businessDate(new Date())
  const path = state.role.locked ? 'income' : 'personal-income'
  const url = `/api/reports/${path}?from=${today.slice(0, 7)}-01&to=${today}&granularity=day`
  void requestReport(url, reportScope(state) + url).catch(() => {})
}
