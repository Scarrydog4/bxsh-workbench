import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getState } from '../store'
import { fetchRead, invalidateReport, reportScope } from '../report-cache'
import { readQueryClient, reportQueryKey } from '../query-client'

export async function request<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method, cache: 'no-store', signal,
    ...(body instanceof FormData ? {body} : body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败，请重试')
  return data
}

export function workDataKey(url: string | null, scope: string, version: number) {
  const actor = getState()
  return JSON.stringify(['work', actor?.me && actor?.role ? reportScope(actor) : scope, scope, version, url])
}

export function useWorkData<T>(url: string | null, scope: string, version = 0) {
  const key = workDataKey(url, scope, version)
  const query = useQuery({
    queryKey: reportQueryKey(key),
    queryFn: ({ signal }) => fetchRead<T>(url!, signal),
    enabled: !!url,
  }, readQueryClient)
  const reload = useCallback(() => {
    invalidateReport(key)
    if (url) void readQueryClient.refetchQueries({ queryKey: reportQueryKey(key), exact: true, type: 'active' })
  }, [key, url])
  return { data: url ? query.data : undefined, error: query.error?.message, reload }
}
