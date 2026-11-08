'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AppDialogBody, AppDialogContent, useAppDialogDismiss } from '@/components/ui/app-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Check, ClockCounterClockwise, DeviceMobile, Eye, EyeSlash, LinkSimple, Monitor, SpinnerGap, UploadSimple } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Avatar, cropAvatar, inputCls, SkeletonRows, type Who } from './ui'
import { setUserAvatar, setUserFrame, updateMe, useSession } from './store'
import { AvatarFramePicker } from './AvatarFrames'
import { AVATAR_FRAME_NAMES, avatarFrame, type AvatarFrameId } from '@/shared/avatar-frames'
import { businessDate } from '@/shared/format'
import { RANKS } from '@/shared/rank'
import { usePref } from './prefs'
import { imageFilesFromTransfer, preservePickedImages } from './image-input'
import { SettingsSection } from './SettingsSection'

const profileTabs = ['profile', 'password', 'sessions', 'resources'] as const
type ProfileTab = typeof profileTabs[number]
function settingTab(value?: string): ProfileTab { return profileTabs.includes(value as ProfileTab) ? value as ProfileTab : 'profile' }
type LoginRecord = { at: string; ok: boolean; reason: string | null; ip: string | null; ua: string | null }

/** 个人设置；公司管理入口留在主导航。 */
export function ProfileDialog({ open, onOpenChange, resources, initialTab, onTabChange }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  resources?: ReactNode
  initialTab?: string
  onTabChange?: (tab: ProfileTab) => void
}) {
  const { me, role } = useSession()
  const [savedTab, setSavedTab] = usePref<string>('profile-tab', 'profile')
  const tab = settingTab(savedTab)
  useEffect(() => {
    if (open && initialTab && settingTab(initialTab) !== tab) setSavedTab(settingTab(initialTab))
  }, [open, initialTab])
  const [name, setName] = useState(me.name)
  const [passwordDirty, setPasswordDirty] = useState(false), [passwordRevision, setPasswordRevision] = useState(0)
  const dismiss = useAppDialogDismiss({ dirty: name !== me.name || passwordDirty, onOpenChange, onDiscard: () => { setName(me.name); setPasswordDirty(false); setPasswordRevision(value => value + 1) } })
  const framePick = useRef(0)
  const [frameNotice, setFrameNotice] = useState<{ message: string; previous?: AvatarFrameId; pick: number } | null>(null)
  useEffect(() => {
    if (!frameNotice) return
    const timer = setTimeout(() => setFrameNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [frameNotice])
  useEffect(() => {
    if (!open) { ++framePick.current; setFrameNotice(null) }
  }, [open])
  async function pickFrame(frame: AvatarFrameId) {
    const previous = avatarFrame(me.frame)
    if (previous === frame) return
    const pick = ++framePick.current
    setFrameNotice(null)
    toast.dismiss(`avatar-frame-${me.id}`)
    if (!(await setUserFrame(me.id, frame)) || pick !== framePick.current) return
    setFrameNotice({ message: `已换成 ${AVATAR_FRAME_NAMES[frame]}`, previous, pick })
  }
  async function undoFrame() {
    if (!frameNotice || frameNotice.previous === undefined || frameNotice.pick !== framePick.current) return
    const { previous } = frameNotice, pick = ++framePick.current
    setFrameNotice(null)
    if (await setUserFrame(me.id, previous) && pick === framePick.current) setFrameNotice({ message: '已撤销头像框更换', pick })
  }
  const [logins, setLogins] = useState<LoginRecord[] | null>(null)
  const [loginError, setLoginError] = useState(''), [loginRevision, setLoginRevision] = useState(0)
  useEffect(() => {
    if (!open) return
    setName(me.name)
  }, [open, me.name])
  useEffect(() => {
    if (!open || tab !== 'sessions') return
    const controller = new AbortController()
    setLogins(null); setLoginError('')
    void fetch('/api/me/logins', { signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '登录记录暂时无法读取')
      if (!controller.signal.aborted) setLogins(data.filter((row: LoginRecord) => Date.parse(row.at) >= Date.now() - 30 * 86_400_000))
    }).catch(error => { if (!controller.signal.aborted) setLoginError(error instanceof Error ? error.message : '登录记录暂时无法读取') })
    return () => controller.abort()
  }, [open, tab, loginRevision])
  const [verticalTabs, setVerticalTabs] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px)')
    const sync = () => setVerticalTabs(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  const tabClass = 'h-9 shrink-0 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted/60 data-[state=active]:bg-primary/10 data-[state=active]:font-medium data-[state=active]:text-primary data-[state=active]:shadow-none sm:justify-start sm:text-sm'
  return (
    <><Dialog open={open} onOpenChange={dismiss.requestOpenChange}>
      <AppDialogContent data-profile-settings>
        <div data-profile-header className="shrink-0 border-b px-6 pb-3 pr-12 pt-5">
          <DialogTitle className="flex items-center gap-3">
            <Avatar user={me} size={36} />
            <span>
              设置
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {me.name} · {role.name} · @{me.account}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">个人资料、账号安全、登录记录与常用资源</DialogDescription>
        </div>
        <Tabs value={tab} onValueChange={value => { const next = settingTab(value); setSavedTab(next); onTabChange?.(next) }} orientation={verticalTabs ? 'vertical' : 'horizontal'} className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <TabsList aria-label="设置分类" className="mx-4 mt-3 flex h-9 shrink-0 flex-nowrap justify-start gap-1 overflow-x-auto bg-transparent p-0 [&_.tabs-indicator]:bg-primary/10 [&_.tabs-indicator]:shadow-none sm:mx-0 sm:mt-0 sm:h-auto sm:w-44 sm:flex-col sm:items-stretch sm:rounded-none sm:border-r sm:p-3">
            <TabsTrigger className={tabClass} value="profile">资料</TabsTrigger>
            <TabsTrigger className={tabClass} value="password">改密码</TabsTrigger>
            <TabsTrigger className={tabClass} value="sessions">登录记录</TabsTrigger>
            <TabsTrigger className={tabClass} value="resources">常用资源</TabsTrigger>
          </TabsList>
          <AppDialogBody data-profile-scroll className="px-6 py-5 sm:px-8 sm:py-6">
            <TabsContent value="profile" className="mt-0">
              <SettingsSection title="头像"><ProfileAvatarUpload user={me}/></SettingsSection>
              <SettingsSection title="头像框" desc={me.rank ? `今天是「${RANKS.find(rank => rank.id === me.rank)?.name ?? me.rank}」，销售按当天单量自动换框，这里选的先不显示。` : '选择喜欢的头像框，随时可以更换。'}>
                <AvatarFramePicker user={me} heading={false} onPick={frame => { void pickFrame(frame) }}/>
              </SettingsSection>
              <SettingsSection title="显示名" desc="同事在订单和消息中看到的名字。">
              <form
                className="grid gap-1.5"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (name.trim() && name !== me.name && (await updateMe(name.trim()))) toast.success('显示名已改')
                }}
              >
                <div className="flex gap-2">
                  <input id="pf-name" aria-label="显示名" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
                  <Button type="submit">保存</Button>
                </div>
              </form>
              </SettingsSection>
            </TabsContent>
            <TabsContent value="password" forceMount className="mt-0 data-[state=inactive]:hidden">
              <SettingsSection title="修改密码" desc="修改后其他设备会退出登录。"><PasswordForm key={passwordRevision} onDirtyChange={setPasswordDirty}/></SettingsSection>
            </TabsContent>
            <TabsContent value="sessions" className="mt-0">
              <SettingsSection title="登录记录" desc="最近 30 天的登录记录。时间为北京时间；地点未记录时不显示。">
              {loginError ? <div role="alert" className="rounded-lg border p-4 text-sm"><p>{loginError}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setLoginRevision(value => value + 1)}>重新加载</Button></div> : !logins ? (
                <SkeletonRows rows={3}/>
              ) : !logins.length ? <div className="grid min-h-48 justify-items-center content-center gap-3 text-sm text-muted-foreground"><ClockCounterClockwise size={30}/><span>最近 30 天没有登录记录</span></div> : (
                <ul className="divide-y">
                  {logins.map((l, i) => (
                    <li key={`${l.at}-${i}`} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                      <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground">{/iPhone|iPad|Android/i.test(l.ua ?? '') ? <DeviceMobile size={20}/> : <Monitor size={20}/>}</span>
                      <div className="min-w-0"><p className="break-words text-sm font-medium" title={l.ua ?? ''}>{device(l.ua)}</p><p className={cn('mt-1 text-xs', l.ok ? 'text-muted-foreground' : 'text-danger')}>{l.ok ? '登录成功' : l.reason ?? '登录失败'}</p></div>
                      <p className="num col-start-2 min-w-0 break-all text-xs text-muted-foreground sm:col-start-auto">{l.ip ? `IP ${l.ip}` : 'IP 未记录'}</p>
                      <time dateTime={l.at} className="col-start-2 whitespace-nowrap text-xs leading-5 text-muted-foreground sm:col-start-auto sm:text-right">{businessDate(l.at)}<br className="hidden sm:block"/><span className="sm:hidden"> </span>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(l.at))}</time>
                    </li>
                  ))}
                </ul>
              )}
              </SettingsSection>
            </TabsContent>
            <TabsContent value="resources" className="mt-0"><SettingsSection title="常用资源" desc="客户端和工作中常用的资料。">
              {resources ? <div className="[&>section>h2]:hidden [&>section>div.grid]:grid-cols-1 sm:[&>section>div.grid]:grid-cols-2">{resources}</div> : <div className="grid min-h-48 justify-items-center content-center gap-3 text-sm text-muted-foreground"><LinkSimple size={30}/><span>还没有常用资源</span></div>}
            </SettingsSection></TabsContent>
          </AppDialogBody>
        </Tabs>
        {frameNotice && <div role="status" aria-live="polite" className="mx-6 mb-4 flex shrink-0 items-center justify-between gap-4 rounded-xl border border-primary/25 bg-card px-4 py-3 text-sm shadow-sm">
          <span>{frameNotice.message}</span>
          {frameNotice.previous !== undefined && <Button type="button" variant="outline" size="sm" onClick={() => { void undoFrame() }}>撤销</Button>}
        </div>}
      </AppDialogContent>
    </Dialog>{dismiss.confirmation}</>
  )
}

