import { useCallback, useEffect, useState } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import type { AfterSaleTask } from '@/shared/aftersale-task'
import { businessDate } from '@/shared/format'
import type { Boot } from '@/server/bootstrap'
import { pendingAfterSaleTasks, useSession, useWorkspaceStatus } from './store'
import { readQueryClient } from './query-client'

export function afterSaleOptions(me: Pick<Boot['me'], 'id'>, role: Boot['role'], ready = true) {
  return queryOptions({
    queryKey: ['aftersales', me.id, role, businessDate(new Date())] as const,
    enabled: ready,
    queryFn: async ({ signal }): Promise<{ tasks: AfterSaleTask[] }> => {
      const response = await fetch('/api/aftersales', { cache: 'no-store', signal })
      if (!response.ok) throw new Error('跟进加载失败')
      return response.json()
    },
  })
}

export function useAfterSaleTasks() {
  const { me, role } = useSession()
  const ready = useWorkspaceStatus() === 'ready'
  const query = useQuery(afterSaleOptions(me, role, ready), readQueryClient)
  const reload = useCallback(() => {
    const filter = { queryKey: afterSaleOptions(me, role).queryKey, exact: true }
    void readQueryClient.cancelQueries(filter)
    void readQueryClient.invalidateQueries(filter)
  }, [me, role])
  return {
    tasks: pendingAfterSaleTasks(query.data?.tasks ?? []),
    error: query.error?.message ?? '',
    loading: !ready || query.isPending,
    reload,
  }
}

export function useTaskClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return now
}
