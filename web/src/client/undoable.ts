import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { finishAfterSale } from './store'

/**
 * 「交付本次跟进」先在界面上生效，5 秒内可以撤销，过了才真正提交。
 * 关页面前还有没提交的，浏览器会先提醒。
 */
const pending = new Map<string, { timer: number; run: () => Promise<void> }>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const DELAY = 5000

if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if (!pending.size) return
    e.preventDefault()
    e.returnValue = ''
  })

export function finishLater(orderId: string, asId: string, label = '已标记交付') {
  if (pending.has(asId)) return
  const run = async () => {
    pending.delete(asId)
    emit()
    if (!(await finishAfterSale(orderId, asId))) toast.error('交付没保存上，请再点一次')
  }
  const timer = window.setTimeout(run, DELAY)
  pending.set(asId, { timer, run })
  emit()
  toast.success(label, {
    duration: DELAY,
    action: {
      label: '撤销',
      onClick: () => {
        clearTimeout(timer)
        pending.delete(asId)
        emit()
      },
    },
  })
}

export function usePendingFinish(asId: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pending.has(asId),
    () => false,
  )
}

/** 通用版：先在界面上算完成，5 秒内可撤销，过了才执行 run。 */
export function doLater(key: string, label: string, run: () => Promise<boolean>) {
  if (pending.has(key)) return
  const go = async () => {
    pending.delete(key)
    emit()
    if (!(await run())) toast.error('没保存上，请再点一次')
  }
  const timer = window.setTimeout(go, DELAY)
  pending.set(key, { timer, run: go })
  emit()
  toast.success(label, {
    duration: DELAY,
    action: {
      label: '撤销',
      onClick: () => {
        clearTimeout(timer)
        pending.delete(key)
        emit()
      },
    },
  })
}
