import { useEffect, useRef, useState } from 'react'
import styles from './image-feedback.module.css'

export const imageArrivalClass = styles.arrival

/** Acknowledges accepted local images only; this does not indicate upload success. */
export function useImageReceiveFeedback() {
  const [received, setReceived] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current) } }, [])
  function acknowledge() {
    if (!mounted.current) return
    clearTimeout(timer.current)
    setReceived(true)
    timer.current = setTimeout(() => setReceived(false), 900)
  }
  return { acknowledge, className: `${styles.receiver}${received ? ` ${styles.received}` : ''}` }
}
