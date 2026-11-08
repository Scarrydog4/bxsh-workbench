import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, writes: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>() }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = initial
    return [hooks.slots[i], (next: unknown) => { hooks.writes++; hooks.slots[i] = next }]
  },
  useRef: (current: unknown) => { const i = hooks.cursor++; return hooks.slots[i] ??= { current } },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const i = hooks.cursor++, previous = hooks.effects.get(i)
    if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
      previous?.cleanup?.()
      hooks.effects.set(i, { deps, cleanup: effect() || undefined })
    }
  },
}))

import { useCopyFeedback } from '@/client/copy-feedback'
const render = (scope = 'order') => { hooks.cursor = 0; return useCopyFeedback(scope) }
function pending() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function unmount() { hooks.effects.forEach(effect => effect.cleanup?.()); hooks.effects.clear() }
beforeEach(() => vi.useFakeTimers())
afterEach(() => { unmount(); hooks.slots = []; hooks.cursor = 0; hooks.writes = 0; vi.clearAllTimers(); vi.useRealTimers() })

it('保留 Safari 点击手势同步写剪贴板，确认后显示一秒对勾', async () => {
  const request = pending(), write = vi.fn(() => request.promise)
  const result = render().copy(write)
  expect(write).toHaveBeenCalledOnce()
  expect(render().state).toBe('copying')
  expect(vi.getTimerCount()).toBe(0)
  request.resolve()
  expect(await result).toBe(true)
  expect(render().state).toBe('copied')
  await vi.advanceTimersByTimeAsync(999)
  expect(render().state).toBe('copied')
  await vi.advanceTimersByTimeAsync(1)
  expect(render().state).toBe('idle')
})

it('连续成功复制从最后一次成功重新计时，挂起期间不会重复写', async () => {
  const request = pending(), write = vi.fn(() => request.promise)
  const first = render().copy(write)
  expect(await render().copy(write)).toBeUndefined()
  expect(write).toHaveBeenCalledOnce()
  request.resolve(); await first
  await vi.advanceTimersByTimeAsync(700)
  await render().copy(async () => {})
  await vi.advanceTimersByTimeAsync(300)
  expect(render().state).toBe('copied')
  await vi.advanceTimersByTimeAsync(700)
  expect(render().state).toBe('idle')
})

it('同步拒绝或异步拒绝都返回失败，不显示成功，随后可以重试', async () => {
  expect(await render().copy(() => { throw new Error('unsupported') })).toBe(false)
  expect(render().state).toBe('idle')
  expect(await render().copy(() => Promise.reject(new Error('permission denied')))).toBe(false)
  expect(render().state).toBe('idle')
  expect(vi.getTimerCount()).toBe(0)
  expect(await render().copy(async () => {})).toBe(true)
})

it('换订单或收款码后旧请求不会把新资源标成复制成功', async () => {
  const request = pending()
  const old = render('wechat-v1').copy(() => request.promise)
  render('wechat-v2')
  request.resolve()
  expect(await old).toBeUndefined()
  expect(render('wechat-v2').state).toBe('idle')
  expect(vi.getTimerCount()).toBe(0)
  expect(await render('wechat-v2').copy(async () => {})).toBe(true)
})

it('卸载清理计时器，挂起的复制完成后不再更新状态或触发降级', async () => {
  await render().copy(async () => {})
  expect(vi.getTimerCount()).toBe(1)
  const request = pending(), result = render().copy(() => request.promise)
  unmount()
  const writes = hooks.writes
  request.resolve()
  expect(await result).toBeUndefined()
  expect(hooks.writes).toBe(writes)
  expect(vi.getTimerCount()).toBe(0)
})
