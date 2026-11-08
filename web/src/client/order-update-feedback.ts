import { useEffect, type RefObject } from 'react'
import { FEEDBACK_MS } from './operation-feedback'

export function highlightOrders(orderIds: string[]) {
  window.dispatchEvent(new CustomEvent('bxsh:order-feedback', { detail: { orderIds } }))
}

/** One listener per list. Only mounted, affected rows are painted; no Boot or row state. */
export function useOrderUpdateFeedback(root: RefObject<HTMLElement | null>, scope: string) {
  useEffect(() => {
    const active = new Map<HTMLElement, ReturnType<typeof setTimeout>>()
    const queued = new Set<string>()
    let frame: number | undefined
    function changed(event: Event) {
      const ids = (event as CustomEvent<{ orderIds?: string[] }>).detail?.orderIds
      if (!ids?.length) return
      ids.forEach(id => queued.add(id))
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        root.current?.querySelectorAll<HTMLElement>('[data-order-feedback-id]').forEach(element => {
          if (!queued.has(element.dataset.orderFeedbackId ?? '') || element.classList.contains('row-fresh')) return
          clearTimeout(active.get(element))
          element.classList.add('order-updated')
          active.set(element, setTimeout(() => { element.classList.remove('order-updated'); active.delete(element) }, FEEDBACK_MS.row))
        })
        queued.clear()
      })
    }
    window.addEventListener('bxsh:changed', changed)
    window.addEventListener('bxsh:order-feedback', changed)
    return () => {
      window.removeEventListener('bxsh:changed', changed)
      window.removeEventListener('bxsh:order-feedback', changed)
      if (frame !== undefined) cancelAnimationFrame(frame)
      active.forEach((timer, element) => { clearTimeout(timer); element.classList.remove('order-updated') })
    }
  }, [root, scope])
}
