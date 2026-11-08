'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { deleteOrders, restoreOrders } from './store'

/** List and drawer share one pending → acknowledged → undo flow. */
export function useDeleteOrders() {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)

  async function remove(ids: string[], onDeleted: () => void) {
    if (pending.current || !ids.length) return
    pending.current = true
    setBusy(true)
    const selected = [...ids]
    const notice = toast.loading(`正在移入回收站 · ${selected.length} 单`)
    try {
      await deleteOrders(selected, {
        silent: true,
        onResult: result => {
          if (result.status !== 'success') toast.error(result.message, { id: notice })
        },
        onConfirmed: () => {
          toast.success(`已移入回收站 ${selected.length} 单`, {
            id: notice,
            action: { label: '撤销', onClick: () => { void restoreOrders(selected) } },
          })
          onDeleted()
        },
      })
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return { busy, remove }
}
