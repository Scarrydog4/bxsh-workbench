'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrderView } from '@/shared/types'

/** 订单编号末尾 4 位是全局流水号：比上次离开订单页时见过的最大号大，就算新单。按人存在本机。 */
const serial = (no: string) => Number(no.slice(-4)) || 0
const key = (uid: string) => `bxsh:orders-seen:${uid}`
function read(uid: string) {
  try { const v = localStorage.getItem(key(uid)); return v === null ? null : Number(v) } catch { return null }
}
function write(uid: string, n: number) {
  try { localStorage.setItem(key(uid), String(n)) } catch { /* 无痕窗口存不了，下次照样不显示圆点 */ }
}

/** 第一次进订单页不显示圆点；打开过的单圆点消失；离开订单页（或关掉页面）时记下最大号。 */
export function useFreshOrders(uid: string, views: readonly Pick<OrderView, 'id' | 'no'>[]) {
  const [since] = useState(() => read(uid))
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const latest = useRef(views)
  latest.current = views
  useEffect(() => {
    const save = () => {
      const max = Math.max(0, ...latest.current.map(v => serial(v.no)))
      if (max > (read(uid) ?? -1)) write(uid, max)
    }
    window.addEventListener('pagehide', save)
    return () => { window.removeEventListener('pagehide', save); save() }
  }, [uid])
  const fresh = useMemo(() => since === null ? new Set<string>() : new Set(views.filter(v => serial(v.no) > since && !opened.has(v.id)).map(v => v.id)), [since, views, opened])
  const seen = useMemo(() => (id: string) => setOpened(s => s.has(id) ? s : new Set(s).add(id)), [])
  return { fresh, seen }
}
