import type { Feedback, FeedbackList } from '@/shared/feedback'

/** 与通用表格共用本地搜索和筛选，先取齐当前账号有权查看的记录。 */
export async function fetchFeedback(signal?: AbortSignal): Promise<Feedback[]> {
  const rows: Feedback[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const response = await fetch(`/api/feedback?limit=100&offset=${offset}`, { cache: 'no-store', signal })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? '反馈加载失败')
    const page = data as FeedbackList
    rows.push(...page.rows)
    offset = page.next
  }
  return [...new Map(rows.map(row => [row.id, row])).values()]
}
