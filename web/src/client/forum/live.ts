'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ForumCategory } from '@/shared/forum'
import { listPosts, listThreads, onLive } from './api'

/** 从提醒、左下角卡片等地方跳到论坛或私信时，要打开哪一个。页面读完就清掉。 */
type Target = { postId?: string; threadId?: string; compose?: ForumCategory; category?: ForumCategory }
let target: Target = {}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
export function setForumTarget(next: Target) { target = next; emit() }
export function takeForumTarget() { const t = target; target = {}; return t }
export function useForumTarget() {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => target, () => target)
}

/** 私信未读总数：头像和下拉菜单上显示。打开、收到私信推送、读完时刷新。 */
let dmUnread = 0
const dmListeners = new Set<() => void>()
let dmLoading: Promise<void> | null = null
export function refreshDmUnread() {
  dmLoading ??= listThreads().then(r => { dmUnread = r.totalUnread; dmListeners.forEach(l => l()) }).catch(() => {}).finally(() => { dmLoading = null })
  return dmLoading
}
export function useDmUnread() {
  useEffect(() => { void refreshDmUnread(); return onLive('dm', () => void refreshDmUnread()) }, [])
  return useSyncExternalStore(l => { dmListeners.add(l); return () => dmListeners.delete(l) }, () => dmUnread, () => 0)
}

/** 左下角：最新一条没读的公告。 */
export function useLatestUnreadAnnouncement() {
  const [post, setPost] = useState<{ id: string; title: string } | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => listPosts({ category: 'announcement', sort: 'created', limit: 10 }).then(r => {
      const p = r.rows.find(row => row.unread)
      if (alive) setPost(p ? { id: p.id, title: p.title } : null)
    }).catch(() => {})
    void load()
    const off = onLive('post', () => void load())
    window.addEventListener('bxsh:forum-read', load)
    return () => { alive = false; off(); window.removeEventListener('bxsh:forum-read', load) }
  }, [])
  return post
}
