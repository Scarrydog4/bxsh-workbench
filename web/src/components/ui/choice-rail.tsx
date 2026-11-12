'use client'
import { useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
// Motion Prompt #057 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#057
export function ChoiceRail({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number }>()
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = () => {
      const selected = root.querySelector<HTMLElement>(':scope > [aria-current="true"], :scope > [aria-selected="true"], :scope > [aria-pressed="true"]')
      if (!selected) { setBox(undefined); return }
      const next = { x: selected.offsetLeft, y: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight }
      setBox(old => old && old.x === next.x && old.y === next.y && old.width === next.width && old.height === next.height ? old : next)
    }
    const resize = new ResizeObserver(measure)
    const observe = () => { resize.disconnect(); resize.observe(root); root.querySelectorAll(':scope > button').forEach(el => resize.observe(el)); measure() }
    const changes = new MutationObserver(observe)
    changes.observe(root, { attributes: true, subtree: true, attributeFilter: ['aria-current', 'aria-selected', 'aria-pressed'], childList: true })
    observe()
    return () => { resize.disconnect(); changes.disconnect() }
  }, [])
  return <div {...props} ref={ref} data-choice-rail className={cn('choice-rail relative isolate', className)}>
    {box && <span aria-hidden="true" className="choice-rail-marker pointer-events-none absolute left-0 top-0" style={{ width: box.width, height: box.height, transform: `translate(${box.x}px, ${box.y}px)` }} />}
    {children}
  </div>
}