function device(ua: string | null) {
  if (!ua) return '未知设备'
  const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? '安卓' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '其他'
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '浏览器'
  return `${os} · ${br}`
}

export function ProfileAvatarUpload({ user }: { user: Who }) {
  const input = useRef<HTMLInputElement>(null), saving = useRef(false)
  const [busy, setBusy] = useState(false), [over, setOver] = useState(false)
  async function take(files: File[]) {
    if (!files.length || saving.current) return
    saving.current = true; setBusy(true)
    try {
      const cropped = await cropAvatar(files[0])
      if (!cropped) { toast.error('图片无法读取，请重新选择'); return }
      if (await setUserAvatar(user.id, cropped)) toast.success('头像已更新')
    } catch { toast.error('头像未保存，请重试') }
    finally { saving.current = false; setBusy(false) }
  }
  return <div data-profile-avatar tabIndex={0} role="group" aria-label="上传或粘贴头像" aria-keyshortcuts="Meta+V Control+V" aria-busy={busy}
    onPaste={event => { const files = imageFilesFromTransfer(event.clipboardData); if (files.length) { event.preventDefault(); event.stopPropagation(); void take(files) } }}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); setOver(true) }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false) }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); setOver(false); void take(imageFilesFromTransfer(event.dataTransfer)) }}
    onClick={event => { if (!(event.target as HTMLElement).closest('button,input')) event.currentTarget.focus({ preventScroll: true }) }}
    className={cn('flex items-center gap-5 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/40', over && 'bg-primary/5 ring-2 ring-primary/40')}>
    <div className="relative shrink-0"><Avatar user={user} size={96}/>{busy && <span className="absolute inset-0 grid place-items-center rounded-full bg-background/80"><SpinnerGap size={26} className="animate-spin"/></span>}</div>
    <div className="min-w-0"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}><UploadSimple size={16}/>{busy ? '上传中…' : '上传'}</Button><p className="mt-2 text-xs leading-5 text-muted-foreground">支持粘贴 ⌘/Ctrl+V<br/>也可以将图片拖到这里</p></div>
    <input ref={input} type="file" accept="image/*" aria-label="头像图片文件" className="hidden" disabled={busy} onChange={async event => { const target = event.currentTarget; try { const files = await preservePickedImages(Array.from(target.files ?? [])); target.value = ''; await take(files) } catch { toast.error('图片无法读取，请重新选择') } }}/>
  </div>
}

