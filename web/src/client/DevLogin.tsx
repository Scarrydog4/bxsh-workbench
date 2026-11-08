'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Avatar } from './ui'

/** 只在本机 next dev 打开；正式构建里恒为 false，相关界面整段不进包 */
export const DEV_LOGIN = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEV_LOGIN === '1'

type DevUser = { id: string; name: string; hue: number; frame: string | null; account: string; roleName: string }

/** 开发预览：点头像直接登录成这个人，不用密码 */
export function DevAccounts({ currentId, className }: { currentId?: string; className?: string }) {
  const [list, setList] = useState<DevUser[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/api/auth/dev-login').then(r => r.ok ? r.json() : Promise.reject()).then(d => setList(d.users)).catch(() => setError('读不到账号列表'))
  }, [])
  async function pick(id: string) {
    if (busy || id === currentId) return
    setBusy(id)
    const r = await fetch('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id }) }).catch(() => null)
    if (!r?.ok) { setBusy(''); return setError((await r?.json().catch(() => null))?.error ?? '登录失败') }
    location.replace('/')
  }
  if (error) return <p className="text-xs text-danger">{error}</p>
  if (!list) return <p className="text-xs text-muted-foreground">加载账号…</p>
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {list.map(u => (
        <button key={u.id} type="button" disabled={!!busy} onClick={() => void pick(u.id)} aria-current={u.id === currentId || undefined}
          className={cn('flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60', u.id === currentId && 'border-primary bg-primary/5')}>
          <Avatar user={{ id: u.id, name: u.name, hue: u.hue, frame: u.frame ?? undefined }} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-sm">{busy === u.id ? '登录中…' : u.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{u.roleName}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
