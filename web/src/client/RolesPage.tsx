import { useEffect, useRef, useState } from 'react'
import { HeaderBar, Segmented } from './controls'
import { PercentInput } from './PercentInput'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Lock, Plus, ShieldCheck, Trash, Eye, EyeSlash, CaretDown, CopySimple } from '@phosphor-icons/react'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DataTable, TableFooter, TablePageHeader } from './table-kit'
import type { FieldGroups, Role, SalesMode, Visibility } from '@/shared/types'
import { FIELD_GROUPS, PERM_GROUPS, ROW_SCOPES } from '@/shared/perm'
import { Avatar, AvatarButton, inputCls } from './ui'
import { salesModeLabel } from './SalesModeBadge'
import { createRole, createUser, deleteRole, forceLogout, resetPassword, saveRole, setDefaultWriter, setUserAvatar, setUserCanWrite, setUserRole, updateUser, useSession } from './store'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

export function RolesPage() {
  const { s, me, role } = useSession()
  const [pane, setPane] = useState<'accounts' | 'roles'>('accounts')
  const [selId, setSelId] = useState(s.roles[1]?.id ?? s.roles[0].id)
  const [draft, setDraft] = useState<Role | null>(null)
  const sel = draft ?? s.roles.find((r) => r.id === selId) ?? s.roles[0]
  const dirty = !!draft

  useEffect(() => setDraft(null), [selId])

  const edit = (patch: Partial<Role>) => setDraft({ ...sel, ...patch })
  const setField = <K extends keyof FieldGroups>(k: K, v: FieldGroups[K]) => edit({ fields: { ...sel.fields, [k]: v } })

  async function newRole() {
    const r = await createRole({
      name: '新角色',
      locked: false,
      preset: false,
      perms: ['order.view'],
      fields: { sales: false, writerPay: 'none', commission: 'none', profit: false, channelNo: false },
      rowScope: 'ownedOrAssigned',
    })
    if (!r) return
    setSelId(r.id)
    toast.success('已新建角色，勾选权限后保存')
  }
  const [secret, setSecret] = useState<{ name: string; pw: string } | null>(null)
  const [adding, setAdding] = useState(false)

  const members = s.users.filter((u) => u.roleId === sel.id)

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <TablePageHeader title="角色与账号" summary={`${s.users.length} 个账号 · ${s.roles.length} 个角色`}>
        {pane === 'accounts' && <Button size="sm" className="h-8 gap-1.5" onClick={() => setAdding(true)}><Plus size={14} weight="bold"/>新建账号</Button>}
      </TablePageHeader>
      <HeaderBar><Segmented label="账号与权限" value={pane} onChange={setPane} items={[['accounts', '账号'], ['roles', '角色权限']]} /></HeaderBar>

      {pane === 'roles' && <div className="order-grid-scroll min-h-0 flex-1 overflow-auto p-3"><div className="grid gap-3 lg:grid-cols-[180px_1fr]">
        {/* 角色列表 */}
        <div className="flex gap-1 overflow-x-auto lg:flex-col">
          {s.roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelId(r.id)}
              className={cn('relative flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors', selId === r.id ? 'text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
            >
              {selId === r.id && <motion.span layoutId="role-sel" className="absolute inset-0 rounded-lg border bg-card shadow-sm" />}
              <ShieldCheck size={16} weight={selId === r.id ? 'duotone' : 'regular'} className={cn('relative', selId === r.id && 'text-primary')} />
              <span className="relative flex-1 truncate">{r.name}</span>
              {r.locked && <Lock size={12} className="relative" />}
              <span className="num relative text-xs text-muted-foreground">{s.users.filter((u) => u.roleId === r.id).length}</span>
            </button>
          ))}
          <button onClick={newRole} className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] text-primary hover:bg-primary/10">
            <Plus size={14} weight="bold" /> 新建角色
          </button>
        </div>

        {/* 编辑器 */}
        <div className="min-w-0 rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <input
              id="role-name"
              aria-label="角色名称"
              disabled={sel.locked}
              className={cn(inputCls, 'h-9 w-48 text-base font-medium disabled:border-transparent disabled:bg-transparent disabled:px-0')}
              value={sel.name}
              onChange={(e) => edit({ name: e.target.value })}
            />
            {sel.preset && <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">预置</span>}
            <div className="ml-auto flex items-center gap-2">
              {!sel.preset && (
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-danger hover:text-danger" onClick={() => void deleteRole(sel.id).then((ok) => ok && setSelId(s.roles[0].id))}>
                  <Trash size={14} /> 删除
                </Button>
              )}
              <AnimatePresence>
                {dirty && (
                  <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="flex gap-2">
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => setDraft(null)}>
                      放弃
                    </Button>
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={async () => {
                        if (await saveRole(sel)) {
                          setDraft(null)
                          toast.success(`「${sel.name}」已保存，立即生效`)
                        }
                      }}
                    >
                      保存
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {sel.locked ? (
            <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
              <Lock size={18} /> 管理员拥有全部权限，不可修改。
            </div>
          ) : (
            <div className="grid gap-4 p-3">
              <section>
                <h3 className="mb-2 text-sm font-medium">订单范围</h3>
                <div className="flex flex-wrap gap-2">
                  {ROW_SCOPES.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => edit({ rowScope: r.value })}
                      className={cn('rounded-lg border px-3 py-1.5 text-sm transition-colors', sel.rowScope === r.value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-medium">能看到哪些字段</h3>
                <div className="divide-y rounded-lg border">
                  {FIELD_GROUPS.map((g) => {
                    const val = sel.fields[g.key]
                    return (
                      <div key={g.key} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                        {val && val !== 'none' ? <Eye size={16} className="text-primary" /> : <EyeSlash size={16} className="text-muted-foreground" />}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{g.label}</div>
                          <div className="text-xs text-muted-foreground">{g.hint}</div>
                        </div>
                        {g.tri ? (
                          <div className="flex rounded-md border p-0.5">
                            {(['none', 'own', 'all'] as Visibility[]).map((x) => (
                              <button
                                key={x}
                                onClick={() => setField(g.key as 'writerPay', x)}
                                className={cn('rounded px-2.5 py-1 text-xs', val === x ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                              >
                                {x === 'none' ? '不可见' : x === 'own' ? '只看自己' : '全部人'}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <Switch aria-label={g.label} checked={!!val} onCheckedChange={(c) => setField(g.key as 'sales', c)} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-medium">能做什么</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {PERM_GROUPS.map((g) => (
                    <div key={g.module}>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{g.module}</div>
                      <div className="grid gap-0.5">
                        {g.items.map((it) => (
                          <label key={it.key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent">
                            <Checkbox
                              checked={sel.perms.includes(it.key)}
                              onCheckedChange={(c) => edit({ perms: c ? [...sel.perms, it.key] : sel.perms.filter((p) => p !== it.key) })}
                            />
                            <span className="flex-1">{it.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          <div className="border-t px-3 py-2">
            <div className="mb-2 text-xs font-medium text-muted-foreground">使用这个角色的账号</div>
            <div className="flex flex-wrap gap-2">
              {members.length === 0 && <span className="text-sm text-muted-foreground">暂无成员</span>}
              {members.map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-sm">
                  <Avatar user={u} size={22} /> {u.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div></div>}
      <NewAccount open={adding} onOpenChange={setAdding} onCreated={(name, pw) => setSecret({ name, pw })} />
      <SecretDialog value={secret} onClose={() => setSecret(null)} />
      {pane === 'accounts' && <><DataTable
        fill
        id="accounts"
        rows={s.users}
        rowId={(u) => u.id}
        cols={[
          {
            id: 'name',
            header: '成员',
            size: 180,
            sort: (u) => u.name,
            cell: (u) => (
              <span className="flex items-center gap-2.5">
                <AvatarButton preview={u.avatar} label={`给${u.name}换头像`} onPick={(url) => setUserAvatar(u.id, url).then((ok) => ok && toast.success(`已更新${u.name}的头像`))}>
                  <Avatar user={u} size={22} />
                </AvatarButton>
                {u.name}
              </span>
            ),
          },
          { id: 'account', header: '登录名', size: 130, sort: (u) => u.account ?? '', cell: (u) => <span className="num text-muted-foreground">@{u.account}</span> },
          {
            id: 'role',
            header: '角色',
            size: 170,
            sort: (u) => s.roles.find((r) => r.id === u.roleId)?.name ?? '',
            cell: (u) => (
              <Select value={u.roleId} onValueChange={(v) => void setUserRole(u.id, v).then((ok) => ok && toast.success(`${u.name} 已换成「${s.roles.find((r) => r.id === v)?.name}」`))}>
                <SelectTrigger className="h-7 w-36" aria-label={`${u.name} 的角色`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {s.roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ),
          },
          {
            id: 'canWrite',
            header: '可当写手',
            size: 100,
            filterValue: u => u.canWrite ? '可当写手' : '不当写手',
            cell: (u) => (
              <Switch
                aria-label={`${u.name} 可当写手`}
                checked={u.canWrite}
                onCheckedChange={(c) => void setUserCanWrite(u.id, c).then((ok) => ok && toast.success(c ? `${u.name} 会出现在写手名单里` : `${u.name} 不再出现在写手名单里`))}
              />
            ),
          },
          {
            id: 'salesMode',
            header: '销售类型',
            size: 145,
            sort: (u) => u.isAdmin ? '自营' : u.isSales ? salesModeLabel(u.salesMode) : '',
            cell: (u) => u.isAdmin ? <span className="text-muted-foreground">自营</span> : u.isSales ? <SalesModeSelect id={u.id} name={u.name} value={u.salesMode ?? 'commission'}/> : <span className="text-muted-foreground">—</span>,
          },
          ...(role.locked ? [{
            id: 'writerRate',
            header: '写手默认比例',
            size: 145,
            filterValue: (u: typeof s.users[number]) => u.canWrite ? (u.writerRate ?? .2) * 100 : null,
            cell: (u: typeof s.users[number]) => u.canWrite ? <PercentInput label={`${u.name}的默认写手比例`} value={u.writerRate ?? .2} onSave={rate => rate === null ? Promise.resolve(false) : updateUser(u.id, { writerRate: rate })}/> : <span className="text-muted-foreground">—</span>,
          }] : []),
          {
            id: 'rate',
            header: '原约定比例',
            size: 100,
            filterValue: u => u.isAdmin ? '自营' : u.isSales && u.salesMode !== 'cost' ? (u.commissionRate ?? .5) * 100 : null,
            cell: (u) => (u.isAdmin ? <span className="text-muted-foreground">自营</span> : u.isSales && u.salesMode !== 'cost' ? <RateInput id={u.id} value={u.commissionRate ?? 0.5} /> : <span className="text-muted-foreground">—</span>),
          },
          {
            id: 'act',
            header: '操作',
            size: 200,
            cell: (u) => (
              <span className="flex items-center gap-1">
                {u.active === false && <span className="rounded border px-1.5 text-xs text-muted-foreground">已停用</span>}
                {s.defaultWriterId === u.id && <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">默认写手</span>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-muted-foreground">
                      管理 <CaretDown size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={async () => {
                        const r = await resetPassword(u.id)
                        if (r) setSecret({ name: u.name, pw: r.tempPassword })
                      }}
                    >
                      重置密码（生成临时密码）
                    </DropdownMenuItem>
                    {u.canWrite && u.active !== false && s.defaultWriterId !== u.id && (
                      <DropdownMenuItem onSelect={() => void setDefaultWriter(u.id).then((ok) => ok && toast.success(`新单默认由${u.name}写`))}>设为默认写手</DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => void forceLogout(u.id).then((ok) => ok && toast.success(`${u.name} 的所有登录已失效`))}>强制下线</DropdownMenuItem>
                    {u.id !== me.id && (
                      <DropdownMenuItem onSelect={() => void updateUser(u.id, { active: u.active === false }).then((ok) => ok && toast.success(u.active === false ? '已启用' : '已停用，不能再登录'))}>
                        {u.active === false ? '启用账号' : '停用账号'}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            ),
          },
        ]}
      /><TableFooter>{s.users.length} 个账号</TableFooter></>}
    </div>
  )
}

function SalesModeSelect({ id, name, value }: { id: string; name: string; value: SalesMode }) {
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  async function change(mode: string) {
    if (working.current || mode === value || mode !== 'commission' && mode !== 'cost') return
    working.current = true; setBusy(true)
    try {
      if (await updateUser(id, { salesMode: mode })) toast.success('销售类型已改，仅用于新单')
    } catch { toast.error('销售类型未保存，请重试') }
    finally { working.current = false; setBusy(false) }
  }
  return <Select value={value} disabled={busy} onValueChange={mode => void change(mode)}>
    <SelectTrigger className="h-7 w-24" aria-label={`${name} 的销售类型`} title="新单默认类型">{salesModeLabel(value)}</SelectTrigger>
    <SelectContent>{(['commission', 'cost'] as const).map(mode => <SelectItem key={mode} value={mode}>{salesModeLabel(mode)}</SelectItem>)}</SelectContent>
  </Select>
}

function RateInput({ value }: { id: string; value: number }) {
  return <span className="num text-sm text-muted-foreground" title="历史参考；旧单保留各自原约定，10月16日起新制度固定20%">{Math.round(value * 100)}%</span>
}

function NewAccount({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (name: string, pw: string) => void }) {
  const { s } = useSession()
  const [name, setName] = useState('')
  const [account, setAccount] = useState('')
  const [roleId, setRoleId] = useState('')
  const [canWrite, setCanWrite] = useState(false)
  useEffect(() => {
    if (open) {
      setName('')
      setAccount('')
      setRoleId(s.roles.find((r) => !r.locked)?.id ?? s.roles[0].id)
      setCanWrite(false)
    }
  }, [open, s.roles])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-md">
        <DialogTitle>新建账号</DialogTitle>
        <DialogDescription>临时密码首次登录需修改。</DialogDescription>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await createUser({ name, account, roleId, canWrite })
            if (!r) return
            onOpenChange(false)
            onCreated(name, r.tempPassword)
          }}
        >
          <label className="grid gap-1 text-xs text-muted-foreground">
            显示名
            <input id="na-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：小李" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            登录名（字母、数字）
            <input id="na-account" className={cn(inputCls, 'num')} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="例如：xiaoli" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            角色
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {s.roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={canWrite} onCheckedChange={setCanWrite} /> 可当写手（会出现在写手名单里）
          </label>
          <Button type="submit" className="mt-1">
            创建
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 临时密码只显示这一次，关掉就看不到了 */
function SecretDialog({ value, onClose }: { value: { name: string; pw: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-sm">
        <DialogTitle>{value?.name} 的临时密码</DialogTitle>
        <DialogDescription>密码仅显示一次，首次登录需修改。</DialogDescription>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <code className="num flex-1 select-all text-base">{value?.pw}</code>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1"
            onClick={() =>
              navigator.clipboard?.writeText(value?.pw ?? '').then(
                () => toast.success('已复制'),
                () => toast('复制被拦了，手动选中复制'),
              )
            }
          >
            <CopySimple size={14} /> 复制
          </Button>
        </div>
        <Button onClick={onClose}>好了</Button>
      </DialogContent>
    </Dialog>
  )
}
