import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ theme: 'system', cleanups: [] as (() => void)[] }))
vi.mock('react', async () => ({ ...await vi.importActual('react'),
  useEffect: (effect: () => void) => effect(),
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, get: () => boolean) => { h.cleanups.push(subscribe(() => {})); return get() },
}))
vi.mock('@/client/prefs', () => ({ usePref: () => [h.theme, (value: string) => { h.theme = value }] }))

let reduced = false
let darkSystem = false
let dataset: Record<string, string>
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }
let start: ReturnType<typeof vi.fn>
let pending: (() => void)[]
let skip: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules(); h.theme = 'system'; reduced = false; darkSystem = false; pending = []; dataset = {}
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  skip = vi.fn()
  start = vi.fn((update: () => void) => {
    let done!: () => void
    const finished = new Promise<void>(resolve => { done = resolve })
    pending.push(() => { update(); done() })
    return { ready: Promise.resolve(), finished, skipTransition: skip }
  })
  vi.stubGlobal('window', { matchMedia: (query: string) => query.includes('reduced-motion') ? { matches: reduced } : { ...media, matches: darkSystem } })
  vi.stubGlobal('document', { documentElement: { dataset, classList: { add: vi.fn(), remove: vi.fn() } }, startViewTransition: start })
  vi.stubGlobal('localStorage', { setItem: vi.fn() })
})
afterEach(() => { h.cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('多个入口只共用一个系统监听，切换一次只准备一张页面快照', async () => {
  const { useTheme } = await import('@/client/theme')
  const topbar = useTheme(); const settings = useTheme()
  expect(media.addEventListener).toHaveBeenCalledTimes(1)
  expect(localStorage.setItem).toHaveBeenCalledTimes(1)
  topbar.setTheme('dark'); settings.setTheme('dark')
  expect(start).toHaveBeenCalledTimes(1)
  pending.shift()!()
  await Promise.resolve()
  expect(dataset.theme).toBe('dark')
  expect(localStorage.setItem).toHaveBeenCalledTimes(2)
})

it('截图尚未准备好时连续切换，旧回调不会覆盖最后一次选择', async () => {
  const { useTheme } = await import('@/client/theme')
  const theme = useTheme()
  theme.setTheme('dark'); theme.setTheme('light')
  expect(dataset.theme).toBe('light')
  expect(skip).toHaveBeenCalled()
  pending.shift()!()
  expect(dataset.theme).toBe('light')
})

it('减少动态效果时立即更新；跟随系统保留系统色彩响应', async () => {
  reduced = true
  const { useTheme } = await import('@/client/theme')
  useTheme().setTheme('dark')
  expect(dataset.theme).toBe('dark')
  expect(start).not.toHaveBeenCalled()
  useTheme().setTheme('system')
  darkSystem = true
  expect(dataset.theme).toBeUndefined()
  expect(useTheme().isDark).toBe(true)
})
