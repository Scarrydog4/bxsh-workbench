import { useEffect, useState } from 'react'
import type { AssistantAnswer } from '@/shared/assistant'

export type ChatTurn = { question: string; answer: AssistantAnswer }
/** 当前浏览器会话内保留对话，切换账号或角色不会串话。 */
export function useConversation(key: string) {
  const [state, setState] = useState<{ key: string; turns: ChatTurn[] }>({ key, turns: [] })
  useEffect(() => {
    let turns: ChatTurn[] = []
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? '[]')
      if (Array.isArray(saved)) turns = saved.filter(t => typeof t?.question === 'string' && typeof t?.answer?.answer === 'string' && Array.isArray(t?.answer?.orders) && Array.isArray(t?.answer?.scopes)).slice(-30)
    } catch { /* 存储不可用时仍可继续当前对话 */ }
    setState({ key, turns })
  }, [key])
  const turns = state.key === key ? state.turns : []
  function save(next: ChatTurn[]) {
    const kept = next.slice(-30)
    setState({ key, turns: kept })
    try { sessionStorage.setItem(key, JSON.stringify(kept)) } catch { /* 不阻断提问 */ }
  }
  return [turns, save] as const
}