export function PasswordForm({ onDone, first, onDirtyChange }: { onDone?: () => void; first?: boolean; onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const dirty = !!(current || next || again)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const rules = [{ label: '至少 8 位', ok: next.length >= 8 }, { label: '包含字母', ok: /[A-Za-z]/.test(next) }, { label: '包含数字', ok: /\d/.test(next) }]
  const valid = current.length > 0 && rules.every(rule => rule.ok) && next === again
  const passwordInput = (id: string, label: string, value: string, onChange: (value: string) => void, autocomplete: string) => <label htmlFor={id} className="grid gap-1.5 text-sm">
    {label}
    <span className="relative"><input id={id} type={visible?.[id] ? 'text' : 'password'} autoComplete={autocomplete} className={cn(inputCls, 'pr-10')} disabled={busy} value={value} onChange={event => onChange(event.target.value)} aria-invalid={id === 'pw-again' && !!again && next !== again} aria-describedby={id === 'pw-new' ? 'password-rules' : id === 'pw-again' && !!again && next !== again ? 'password-mismatch' : undefined}/><button type="button" aria-label={`${visible?.[id] ? '隐藏' : '显示'}${label}`} aria-pressed={!!visible?.[id]} onClick={() => setVisible(old => ({ ...old, [id]: !old[id] }))} className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{visible?.[id] ? <EyeSlash size={18}/> : <Eye size={18}/>}</button></span>
  </label>
  return (
    <form
      className="grid w-full max-w-[400px] gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (busy || !valid) return
        setBusy(true)
        try {
          const r = await fetch('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current, next }) })
          const d = await r.json().catch(() => ({}))
          if (!r.ok) return toast.error(d.error ?? '没改成功')
          setCurrent(''); setNext(''); setAgain(''); setVisible({})
          toast.success('密码已修改', { description: '其他设备上的登录已失效' })
          onDone?.()
        } catch {
          toast.error('连接中断，请恢复网络后重试；如密码已生效，请用新密码登录')
        } finally {
          setBusy(false)
        }
      }}
    >
      {passwordInput('pw-cur', first ? '临时密码' : '当前密码', current, setCurrent, 'current-password')}
      <div className="grid gap-2">{passwordInput('pw-new', '新密码', next, setNext, 'new-password')}<ul id="password-rules" className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-live="polite">{rules.map(rule => <li key={rule.label} className={cn('inline-flex items-center gap-1', rule.ok ? 'text-ok' : 'text-muted-foreground')}><Check size={13} aria-hidden/>{rule.label}</li>)}</ul></div>
      <div className="grid gap-2">{passwordInput('pw-again', '确认新密码', again, setAgain, 'new-password')}{again && next !== again && <p id="password-mismatch" role="alert" className="text-xs text-danger">两次输入的新密码不一致</p>}</div>
      <Button type="submit" className="w-auto justify-self-start px-5" disabled={busy || !valid} aria-busy={busy}>
        {busy && <SpinnerGap size={16} className="animate-spin"/>}{busy ? '保存中…' : '修改密码'}
      </Button>
    </form>
  )
}
