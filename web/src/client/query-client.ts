import { QueryClient } from '@tanstack/react-query'

export const READ_STALE_TIME = 30_000

// Memory only. Account/permission changes clear this client; no disk persistence.
export const readQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: READ_STALE_TIME,
      gcTime: 60_000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})

export const reportQueryKey = (key: string) => ['read', key] as const

export function invalidateAfterSaleTasks() {
  const filter = { queryKey: ['aftersales'] }
  // Cancel even an initial request: a response started before a write cannot win.
  void readQueryClient.cancelQueries(filter)
  void readQueryClient.invalidateQueries(filter)
}
