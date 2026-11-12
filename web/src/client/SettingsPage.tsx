'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, X, PencilSimple, Trash, Eye, EyeSlash, ListChecks, TreeStructure, IdentificationCard, SidebarSimple } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CardField, CardFieldType, NodeTemplate } from '@/shared/types'
import { PageHeader, StatusPill, inputCls } from './ui'
import { useSession } from './store'
import { archiveCardField, deleteTemplate, reorderSettings, saveCardField, saveNavOrder, saveOptions, saveTemplate, type OptionKey } from './store-p2'
import { navEntryPages, orderedNav } from './Shell'
import { SortableList } from './sortable'

const OPTION_GROUPS: { key: OptionKey; label: string; hint: string; fixed?: string[] }[] = [
  { key: 'statuses', label: '订单状态', hint: '「未交付」「退单」系统要用，不能删；还有订单在用的状态也不能删', fixed: ['未交付', '退单'] },
  { key: 'types', label: '订单类型', hint: '录单时直接输入新类型也会自动加进来' },
  { key: 'payTags', label: '收款标签', hint: '「退款」按负数算，不能删', fixed: ['退款'] },
]

const TYPE_LABEL: Record<CardFieldType, string> = { text: '单行文字', longtext: '多行文字', number: '数字', select: '选项', date: '日期', file: '文件' }

/** 系统设置（管理员）：选项、需求卡片字段、导航顺序。全部拖动排序，全员生效。 */
export function SettingsPage() {
  return (
    <div className="grid gap-6">
      <PageHeader title="系统设置" sub="对所有人生效，改动记入审计日志" />
      <Section icon={<ListChecks size={16} />} title="选项" sub="拖动左边的点调整顺序；录单、筛选、看板都按这个顺序">
        <div className="grid items-start gap-4 md:grid-cols-2">
          <div className="grid content-start gap-4">{OPTION_GROUPS.filter(g => g.key !== 'types').map(g => <OptionList key={g.key} group={g} />)}</div>
          <OptionList group={OPTION_GROUPS.find(g => g.key === 'types')!} />
        </div>
      </Section>
      <Section icon={<IdentificationCard size={16} />} title="需求卡片字段" sub="订单「需求」页签上的字段；停用的字段不再显示，已填的内容保留">
        <CardFields />
      </Section>
      <Section icon={<SidebarSimple size={16} />} title="导航顺序" sub="拖动调整各分组内的顺序，对所有人有效">
        <NavOrder />
      </Section>
    </div>
  )
}

function Section({ icon, title, sub, children }: { icon: ReactNode; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-start gap-2.5 border-b px-4 py-3">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function OptionList({ group }: { group: (typeof OPTION_GROUPS)[number] }) {
  const { s } = useSession()
  const values = s[group.key] as string[]
  const [adding, setAdding] = useState('')
  const used = (v: string) => (group.key === 'statuses' ? s.orders.filter((o) => o.status === v).length : 0)
  async function save(next: string[], msg?: string) {
    if (await saveOptions(group.key, next)) msg && toast.success(msg)
  }
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">{group.label}</span>
        <span className="num text-xs text-muted-foreground">{values.length}</span>
      </div>
      <SortableList
        className="grid p-1.5"
        items={values}
        id={(v) => v}
        onReorder={(next) => void save(next)}
        render={(v, handle) => (
          <div className="group flex h-8 items-center gap-1.5 rounded-md bg-card px-1 hover:bg-accent">
            {handle}
            <span className="min-w-0 flex-1 truncate text-sm">{group.key === 'statuses' ? <StatusPill status={v} /> : v}</span>
            {used(v) > 0 && <span className="num text-xs text-muted-foreground">{used(v)} 单</span>}
            {!group.fixed?.includes(v) && !used(v) && (
              <button aria-label={`删除 ${v}`} onClick={() => void save(values.filter((x) => x !== v), `已删除「${v}」`)} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-danger md:opacity-0 md:group-hover:opacity-100">
                <X size={12} />
              </button>
            )}
          </div>
        )}
      />
      <form
        className="flex gap-1.5 border-t p-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          const v = adding.trim()
          if (!v) return
          if (values.includes(v)) return toast.error('已经有了')
          // 新状态加在「退单」前面，其余加在最后
          const next = group.key === 'statuses' && values.includes('退单') ? [...values.filter((x) => x !== '退单'), v, '退单'] : [...values, v]
          void save(next, `已添加「${v}」`).then(() => setAdding(''))
        }}
      >
        <input aria-label={`新${group.label}`} className={cn(inputCls, 'h-8')} placeholder={`新${group.label}`} value={adding} onChange={(e) => setAdding(e.target.value)} />
        <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0">
          添加
        </Button>
      </form>
      <p className="px-3 pb-2 text-[12px] text-muted-foreground">{group.hint}</p>
    </div>
  )
}

