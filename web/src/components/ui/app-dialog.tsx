'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Slot } from '@radix-ui/react-slot'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from './dialog'
import { Button } from './button'

export type AppDialogSize = 'sm' | 'md' | 'lg'
const sizes: Record<AppDialogSize, string> = {
  sm: 'bottom-0 top-auto w-full max-h-[90dvh] translate-y-0 rounded-t-xl rounded-b-none pb-[env(safe-area-inset-bottom)] sm:bottom-auto sm:top-1/2 sm:w-[min(420px,calc(100vw-32px))] sm:max-h-[70dvh] sm:-translate-y-1/2 sm:rounded-xl sm:pb-0',
  md: 'bottom-0 top-auto w-full max-h-[90dvh] translate-y-0 rounded-t-xl rounded-b-none pb-[env(safe-area-inset-bottom)] sm:bottom-auto sm:top-1/2 sm:w-[min(640px,calc(100vw-32px))] sm:max-h-[min(720px,calc(100dvh-80px))] sm:-translate-y-1/2 sm:rounded-xl sm:pb-0',
  lg: 'top-1/2 h-[calc(100dvh-96px)] w-[calc(100vw-24px)] -translate-y-1/2 rounded-xl sm:h-[min(620px,calc(100dvh-80px))] sm:w-[min(860px,calc(100vw-32px))]',
}

/** Shared task and management frame; only the body scrolls, no movement animation. */
export const AppDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { size?: AppDialogSize; overlayClassName?: string }
>(({ className, overlayClassName, size = 'lg', children, onInteractOutside, style, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={cn('bg-black/40 backdrop-blur-[2px] duration-150 motion-reduce:animate-none', overlayClassName)} />
    <DialogPrimitive.Content ref={ref} data-app-dialog data-app-dialog-size={size}
      // animate-in/out replace transform. Keep the responsive placement in every
      // animation frame instead of letting the plugin fall back to translate(0, 0).
      style={{
        '--tw-enter-translate-x': 'var(--tw-translate-x)',
        '--tw-enter-translate-y': 'var(--tw-translate-y)',
        '--tw-exit-translate-x': 'var(--tw-translate-x)',
        '--tw-exit-translate-y': 'var(--tw-translate-y)',
        ...style,
      } as React.CSSProperties}
      onInteractOutside={event => {
        if ((event.target as Element | null)?.closest?.('[data-sonner-toaster]')) event.preventDefault()
        else onInteractOutside?.(event)
      }}
      className={cn('fixed left-1/2 z-50 flex max-w-none -translate-x-1/2 flex-col gap-0 overflow-hidden border bg-background p-0 shadow-2xl duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 motion-reduce:animate-none', sizes[size], className)}
      {...props}>
      {children}
      <DialogPrimitive.Close aria-label="关闭" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
AppDialogContent.displayName = 'AppDialogContent'

export function AppDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <header className={cn('shrink-0 border-b px-5 py-4 pr-12 sm:px-6 sm:pr-12', className)} {...props} />
}

export function AppDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <footer className={cn('flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3 sm:px-6', className)} {...props} />
}

export const AppDialogBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }>(
  ({ className, asChild, ...props }, ref) => {
    const Component = asChild ? Slot : 'div'
    return <Component ref={ref} data-app-dialog-body className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain', className)} {...props} />
  },
)
AppDialogBody.displayName = 'AppDialogBody'

/** All dismissal paths use one guard; successful submissions may close directly. */
export function useAppDialogDismiss({ dirty, blocked = false, onOpenChange, onDiscard }: { dirty: boolean; blocked?: boolean; onOpenChange: (open: boolean) => void; onDiscard?: () => void }) {
  const [confirming, setConfirming] = React.useState(false)
  const requestOpenChange = (open: boolean) => {
    if (open) { onOpenChange(true); return }
    if (blocked) return
    if (dirty) setConfirming(true)
    else onOpenChange(false)
  }
  const confirmation = <Dialog open={confirming} onOpenChange={setConfirming}>
    <AppDialogContent size="sm" data-discard-confirmation>
      <AppDialogHeader><DialogTitle className="text-base">放弃未保存的内容？</DialogTitle></AppDialogHeader>
      <AppDialogBody className="px-5 py-4 sm:px-6"><DialogDescription>关闭后，本次未保存的内容将丢失。</DialogDescription></AppDialogBody>
      <AppDialogFooter className="justify-end">
        <Button variant="outline" onClick={() => setConfirming(false)}>继续填写</Button>
        <Button disabled={blocked} onClick={() => { if (blocked) return; setConfirming(false); onDiscard?.(); onOpenChange(false) }}>放弃并关闭</Button>
      </AppDialogFooter>
    </AppDialogContent>
  </Dialog>
  return { requestOpenChange, confirmation }
}

/** Show a dismissible frame while the requested panel's JS is still loading. */
export function AppDialogLoading({ open, onOpenChange, title, size = 'lg' }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; size?: AppDialogSize }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <AppDialogContent size={size} data-app-dialog-loading>
      <AppDialogHeader>
        <DialogTitle className="text-base">{title}</DialogTitle>
        <DialogDescription className="sr-only">正在加载{title}，可以关闭后稍后再试</DialogDescription>
      </AppDialogHeader>
      <AppDialogBody className="space-y-5 p-6" aria-busy="true">
        <p role="status" className="text-sm text-muted-foreground">正在加载…</p>
        <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
          <div className="h-9 w-2/3 rounded-md bg-muted" />
          <div className="h-24 rounded-lg bg-muted/70" />
          <div className="h-24 rounded-lg bg-muted/70" />
        </div>
      </AppDialogBody>
    </AppDialogContent>
  </Dialog>
}
