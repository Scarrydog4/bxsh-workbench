import { useEffect, useRef, useState } from 'react'

/** Keep the clipboard call in the original click gesture (required by Safari). */
export function useCopyFeedback(scope: string) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied'>('idle')
  const active = useRef(true), working = useRef(false), sequence = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    active.current = true
    working.current = false
    setState('idle')
    return () => {
      active.current = false
      sequence.current++
      clearTimeout(timer.current)
    }
  }, [scope])

  async function copy(write: () => Promise<void>): Promise<boolean | undefined> {
    if (working.current) return
    working.current = true
    const current = ++sequence.current
    clearTimeout(timer.current)
    setState('copying')
    try {
      // Do not insert an await before write: image data is already preloaded.
      await write()
      if (!active.current || current !== sequence.current) return
      setState('copied')
      timer.current = setTimeout(() => {
        if (active.current && current === sequence.current) setState('idle')
      }, 1000)
      return true
    } catch {
      if (!active.current || current !== sequence.current) return
      setState('idle')
      return false
    } finally {
      if (current === sequence.current) working.current = false
    }
  }
  return { state, copy }
}