function Templates() {
  const { s } = useSession()
  const [editing, setEditing] = useState<NodeTemplate | 'new' | null>(null)
  return (
    <div className="grid gap-2">
      {s.nodeTemplates.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">还没有模板</div>}
      <SortableList
        className="grid gap-1.5"
        items={s.nodeTemplates}
        id={(t) => t.id}
        onReorder={(next) => void reorderSettings('templates', next.map((t) => t.id))}
        render={(t, handle) => (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-2">
            {handle}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.name}</div>
              <div className="truncate text-xs text-muted-foreground">{t.nodes.map((n) => (n.days === null ? n.name : `${n.name}（第 ${n.days} 天）`)).join(' → ')}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`编辑 ${t.name}`} onClick={() => setEditing(t)}>
              <PencilSimple size={14} />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-danger" aria-label={`删除 ${t.name}`} onClick={() => void deleteTemplate(t.id).then((ok) => ok && toast.success(`已删除「${t.name}」`))}>
              <Trash size={14} />
            </Button>
          </div>
        )}
      />
      <Button size="sm" variant="outline" className="h-8 w-fit gap-1.5" onClick={() => setEditing('new')}>
        <Plus size={14} /> 新建模板
      </Button>
      {editing && <TemplateEditor tpl={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TemplateEditor({ tpl, onClose }: { tpl?: NodeTemplate; onClose: () => void }) {
  const { s } = useSession()
  const [name, setName] = useState(tpl?.name ?? '')
  const [nodes, setNodes] = useState(tpl?.nodes.map((n, k) => ({ ...n, key: String(k), days: n.days === null ? '' : String(n.days) })) ?? [{ key: '0', name: '', days: '' }])
  const patch = (k: number, p: Partial<(typeof nodes)[number]>) => setNodes(nodes.map((x, i) => (i === k ? { ...x, ...p } : x)))
  async function save() {
    const list = nodes.filter((n) => n.name.trim()).map((n) => ({ name: n.name.trim(), days: n.days === '' ? null : Number(n.days) }))
    if (!name.trim() || !list.length) return toast.error('模板名和至少一个节点要填')
    if (await saveTemplate({ id: tpl?.id, name: name.trim(), nodes: list })) {
      toast.success('模板已保存')
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-[520px]">
        <DialogTitle className="text-base">{tpl ? '编辑节点模板' : '新建节点模板'}</DialogTitle>
        <DialogDescription className="text-xs">「第几天」从下单日期算，套用时自动填计划日期；空着就不定日期</DialogDescription>
        <input autoFocus aria-label="模板名" className={inputCls} placeholder="模板名，如 本科标准流程" value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id="node-tags">
          {s.nodeTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <SortableList
          className="grid gap-1.5"
          items={nodes}
          id={(n) => n.key}
          onReorder={setNodes}
          render={(n, handle) => {
            const k = nodes.indexOf(n)
            return (
              <div className="flex items-center gap-1.5 bg-background">
                {handle}
                <input list="node-tags" aria-label="节点名" className={cn(inputCls, 'h-8 min-w-0 flex-1')} placeholder="节点名" value={n.name} onChange={(e) => patch(k, { name: e.target.value })} />
                <span className="shrink-0 text-xs text-muted-foreground">第</span>
                <input aria-label="第几天" inputMode="numeric" className={cn(inputCls, 'num h-8 w-14 text-right')} value={n.days} onChange={(e) => patch(k, { days: e.target.value.replace(/\D/g, '') })} />
                <span className="shrink-0 text-xs text-muted-foreground">天</span>
                <button type="button" aria-label="删掉这个节点" onClick={() => setNodes(nodes.filter((_, i) => i !== k))} className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:text-danger">
                  <X size={12} />
                </button>
              </div>
            )
          }}
        />
        <Button size="sm" variant="ghost" className="h-7 w-fit gap-1 text-xs" onClick={() => setNodes([...nodes, { key: String(Date.now()), name: '', days: '' }])}>
          <Plus size={12} /> 加一个节点
        </Button>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CardFields() {
  const { s } = useSession()
  const [editing, setEditing] = useState<CardField | 'new' | null>(null)
  return (
    <div className="grid gap-2">
      <SortableList
        className="grid gap-1.5"
        items={s.cardFields}
        id={(f) => f.id}
        onReorder={(next) => void reorderSettings('cardFields', next.map((f) => f.id))}
        render={(f, handle) => (
          <div className={cn('flex items-center gap-2 rounded-lg border bg-card px-2 py-2', f.archived && 'opacity-55')}>
            {handle}
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                {f.label}
                {f.builtin && <span className="ml-1.5 text-xs text-muted-foreground">基础</span>}
                {f.archived && <span className="ml-1.5 text-xs text-muted-foreground">已停用</span>}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {TYPE_LABEL[f.type]}
                {f.type === 'select' && ` · ${f.choices.join(' / ')}`}
              </div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`编辑 ${f.label}`} onClick={() => setEditing(f)}>
              <PencilSimple size={14} />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" aria-label={f.archived ? `恢复 ${f.label}` : `停用 ${f.label}`} title={f.archived ? '恢复' : '停用'} onClick={() => void archiveCardField(f.id, !f.archived)}>
              {f.archived ? <Eye size={14} /> : <EyeSlash size={14} />}
            </Button>
          </div>
        )}
      />
      <Button size="sm" variant="outline" className="h-8 w-fit gap-1.5" onClick={() => setEditing('new')}>
        <Plus size={14} /> 加字段
      </Button>
      {editing && <FieldEditor field={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function FieldEditor({ field, onClose }: { field?: CardField; onClose: () => void }) {
  const [label, setLabel] = useState(field?.label ?? '')
  const [type, setType] = useState<CardFieldType>(field?.type ?? 'text')
  const [choices, setChoices] = useState((field?.choices ?? []).join('\n'))
  async function save() {
    const list = choices.split(/[\n,，、]/).map((x) => x.trim()).filter(Boolean)
    if (!label.trim()) return toast.error('字段名要填')
    if (await saveCardField({ id: field?.id, label: label.trim(), type, choices: type === 'select' ? list : [] })) {
      toast.success('字段已保存')
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-[440px]">
        <DialogTitle className="text-base">{field ? '编辑字段' : '加一个需求卡片字段'}</DialogTitle>
        <DialogDescription className="text-xs">字段类型建好后不能改</DialogDescription>
        <input autoFocus aria-label="字段名" className={inputCls} placeholder="字段名，如 是否要答辩 PPT" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {(Object.keys(TYPE_LABEL) as CardFieldType[]).map((t) => (
            <button key={t} type="button" disabled={!!field} onClick={() => setType(t)} className={cn('rounded-full border px-2.5 py-1 text-xs disabled:cursor-not-allowed', type === t ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground', field && type !== t && 'opacity-40')}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        {type === 'select' && <textarea aria-label="选项" rows={4} className={cn(inputCls, 'h-auto py-2')} placeholder={'选项，一行一个\n要\n不要'} value={choices} onChange={(e) => setChoices(e.target.value)} />}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NavOrder() {
  const { s } = useSession()
  const items = orderedNav(s.navOrder).filter(item => navEntryPages(item)[0] !== 'home')
  return <SortableList className="grid max-w-xs gap-1" items={items} id={item => navEntryPages(item)[0]}
    onReorder={next => { void saveNavOrder(['home', ...next.flatMap(navEntryPages)]).then(ok => ok && toast.success('导航顺序已更新')) }}
    render={(item, handle) => <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-1.5 text-sm">
      {handle}{item.label}
    </div>}
  />
}
