import { useCallback, useEffect, useState } from 'react'

export async function request<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method, cache: 'no-store', signal,
    ...(body instanceof FormData ? {body} : body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败，请重试')
  return data
}

export function useWorkData<T>(url: string | null, scope: string, version = 0) {
  const [seq, bump] = useState(0)
  const reload = useCallback(() => bump(n => n + 1), [])
  const key = scope + ':' + url
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>()
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    request<T>(url, 'GET', undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data })
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setResult({ key, error: error.message })
    })
    return () => controller.abort()
  }, [key, url, seq, version])
  return { data: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined, reload }
}
