"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const list = React.useRef<HTMLDivElement | null>(null)
  const [indicator, setIndicator] = React.useState<{ x: number; y: number; width: number; height: number }>()
  React.useLayoutEffect(() => {
    const node = list.current
    if (!node) return
    const measure = () => {
      const active = node.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      if (!active) { setIndicator(undefined); return }
      const next = { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight }
      setIndicator(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next)
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(node)
    node.querySelectorAll('[role="tab"]').forEach(tab => resize.observe(tab))
    const selection = new MutationObserver(measure)
    selection.observe(node, { subtree: true, attributes: true, attributeFilter: ['data-state'], childList: true })
    return () => { resize.disconnect(); selection.disconnect() }
  }, [])
  return <TabsPrimitive.List
    ref={node => { list.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node }}
    data-sliding-tabs={indicator ? '' : undefined}
    className={cn(
      "sliding-tabs relative isolate inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  >
    {indicator && <span aria-hidden="true" className="tabs-indicator pointer-events-none absolute left-0 top-0 -z-10 rounded-md bg-background shadow-sm" style={{ width: indicator.width, height: indicator.height, transform: `translate(${indicator.x}px, ${indicator.y}px)` }} />}
    {children}
  </TabsPrimitive.List>
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "tab-panel-motion mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
