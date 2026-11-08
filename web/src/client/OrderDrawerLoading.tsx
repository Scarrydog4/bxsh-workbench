import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

export function OrderDrawerLoading({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} onOpenChange={value => { if (!value) onClose() }}>
    <SheetContent side="right" onOpenAutoFocus={event => event.preventDefault()} className="flex w-full flex-col gap-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] max-sm:top-[var(--workbench-top,0px)] max-sm:bottom-auto max-sm:h-[var(--workbench-height,100dvh)] sm:max-w-[680px]">
      <div className="flex h-12 shrink-0 items-center border-b px-6">
        <SheetTitle className="text-sm">订单详情</SheetTitle>
        <SheetDescription className="sr-only">正在加载订单详情</SheetDescription>
      </div>
      <div role="status" aria-label="正在加载订单详情" className="space-y-6 overflow-hidden p-6" data-order-loading>
        <div className="h-7 w-3/4 rounded bg-muted" />
        <div className="grid grid-cols-3 gap-4 rounded-xl border p-4">{[0, 1, 2].map(index => <div key={index} className="space-y-3"><div className="h-3 w-12 rounded bg-muted" /><div className="h-7 rounded bg-muted" /></div>)}</div>
        <div className="h-10 rounded-lg border" />
        {[0, 1, 2, 3].map(index => <div key={index} className="space-y-3"><div className="h-3 w-16 rounded bg-muted" /><div className="h-14 rounded-lg bg-muted/60" /></div>)}
      </div>
    </SheetContent>
  </Sheet>
}
