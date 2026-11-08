'use client'

import { useState } from 'react'
import { Eye, EyeSlash } from '@phosphor-icons/react'
import { Toaster } from 'sonner'
import { Logo } from './Shell'
import { PasswordForm } from './Profile'
import { inputCls } from './ui'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DEV_LOGIN, DevAccounts } from './DevLogin'

export function LoginForm() {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <form
        className="grid w-full max-w-sm gap-4 rounded-2xl border bg-card p-6 shadow-sm"
        aria-describedby={error ? 'login-error' : undefined}
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy || !account.trim() || !password) return
          setBusy(true)
          setError('')
          const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: account.trim(), password }) }).catch(() => null)
          setBusy(false)
          if (!r) return setError('连不上服务器')
          const d = await r.json().catch(() => ({}))
          if (!r.ok) return setError(d.error ?? '登录失败')
          location.replace(nextUrl())
        }}
      >
        <Logo />
        <h1 className="sr-only">登录</h1>
        <label className="grid gap-1 text-xs text-muted-foreground">
          登录名
          <input id="login-account" autoFocus autoComplete="username" className={cn(inputCls, 'h-10')} value={account} aria-invalid={!!error} onChange={(e) => { setAccount(e.target.value); setError('') }} />
        </label>
        <div className="grid gap-1 text-xs text-muted-foreground">
          <label htmlFor="login-password">密码</label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className={cn(inputCls, 'h-10 pr-11')}
              value={password}
              aria-invalid={!!error}
              aria-describedby={capsLock ? 'login-caps-lock' : undefined}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              onKeyDown={(e) => setCapsLock(e.getModifierState('CapsLock'))}
              onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
              onBlur={() => setCapsLock(false)}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              aria-pressed={showPassword}
              title={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeSlash size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>
        {capsLock && <p id="login-caps-lock" role="status" className="-mt-2 text-xs text-warn">大写锁定已开启</p>}
        {error && <div id="login-error" role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        <Button type="submit" className="h-10" disabled={busy || !account.trim() || !password} aria-busy={busy}>
          {busy ? '登录中…' : '登录'}
        </Button>
        {DEV_LOGIN && (
          <div className="grid gap-2 border-t border-dashed pt-4">
            <p className="text-xs text-muted-foreground">开发预览 · 点头像直接登录</p>
            <DevAccounts />
          </div>
        )}
      </form>
    </div>
  )
}

/** 首次登录（或被重置密码后）必须先改密码 */
export function MustChange() {
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="grid w-full max-w-sm gap-4 rounded-2xl border bg-card p-6 shadow-sm">
        <Logo />
        <div>
          <h1 className="text-lg font-semibold">先改一个自己的密码</h1>
          <p className="text-sm text-muted-foreground">首次登录或密码被重置后，要换成只有你知道的密码</p>
        </div>
        <PasswordForm first onDone={() => location.replace(location.pathname + location.search)} />
      </div>
      <Toaster position="bottom-center" />
    </div>
  )
}

/** 登录后回到哪：只接受本站的相对地址 */
function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') ?? '/'
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/'
}
