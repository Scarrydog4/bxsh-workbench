import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { usePref } from './prefs'
import { SlidingSegments } from '@/components/ui/sliding-segments'

type Theme = 'light' | 'dark' | 'system'
let requestedTheme: Theme | undefined
let transition: ViewTransition | undefined
let fallbackTimer: ReturnType<typeof setTimeout> | undefined
let media: MediaQueryList | undefined
const listeners = new Set<() => void>()
const notifySystem = () => listeners.forEach(listener => listener())
const systemDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

// Topbar, mobile menu and settings share one system listener and one DOM update.
function subscribeSystem(listener: () => void) {
  listeners.add(listener)
  if (!media) {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', notifySystem)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { media?.removeEventListener('change', notifySystem); media = undefined }
  }
}

function applyTheme(next: Theme, animate = false) {
  if (requestedTheme === next) return
  requestedTheme = next
  const root = document.documentElement
  const update = () => {
    // A newer click can arrive while a snapshot is being prepared.
    if (requestedTheme !== next) return
    if (next === 'system') delete root.dataset.theme
    else root.dataset.theme = next
    try { localStorage.setItem('bxsh:theme', JSON.stringify(next)) } catch { /* Device storage can be unavailable. */ }
  }
  const previous = root.dataset.theme ?? 'system'
  const wasDark = previous === 'dark' || previous === 'system' && systemDark()
  const willBeDark = next === 'dark' || next === 'system' && systemDark()
  if (!animate || wasDark === willBeDark || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    transition?.skipTransition()
    update()
    return
  }
  // Repeated clicks stay immediate instead of queuing page snapshots.
  if (transition) { transition.skipTransition(); update(); return }
  if (document.startViewTransition) {
    root.classList.add('theme-changing')
    const current = document.startViewTransition(update)
    transition = current
    void current.ready.catch(() => { /* Hidden tabs and interrupted snapshots safely skip animation. */ })
    void current.finished.catch(() => {}).finally(() => {
      if (transition === current) { transition = undefined; root.classList.remove('theme-changing') }
    })
  } else {
    update()
    // Older browsers animate one composited surface, never each cell in a large table.
    root.classList.add('theme-fade-fallback')
    clearTimeout(fallbackTimer)
    fallbackTimer = setTimeout(() => root.classList.remove('theme-fade-fallback'), 180)
  }
}

export function useTheme() {
  const [theme, saveTheme] = usePref<Theme>('theme', 'system')
  const prefersDark = useSyncExternalStore(subscribeSystem, systemDark, () => false)
  useEffect(() => { applyTheme(theme) }, [theme])
  const setTheme = useCallback((value: Theme) => { applyTheme(value, true); saveTheme(value) }, [saveTheme])
  const isDark = theme === 'dark' || theme === 'system' && prefersDark
  return { theme, setTheme, isDark, toggle: () => setTheme(isDark ? 'light' : 'dark') }
}
export function ThemeChoice() {
  const { theme, setTheme } = useTheme()
  return <SlidingSegments label="外观" value={theme} onValueChange={setTheme} className="rounded-md border" buttonClassName="py-1.5 text-xs"
    options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }]} />
}
