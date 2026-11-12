'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowClockwise, QrCode } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'

type Attempt = { id: string; qrUrl: string; expiresAt: number }
const endpoint = '/api/toolbox/connection/wechat'

export function RewriteLogin({ onConnected }: { onConnected: () => void }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const active = useRef<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (active.current) void cancel(active.current)
    }
  }, [])

  async function cancel(id: string) {
    await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), keepalive: true }).catch(() => {})
  }
  async function start() {
    if (loading) return
    setLoading(true); setError(''); setAttempt(null)
    if (active.current) { void cancel(active.current); active.current = null }
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '获取二维码失败')
      if (!mounted.current) { void cancel(data.id); return }
      active.current = data.id
      setAttempt(data)
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '获取二维码失败，请重试') }
    finally { if (mounted.current) setLoading(false) }
  }

  useEffect(() => {
    if (!attempt) return
    let stopped = false, polling = false
    const controller = new AbortController()
    const timer = setInterval(async () => {
      if (polling || stopped) return
      if (Date.now() >= attempt.expiresAt) {
        stopped = true; setError('二维码已过期，请重新获取'); setAttempt(null)
        return
      }
      polling = true
      try {
        const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: attempt.id }), signal: controller.signal })
        const data = await response.json()
        if (stopped) return
        if (!response.ok) {
          if (response.status >= 500) return
          throw new Error(data.error ?? '登录暂未完成，请重新扫码')
        }
        if (data.status === 'connected') {
          stopped = true; active.current = null
          onConnected()
        }
      } catch (e) {
        if (!stopped && !controller.signal.aborted && e instanceof Error && e.name !== 'TypeError') {
          stopped = true; setError(e.message); setAttempt(null)
        }
      } finally { polling = false }
    }, 2000)
    return () => { stopped = true; clearInterval(timer); controller.abort() }
  }, [attempt, onConnected])

  return <div className="grid gap-3 rounded-xl bg-muted/50 p-4">
    <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">微信扫码登录</span><Button size="sm" variant="outline" disabled={loading} onClick={() => void start()}>{attempt || error ? <ArrowClockwise size={15} /> : <QrCode size={15} />}{loading ? '正在获取…' : attempt || error ? '刷新二维码' : '获取登录二维码'}</Button></div>
    {attempt && <><div className="mx-auto overflow-hidden rounded-lg bg-white"><iframe title="写作牛微信登录二维码" src={attempt.qrUrl} className="h-[310px] w-[300px] max-w-full border-0" referrerPolicy="no-referrer" /></div><p role="status" className="text-center text-sm text-muted-foreground">请使用原绑定账号的微信扫码，并在手机上确认。</p></>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!attempt && !error && <p className="text-xs text-muted-foreground">扫码确认后自动恢复工具连接。</p>}
  </div>
}
