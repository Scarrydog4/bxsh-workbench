'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { deleteOrders, restoreOrders } from './store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { inputCls } from './ui'

/** List and drawer share one pending → acknowledged → undo flow. */
export function useDeleteOrders() {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [request, setRequest] = useState<{ ids: string[]; onDeleted: () => void } | null>(null)
  const [reason, setReason] = useState('')

  function remove(ids: string[], onDeleted: () => void) {
    if (pending.current || !ids.length) return
    setReason('')
    setRequest({ ids: [...ids], onDeleted })
  }

  async function confirm() {
    if (!request || !reason.trim()) return
    const { ids, onDeleted } = request
    if (pending.current || !ids.length) return
    pending.current = true
    setBusy(true)
    const selected = [...ids]
    const notice = toast.loading(`正在移入回收站 · ${selected.length} 单`)
    try {
      await deleteOrders(selected, {
        reason: reason.trim(),
        silent: true,
        onResult: result => {
          if (result.status !== 'success') toast.error(result.message, { id: notice })
        },
        onConfirmed: () => {
          setRequest(null)
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

  const dialog = <Dialog open={!!request} onOpenChange={open => { if (!open && !busy) setRequest(null) }}>
    <DialogContent><DialogHeader><DialogTitle>删除订单{request && request.ids.length > 1 ? ` · ${request.ids.length} 单` : ''}</DialogTitle><DialogDescription>订单将移入回收站。请说明删除理由，操作人和理由会保留在记录中。</DialogDescription></DialogHeader>
      <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void confirm() }}>
        <label className="grid gap-2 text-sm font-medium">删除理由<textarea autoFocus required maxLength={500} disabled={busy} className={inputCls + ' min-h-24 resize-y'} value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：重复录入、客户取消订单" /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setRequest(null)}>取消</Button><Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>{busy ? '正在删除…' : '移入回收站'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
  return { busy, remove, dialog }
}
