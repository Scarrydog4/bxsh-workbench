import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ state: false }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: () => [h.state, (next: boolean) => { h.state = next }],
}))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))

import { AppDialogContent, useAppDialogDismiss } from '@/components/ui/app-dialog'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : ''
const content = (size: 'sm' | 'md' | 'lg') => nodes((AppDialogContent as any).render({ size }, null)).find(node => node.props['data-app-dialog-size'])
afterEach(() => { h.state = false; vi.clearAllMocks() })

it('桌面三档受视口约束，lg固定；手机小中号为90dvh底部安全区，大号仍留背景', () => {
  expect(content('sm').props.className).toContain('420px')
  expect(content('sm').props.className).toContain('sm:max-h-[70dvh]')
  expect(content('md').props.className).toContain('640px')
  expect(content('md').props.className).toContain('sm:max-h-[min(720px,calc(100dvh-80px))]')
  for (const size of ['sm', 'md'] as const) {
    expect(content(size).props.className).toContain('max-h-[90dvh]')
    expect(content(size).props.className).toContain('bottom-0')
    expect(content(size).props.className).toContain('pb-[env(safe-area-inset-bottom)]')
  }
  expect(content('lg').props.className).toContain('sm:h-[min(620px,calc(100dvh-80px))]')
  expect(content('lg').props.className).toContain('h-[calc(100dvh-96px)]')
  expect(content('lg').props.className).toContain('w-[calc(100vw-24px)]')
})

it('动画只有150ms淡入缩放，不继承全局Dialog的位移；点toast不会误关', () => {
  const outside = vi.fn(), tree = nodes((AppDialogContent as any).render({ onInteractOutside: outside }, null)).find(node => node.props['data-app-dialog-size'])
  expect(tree.props.className).toContain('duration-150')
  expect(tree.props.className).toContain('zoom-in-95')
  expect(tree.props.className).not.toMatch(/slide-(in|out)/)
  const preventDefault = vi.fn()
  tree.props.onInteractOutside({ target: { closest: () => true }, preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(outside).not.toHaveBeenCalled()
})

it('开关动画每一帧沿用响应式定位：居中为-50%，底部表单Y为0', () => {
  for (const size of ['sm', 'md', 'lg'] as const) {
    const frame = content(size)
    expect(frame.props.className).toContain('-translate-x-1/2')
    for (const phase of ['enter', 'exit']) {
      expect(frame.props.style[`--tw-${phase}-translate-x`]).toBe('var(--tw-translate-x)')
      expect(frame.props.style[`--tw-${phase}-translate-y`]).toBe('var(--tw-translate-y)')
    }
    if (size === 'lg') expect(frame.props.className).toContain('-translate-y-1/2')
    else {
      expect(frame.props.className).toContain('translate-y-0')
      expect(frame.props.className).toContain('sm:-translate-y-1/2')
    }
  }
})

it('未保存先确认，继续填写不关闭，确认才放弃；提交期间不能误关', () => {
  const changed = vi.fn(), discarded = vi.fn()
  const render = (blocked = false, dirty = true) => useAppDialogDismiss({ dirty, blocked, onOpenChange: changed, onDiscard: discarded })
  render().requestOpenChange(false)
  expect(changed).not.toHaveBeenCalled()
  expect(render().confirmation.props.open).toBe(true)
  nodes(render().confirmation).find(node => node.type === 'button' && text(node) === '继续填写').props.onClick()
  expect(render().confirmation.props.open).toBe(false)
  expect(discarded).not.toHaveBeenCalled()
  render().requestOpenChange(false)
  nodes(render().confirmation).find(node => node.type === 'button' && text(node) === '放弃并关闭').props.onClick()
  expect(changed).toHaveBeenCalledExactlyOnceWith(false)
  expect(discarded).toHaveBeenCalledOnce()
  changed.mockClear()
  render(true).requestOpenChange(false)
  expect(changed).not.toHaveBeenCalled()
  render(false, false).requestOpenChange(false)
  expect(changed).toHaveBeenCalledExactlyOnceWith(false)
})
