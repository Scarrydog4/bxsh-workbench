import { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CaretDown, DownloadSimple, IdentificationCard, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { PermKey } from '@/shared/types'
import { bulkStatus, bulkWriters, deleteOrders, restoreOrders, type PublicUser } from './store'
import { PersonChoice } from './PersonChoice'
import { StatusPill } from './ui'
import { OperationStatus, useOperationFeedback, type ActionOptions } from './operation-feedback'
import { highlightOrders } from './order-update-feedback'

export function OrdersBulkActions({ ids, can, people, statuses, onDone, onCancel, cards, exportExcel }: {
  ids: string[]; can: (permission: PermKey) => boolean; people: PublicUser[]; statuses: string[]
  onDone: (ids: string[]) => void; onCancel: () => void; cards: (ids: string[]) => void; exportExcel: (ids: string[]) => unknown
}) {
  const feedback = useOperationFeedback()
  const inFlight = useRef(false)
  const reduced = useReducedMotion()
  const busy = feedback.state.status === 'saving'
  async function apply(action: (selected: string[], opts: ActionOptions) => Promise<boolean>, success: string) {
    if (inFlight.current || !ids.length) return
    inFlight.current = true
    const selected = [...ids]
    try {
      const saved = await feedback.run(report => action(selected, { silent: true, onResult: report }), { saving: `正在更新 ${selected.length} 单`, success })
      if (saved) { highlightOrders(selected); onDone(selected) }
    } finally { inFlight.current = false }
  }
  const active = ids.length > 0 || feedback.state.status !== 'idle'
  return <AnimatePresence>{active && <motion.div initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }} transition={{ type: 'tween', duration: reduced ? 0 : .18, ease: 'easeOut' }} style={{ x: '-50%' }}
    aria-busy={busy} aria-label="批量订单操作" className="fixed bottom-5 left-1/2 z-40 flex w-max max-w-[calc(100vw-24px)] flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3.5 shadow-xl shadow-black/10">
    {feedback.state.status === 'idle' ? <span className="num mr-2 whitespace-nowrap text-sm" aria-live="polite" aria-atomic="true">已选 {ids.length} 单</span> : <OperationStatus state={feedback.state} className="mr-2 max-w-full" />}
    {ids.length > 0 && <>
      {can('order.assign') && <Popover><PopoverTrigger asChild><Button disabled={busy} variant="ghost" size="sm">改写手</Button></PopoverTrigger><PopoverContent className="w-80"><fieldset disabled={busy} className={busy ? 'pointer-events-none opacity-60' : ''}><PersonChoice people={people} value="" label="批量改写手" onChange={id => apply(async (selected, opts) => !!(await bulkWriters(selected, id, opts)), '已更新所选订单的写手')} /></fieldset></PopoverContent></Popover>}
      {can('order.status') && <DropdownMenu><DropdownMenuTrigger asChild><Button disabled={busy} variant="ghost" size="sm" className="h-8 gap-1">改状态<CaretDown size={12} /></Button></DropdownMenuTrigger><DropdownMenuContent>{statuses.map(status => <DropdownMenuItem disabled={busy} key={status} onSelect={() => void apply(async (selected, opts) => (await bulkStatus(selected, status, opts)) > 0, `已改为「${status}」`)}><StatusPill status={status} /></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
      <Button disabled={busy} variant="ghost" size="sm" onClick={() => cards(ids)}><IdentificationCard size={15} />订单卡</Button>
      {can('order.export') && <Button disabled={busy} variant="ghost" size="sm" onClick={() => exportExcel(ids)}><DownloadSimple size={15} />导出</Button>}
      {can('order.delete') && <Button disabled={busy} variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => void apply(async (selected, opts) => {
        const saved = await deleteOrders(selected, opts)
        if (saved) toast(`已移入回收站 ${selected.length} 单`, { action: { label: '撤销', onClick: async () => { if (await restoreOrders(selected)) highlightOrders(selected) } } })
        return saved
      }, '已移入回收站')}><Trash size={15} />删除</Button>}
    </>}
    <button disabled={busy} onClick={() => { feedback.reset(); onCancel() }} className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40" aria-label={ids.length ? '取消选择' : '关闭操作提示'}><X size={14} /></button>
  </motion.div>}</AnimatePresence>
}
