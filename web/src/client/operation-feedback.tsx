'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, CircleNotch, WarningCircle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export type ActionResult = { status: 'success' | 'error' | 'uncertain'; message?: string }
export type ActionOptions = {
  silent?: boolean
  onResult?: (result: ActionResult) => void
  /** Confirmed by the server; an optional brief acknowledgement before refreshing. */
  onConfirmed?: () => void | Promise<void>
}
export type OperationState = { status: 'idle' | 'saving' | 'uploading' | ActionResult['status']; message?: string }
export const FEEDBACK_MS = { success: 1000, row: 1600 } as const

/** Feedback belongs to the current edit, never to an older in-flight request. */
export function useOperationFeedback() {
  const [state, setState] = useState<OperationState>({ status: 'idle' })
  const sequence = useRef(0)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const finish = useRef<(() => void) | undefined>(undefined)
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = undefined; finish.current?.(); finish.current = undefined }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; clear() } }, [])
  function reset() { sequence.current++; clear(); if (mounted.current) setState({ status: 'idle' }) }
  async function confirm(message = '已保存') {
    clear()
    if (!mounted.current) return
    setState({ status: 'success', message })
    await new Promise<void>(resolve => {
      finish.current = resolve
      timer.current = setTimeout(() => { timer.current = undefined; finish.current = undefined; resolve() }, FEEDBACK_MS.success)
    })
  }
  async function run(task: (report: (result: ActionResult) => void) => Promise<boolean>, labels: { saving?: string; success?: string } = {}) {
    const current = ++sequence.current
    clear()
    setState({ status: 'saving', message: labels.saving ?? '保存中' })
    let reported: ActionResult | undefined
    let saved = false
    try { saved = await task(result => { reported = result }) }
    catch { reported = { status: 'uncertain', message: '结果尚未确认，内容已保留，请核对后重试' } }
    if (!mounted.current || current !== sequence.current) return saved
    const result: ActionResult = saved ? { status: 'success', message: labels.success ?? '已保存' } : reported ?? { status: 'error', message: '未能保存，内容已保留，可重试' }
    setState(result)
    if (result.status === 'success') timer.current = setTimeout(() => { if (mounted.current && sequence.current === current) setState({ status: 'idle' }) }, FEEDBACK_MS.success)
    return saved
  }
  return { state, run, reset, confirm }
}

export function OperationStatus({ state, className, compact = false }: { state: OperationState; className?: string; compact?: boolean }) {
  const pending = state.status === 'saving' || state.status === 'uploading'
  const failed = state.status === 'error' || state.status === 'uncertain'
  const message = compact && failed ? state.status === 'uncertain' ? '结果待核对' : '未保存，请重试' : state.message ?? (pending ? '保存中' : failed ? '请重试' : '已保存')
  return <span role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'} aria-atomic="true" aria-label={compact && state.status !== 'idle' ? state.message : undefined} title={compact ? state.message : undefined} className={cn('operation-status inline-flex min-h-5 min-w-20 items-center gap-1 text-xs', compact && 'whitespace-nowrap text-[10px]', failed ? 'text-warn' : state.status === 'success' ? 'text-ok' : 'text-muted-foreground', className)}>
    {state.status !== 'idle' && <>{pending ? <CircleNotch size={13} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : failed ? <WarningCircle size={13} className="shrink-0" aria-hidden="true" /> : <Check size={13} className="shrink-0" aria-hidden="true" />}<span>{message}</span></>}
  </span>
}
