import { useEffect, useRef, useState } from 'react'
import { useDndMonitor } from '@dnd-kit/core'

/** Local acknowledgement only; dragging itself stays immediate. */
export function useSettledFeedback() {
  const [settled, setSettled] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  function clear() { clearTimeout(timer.current); setSettled(false) }
  function show() {
    clearTimeout(timer.current)
    setSettled(true)
    timer.current = setTimeout(() => setSettled(false), 700)
  }
  return { settled, show, clear }
}

/** Only the moved header/option updates, never the table's rows. */
export function useColumnDropFeedback(id: string) {
  const feedback = useSettledFeedback()
  useDndMonitor({
    onDragStart: () => { if (feedback.settled) feedback.clear() },
    onDragEnd: ({ active, over }) => {
      if (String(active.id) === id && over && active.id !== over.id) feedback.show()
    },
  })
  return feedback.settled
}
