'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getState } from './store'

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Map<string, unknown>()

function flush(key: string) {
  if (!pending.has(key)) return
  const value = pending.get(key)
  pending.delete(key)
  clearTimeout(timers.get(key))
  timers.delete(key)
  void fetch('/api/prefs', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) })
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  for (const key of pending.keys()) flush(key)
})

function save(key: string, value: unknown) {
  const s = getState()
  if (s) s.prefs[key] = value
  queueMicrotask(() => window.dispatchEvent(new CustomEvent('bxsh:pref-change', { detail: { key, value } })))
  pending.set(key, value)
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => flush(key), 400),
  )
}

/** 个人设置：存服务器（每人一份，换电脑也在），初始值来自 /api/bootstrap */
export function usePref<T>(key: string, fallback: T) {
  const read = () => {
    const v = getState()?.prefs?.[key]
    return v === undefined || v === null ? fallback : (v as T)
  }
  const [value, setValue] = useState<T>(read)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setValue(read())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: T }>).detail
      if (detail.key === key) setValue(detail.value)
    }
    window.addEventListener('bxsh:pref-change', receive)
    return () => window.removeEventListener('bxsh:pref-change', receive)
  }, [key])
  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        save(key, v)
        return v
      })
    },
    [key],
  )
  return [value, update] as const
}

/** 布局随设备保存，不覆盖其他设备上的展示方式。 */
export function useDevicePref<T>(key:string,fallback:T){
 const fullKey=`bxsh:device:${getState()?.me.id}:${key}`
 const read=()=>{try{return JSON.parse(localStorage.getItem(fullKey)??'null')??fallback}catch{return fallback}}
 const [value,setValue]=useState<T>(read)
 useEffect(()=>setValue(read()),[fullKey])
 const update=useCallback((next:T)=>{setValue(next);try{localStorage.setItem(fullKey,JSON.stringify(next))}catch{}},[fullKey])
 return [value,update] as const
}
