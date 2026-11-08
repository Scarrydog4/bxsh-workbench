import { useEffect, useState } from 'react'
import { useSession } from './store'
import { cachedReport, reportScope, requestReport } from './report-cache'

/** 缓存按账号、权限、业务版本、业务日和筛选条件隔离。 */
export function useIncomeReport<T>(url: string, revision: number) {
  const { s } = useSession()
  const key = reportScope(s) + url
  const [state, setState] = useState<{ key: string; report?: T; error?: string }>({ key, report: cachedReport<T>(key) })
  useEffect(() => {
    let active = true
    void requestReport<T>(url, key).then(report => {
      if (active) setState({ key, report })
    }).catch(error => {
      if (active) setState({ key, error: error instanceof Error ? error.message : '收入统计暂时无法加载' })
    })
    return () => { active = false }
  }, [url, key, revision])
  return { report: state.key === key ? state.report ?? null : cachedReport<T>(key) ?? null, error: state.key === key ? state.error ?? '' : '' }
}
