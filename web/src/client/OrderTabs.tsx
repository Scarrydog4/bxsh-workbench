'use client'
import { PreviewButton } from './preview/PreviewButton'
import { needsDeadline } from '@/shared/order-deadline'
import { FinancialNote } from './FinancialNote'
import { DateField, DatePicker } from './DatePicker'
import { SelectField } from './SelectField'
import { PersonChoice } from './PersonChoice'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Plus, X, Paperclip, ChatCircle, PaperPlaneRight, TreeStructure, IdentificationCard, CaretDown, CheckCircle, Circle, CircleHalf, Trash, CalendarCheck, HandCoins, DownloadSimple, FileText } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { CardField, Comment, NodeStatus, OrderNode, OrderView } from '@/shared/types'
import { addDays, iso, money, relTime, shortDate, today } from '@/shared/format'
import { Avatar, Empty, Money, inputCls, SkeletonRows } from './ui'
import { addAttachments, getState, useSession } from './store'
import { addComment, addNodeFiles, addReceivable, applyTemplate, cancelReceivable, collectReceivable, deleteComment, deleteNode, fetchComments, reorderNodes, saveNode, updateCard, type NodeInput } from './store-p2'
import { SortableList } from './sortable'
import { Thumbs, fileUrl } from './ImageViewer'
import { fileSize, hasFiles, thumb } from './files'
import { ImageInputActions } from './ImageInputActions'
import { IMAGE_INPUT_EMPTY_MESSAGE, imageFilesFromTransfer } from './image-input'

// ---------- 需求卡片 ----------

/** 需求卡片：基础字段 + 管理员加的自定义字段，就地编辑；截止日期就是订单的截止日期 */
export function ReqCardTab({ v }: { v: OrderView }) {
  const { s, can } = useSession()
  const editable = can('card.edit')
  const fields = s.cardFields.filter((f) => !f.archived || v.req[f.id] !== undefined)
  const filled = fields.filter((f) => v.req[f.id] !== undefined).length
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          已填 <span className="num">{filled}</span> / {fields.length} 项 · 截止 {v.dueDate ? shortDate(v.dueDate) : needsDeadline(v) ? '未定' : '—'}（在概览里改）
        </span>
        {!editable && <span>只读</span>}
      </div>
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border">
        {fields.map((f) => (
          <div key={f.id} className={cn('grid gap-1.5 bg-card px-3 py-2.5 sm:grid-cols-[120px_1fr] sm:items-start sm:gap-3', f.archived && 'opacity-60')}>
            <div className="pt-1 text-xs text-muted-foreground">
              {f.label}
              {f.archived && '（已停用）'}
            </div>
            <CardValue v={v} f={f} editable={editable && !f.archived} />
          </div>
        ))}
      </div>
    </div>
  )
}

function CardValue({ v, f, editable }: { v: OrderView; f: CardField; editable: boolean }) {
  const value = v.req[f.id]
  const save = (x: unknown) => void updateCard(v.id, { [f.id]: x })
  if (f.type === 'file') return <CardFiles v={v} f={f} editable={editable} />
  if (!editable) {
    if (value === undefined) return <span className="pt-1 text-sm text-muted-foreground">—</span>
    return <span className="whitespace-pre-wrap break-words pt-1 text-sm">{String(value)}</span>
  }
  if (f.type === 'select')
    return (
      <div className="flex flex-wrap gap-1">
        {f.choices.map((c) => (
          <button key={c} type="button" onClick={() => save(value === c ? null : c)} className={cn('rounded-full border px-2.5 py-0.5 text-xs', value === c ? 'border-primary bg-primary/10 text-primary' : 'border-dashed border-input text-muted-foreground hover:border-primary')}>
            {c}
          </button>
        ))}
      </div>
    )
  return <BlurInput type={f.type} value={value} onSave={save} label={f.label} />
}

/** 失去焦点时保存；值没变不提交 */
function BlurInput({ type, value, onSave, label }: { type: CardField['type']; value: unknown; onSave: (v: unknown) => void; label: string }) {
  const shown = value === undefined || value === null ? '' : String(value)
  const [x, setX] = useState(shown)
  useEffect(() => setX(shown), [shown])
  const commit = () => {
    if (x.trim() === shown) return
    if (type === 'number') {
      if (x.trim() === '') return onSave(null)
      const n = Number(x)
      if (isNaN(n)) return toast.error(`「${label}」要填数字`), setX(shown)
      return onSave(n)
    }
    onSave(x.trim() || null)
  }
  if(type==='date')return <DatePicker value={shown} label={label} clearable onChange={value=>{if(value!==shown)onSave(value||null)}}/>
  if (type === 'longtext')
    return <textarea aria-label={label} rows={3} className={cn(inputCls, 'h-auto py-1.5')} value={x} onChange={(e) => setX(e.target.value)} onBlur={commit} placeholder="—" />
  return (
    <input
      aria-label={label}
      type="text"
      inputMode={type === 'number' ? 'numeric' : undefined}
      className={cn(inputCls, 'h-8', type === 'number' && 'num w-40')}
      value={x}
      placeholder="—"
      onChange={(e) => setX(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** 文件类字段（任务书、模板）：文件存成订单附件，字段里记住是哪几个 */
function CardFiles({ v, f, editable }: { v: OrderView; f: CardField; editable: boolean }) {
  const ids = (v.req[f.id] as string[] | undefined) ?? []
  const files = ids.map((id) => v.attachments.find((a) => a.id === id)).filter(Boolean) as OrderView['attachments']
  const [over, setOver] = useState(false)
  async function take(list: File[]) {
    if (!list.length) return
    const before = new Set(getState().orders.find((o) => o.id === v.id)?.attachments.map((a) => a.id))
    if (!(await addAttachments(v.id, list))) return
    const now = getState().orders.find((o) => o.id === v.id)?.attachments ?? []
    const added = now.filter((a) => !before.has(a.id)).map((a) => a.id)
    if (added.length) await updateCard(v.id, { [f.id]: [...ids, ...added] })
  }
  return (
    <div
      className={cn('grid gap-1 rounded-md', over && 'ring-2 ring-primary')}
      onDragOver={(e) => {
        if (!editable || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!editable || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        void take(Array.from(e.dataTransfer.files))
      }}
    >
      {files.map((a) => (
        <div key={a.id} className="group flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
          <FileText size={15} className="shrink-0 text-info" />
          <a href={fileUrl(a.id)} download={a.name} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">
            {a.name}
          </a>
          <span className="num text-muted-foreground">{fileSize(a.size)}</span>
          <PreviewButton id={a.id} name={a.name} size={a.size} mime={a.mime} className="h-6 w-6" />
          {editable && (
            <button aria-label={`从「${f.label}」移除 ${a.name}`} title="从这个字段移除（附件还在）" onClick={() => void updateCard(v.id, { [f.id]: ids.filter((x) => x !== a.id) })} className="text-muted-foreground hover:text-danger md:opacity-0 md:group-hover:opacity-100">
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button
          type="button"
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.multiple = true
            input.onchange = () => input.files && void take(Array.from(input.files))
            input.click()
          }}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-input px-2 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Paperclip size={13} /> 拖进来或点这里选文件
        </button>
      )}
      {!editable && !files.length && <span className="pt-1 text-sm text-muted-foreground">—</span>}
    </div>
  )
}

// ---------- 进度节点 ----------

const NODE_ICON: Record<NodeStatus, ReactNode> = { 待做: <Circle size={16} />, 进行中: <CircleHalf size={16} weight="fill" />, 完成: <CheckCircle size={16} weight="fill" /> }
const NODE_TONE: Record<NodeStatus, string> = { 待做: 'var(--muted-foreground)', 进行中: 'var(--info)', 完成: 'var(--ok)' }
const NEXT: Record<NodeStatus, NodeStatus> = { 待做: '进行中', 进行中: '完成', 完成: '待做' }

/** 进度：节点可拖动排序，点圆圈切换状态，展开改计划日期、负责人、备注、交付文件；能一键套用模板 */
export function NodesTab({ v }: { v: OrderView }) {
  const { s, can } = useSession()
  const editable = can('node.edit')
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [plan, setPlan] = useState('')
  const nodes = v.nodes
  const done = nodes.filter((n) => n.status === '完成').length
  const base = (n: OrderNode): NodeInput => ({ id: n.id, name: n.name, status: n.status, planDate: n.planDate, doneDate: n.doneDate, ownerId: n.ownerId, note: n.note })

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {nodes.length > 0 && (
          <div className="flex min-w-[140px] flex-1 items-center gap-2 text-xs text-muted-foreground">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full rounded-full bg-ok" initial={false} animate={{ width: `${(done / nodes.length) * 100}%` }} />
            </div>
            <span className="num">
              {done}/{nodes.length}
            </span>
          </div>
        )}
        {editable && s.nodeTemplates.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="ml-auto h-8 gap-1">
                <TreeStructure size={14} /> 套用模板 <CaretDown size={11} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {s.nodeTemplates.map((t) => (
                <DropdownMenuItem key={t.id} onSelect={() => void applyTemplate(v.id, t.id).then((r) => r && toast.success(`已加入 ${r.count} 个节点`))}>
                  <span className="grid">
                    <span>{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.nodes.map((n) => n.name).join(' → ')}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {nodes.length === 0 && <Empty icon={<TreeStructure size={20} />} title="还没有进度节点" hint={editable ? '在下面加节点，或套用一个模板' : '有人加了节点后会显示在这里'} />}

      <SortableList
        className="grid gap-1.5"
        items={nodes}
        id={(n) => n.id}
        disabled={!editable}
        onReorder={(next) => void reorderNodes(v.id, next.map((n) => n.id))}
        render={(n, handle) => <NodeRow v={v} n={n} handle={handle} open={open === n.id} onToggle={() => setOpen(open === n.id ? null : n.id)} editable={editable} onStatus={(st) => void saveNode(v.id, { ...base(n), status: st, doneDate: null })} />}
      />

      {editable && (
        <form
          className="flex flex-wrap gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            if (await saveNode(v.id, { name: name.trim(), status: '待做', planDate: plan || null, ownerId: null, note: '' })) {
              setName('')
              setPlan('')
            }
          }}
        >
          <datalist id={`tags-${v.id}`}>
            {s.nodeTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <input list={`tags-${v.id}`} aria-label="新节点名" className={cn(inputCls, 'h-8 min-w-0 flex-1')} placeholder="加一个节点，如 开题报告" value={name} onChange={(e) => setName(e.target.value)} />
          <DateField  aria-label="计划日期" className={cn(inputCls, 'h-8 w-auto')} value={plan} onChange={(e) => setPlan(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" className="h-8 gap-1">
            <Plus size={13} /> 加
          </Button>
        </form>
      )}
    </div>
  )
}

function NodeRow({ v, n, handle, open, onToggle, editable, onStatus }: { v: OrderView; n: OrderNode; handle: ReactNode; open: boolean; onToggle: () => void; editable: boolean; onStatus: (s: NodeStatus) => void }) {
  const { user } = useSession()
  const files = v.attachments.filter((a) => a.nodeId === n.id)
  const late = n.status !== '完成' && n.planDate && n.planDate < iso(today())
  const [over, setOver] = useState(false)
  return (
    <div
      className={cn('rounded-lg border bg-card', over && 'border-primary bg-primary/[0.05]')}
      onDragOver={(e) => {
        if (!editable || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!editable || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        void addNodeFiles(v.id, n.id, Array.from(e.dataTransfer.files))
      }}
    >
      <div className="flex items-center gap-2 px-1.5 py-1.5">
        {handle}
        <button
          type="button"
          disabled={!editable}
          onClick={() => onStatus(NEXT[n.status])}
          title={editable ? `${n.status}（点一下改成「${NEXT[n.status]}」）` : n.status}
          aria-label={`${n.name}：${n.status}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-accent disabled:hover:bg-transparent"
          style={{ color: NODE_TONE[n.status] }}
        >
          {NODE_ICON[n.status]}
        </button>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={cn('min-w-0 flex-1 truncate text-sm', n.status === '完成' && 'text-muted-foreground line-through')}>{n.name}</span>
          {files.length > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <Paperclip size={12} />
              {files.length}
            </span>
          )}
          {n.ownerId && <Avatar user={user(n.ownerId)} size={18} />}
          <span className={cn('num shrink-0 text-xs', late ? 'text-danger' : 'text-muted-foreground')}>{n.status === '完成' && n.doneDate ? `完成 ${shortDate(n.doneDate)}` : n.planDate ? shortDate(n.planDate) : ''}</span>
          <CaretDown size={12} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      <AnimatePresence initial={false}>{open && <NodeEditor v={v} n={n} files={files} editable={editable} />}</AnimatePresence>
    </div>
  )
}

function NodeEditor({ v, n, files, editable }: { v: OrderView; n: OrderNode; files: OrderView['attachments']; editable: boolean }) {
  const { s } = useSession()
  const [x, setX] = useState({ name: n.name, status: n.status, planDate: n.planDate ?? '', ownerId: n.ownerId ?? '', note: n.note })
  useEffect(() => setX({ name: n.name, status: n.status, planDate: n.planDate ?? '', ownerId: n.ownerId ?? '', note: n.note }), [n])
  const dirty = x.name !== n.name || x.status !== n.status || x.planDate !== (n.planDate ?? '') || x.ownerId !== (n.ownerId ?? '') || x.note !== n.note
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
      <div className="grid gap-2 border-t px-3 py-3 text-xs">
        <fieldset disabled={!editable} className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-muted-foreground">
            节点名
            <input className={cn(inputCls, 'h-8')} value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} />
          </label>
          <label className="grid gap-1 text-muted-foreground">
            状态
            <SelectField className={cn(inputCls, 'h-8')} value={x.status} onChange={(e) => setX({ ...x, status: e.target.value as NodeStatus })}>
              {(['待做', '进行中', '完成'] as NodeStatus[]).map((st) => (
                <option key={st}>{st}</option>
              ))}
            </SelectField>
          </label>
          <label className="grid gap-1 text-muted-foreground">
            计划日期
            <DateField  className={cn(inputCls, 'h-8')} value={x.planDate} onChange={(e) => setX({ ...x, planDate: e.target.value })} />
          </label>
          <div className="grid gap-1 text-muted-foreground sm:col-span-2">
            负责人
            <PersonChoice people={s.users.filter(u=>u.active!==false)} value={x.ownerId} onChange={ownerId=>setX({...x,ownerId})}/>
            {x.ownerId&&<button type="button" className="w-fit text-xs text-muted-foreground" onClick={()=>setX({...x,ownerId:''})}>恢复默认写手</button>}
          </div>
          <label className="grid gap-1 text-muted-foreground sm:col-span-2">
            备注
            <textarea rows={2} className={cn(inputCls, 'h-auto py-1.5')} value={x.note} onChange={(e) => setX({ ...x, note: e.target.value })} />
          </label>
        </fieldset>
        <div className="grid gap-1">
          <span className="text-muted-foreground">交付文件{editable && '（把文件拖到这个节点上就挂上）'}</span>
          {files.length === 0 && <span className="text-muted-foreground">—</span>}
          {files.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1">
              <FileText size={14} className="shrink-0 text-info" />
              <a href={fileUrl(a.id)} download={a.name} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">{a.name}</a>
              <span className="num text-muted-foreground">{fileSize(a.size)}</span>
              <PreviewButton id={a.id} name={a.name} size={a.size} mime={a.mime} className="h-6 w-6" />
              <a href={fileUrl(a.id)} download={a.name} aria-label={`下载 ${a.name}`} className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"><DownloadSimple size={13} /></a>
            </div>
          ))}
        </div>
        {editable && (
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-danger hover:text-danger" onClick={() => void deleteNode(v.id, n.id).then((ok) => ok && toast.success(`已删除「${n.name}」`))}>
              <Trash size={13} /> 删除节点
            </Button>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1"
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.multiple = true
                  input.onchange = () => input.files && void addNodeFiles(v.id, n.id, Array.from(input.files))
                  input.click()
                }}
              >
                <Paperclip size={13} /> 传文件
              </Button>
              <Button
                size="sm"
                className="h-7"
                disabled={!dirty || !x.name.trim()}
                onClick={() => void saveNode(v.id, { id: n.id, name: x.name.trim(), status: x.status, planDate: x.planDate || null, doneDate: x.status === '完成' ? n.doneDate : null, ownerId: x.ownerId || null, note: x.note }).then((ok) => ok && toast.success('节点已保存'))}
              >
                保存
              </Button>
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ---------- 评论 ----------

/** 每单一个讨论区：@ 人（只提醒看得到这单的人）、⌘V 贴图、⌘Enter 发送 */
export function CommentsTab({ v }: { v: OrderView }) {
  const { s, me, user, role } = useSession()
  const [list, setList] = useState<Comment[] | null>(null)
  const [body, setBody] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [mentions, setMentions] = useState<string[]>([])
  const [picker, setPicker] = useState<{ q: string; at: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [inputBusy, setInputBusy] = useState(false)
  const inputReading = useRef(false)
  const imageInputReading = (value: boolean) => { inputReading.current = value; setInputBusy(value) }
  const [readingImages, setReadingImages] = useState(false)
  const imageReading = useRef(false)
  const sending = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // 别人发了评论，SSE 推 changed → 全局数据刷新 → 这里也重新拉
  useEffect(() => {
    let live = true
    void fetchComments(v.id).then((x) => live && setList(x))
    return () => {
      live = false
    }
  }, [v.id, s])
  // 新版浏览器的 scrollIntoView 会返回 Promise，不能直接当 effect 的返回值
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [list?.length])

  const people = useMemo(() => s.users.filter((u) => u.active !== false && u.id !== me.id && (!picker || u.name.includes(picker.q))), [s.users, me.id, picker])

  function onChange(text: string, caret: number) {
    setBody(text)
    const m = /@([^\s@]{0,10})$/.exec(text.slice(0, caret))
    setPicker(m ? { q: m[1], at: caret - m[0].length } : null)
    setMentions((x) => x.filter((id) => text.includes(`@${user(id)?.name}`)))
  }
  function pick(id: string) {
    if (!picker) return
    const name = user(id)?.name ?? ''
    const caret = ref.current?.selectionStart ?? body.length
    const next = `${body.slice(0, picker.at)}@${name} ${body.slice(caret)}`
    setBody(next)
    setMentions((x) => Array.from(new Set([...x, id])))
    setPicker(null)
    requestAnimationFrame(() => {
      const p = picker.at + name.length + 2
      ref.current?.focus()
      ref.current?.setSelectionRange(p, p)
    })
  }
  async function addImages(files: File[]) {
    if (sending.current) return
    if (imageReading.current) { toast('图片读取中，请稍候'); return }
    if (!files.length) { toast.error(IMAGE_INPUT_EMPTY_MESSAGE); return }
    if (images.length + files.length > 9) { toast.error('每条评论最多添加 9 张图片'); return }
    imageReading.current = true; setReadingImages(true)
    try {
      const next = await Promise.all(files.map(file => thumb(file, 1600)))
      if (next.some(src => !src)) { toast.error('图片读取失败，请重新选择图片'); return }
      setImages(old => [...old, ...next as string[]])
    } catch { toast.error('图片读取失败，请重新选择图片') }
    finally { imageReading.current = false; setReadingImages(false) }
  }
  async function send() {
    if (sending.current || inputReading.current || imageReading.current || (!body.trim() && !images.length)) return
    sending.current = true
    setBusy(true)
    try {
      const r = await addComment(v.id, body.trim(), images, mentions)
      if (!r) return
      const dropped = mentions.filter((id) => !r.mentions.includes(id))
      if (dropped.length) toast(`${dropped.map((id) => user(id)?.name).join('、')} 看不到这单，没有提醒`)
      setBody('')
      setImages([])
      setMentions([])
      setList(await fetchComments(v.id))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      {list === null ? (
        <SkeletonRows rows={4}/>
      ) : list.length === 0 ? (
        <Empty icon={<ChatCircle size={20} />} title="还没有评论" hint="需要留个记录、提醒某人时在这里说；日常沟通还是在微信群" />
      ) : (
        <div className="grid gap-3">
          {list.map((m) => (
            <div key={m.id} className="group flex gap-2.5">
              <Avatar user={user(m.by)} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{user(m.by)?.name}</span>
                  {relTime(m.at)}
                  {(m.by === me.id || role.locked) && (
                    <button aria-label="删除这条评论" onClick={() => void deleteComment(v.id, m.id).then(async (ok) => ok && setList(await fetchComments(v.id)))} className="ml-auto text-muted-foreground hover:text-danger md:opacity-0 md:group-hover:opacity-100">
                      <Trash size={12} />
                    </button>
                  )}
                </div>
                {m.body && <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">{highlight(m.body, m.mentions.map((id) => user(id)?.name ?? ''))}</div>}
                {m.images.length > 0 && <Thumbs className="mt-1.5" pics={m.images.map((src, i) => ({ src, name: `评论图${i + 1}.jpg` }))} imgClass="h-20 w-16" />}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <div className="relative grid gap-2 rounded-lg border bg-card p-2 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15"
        onClick={e => { if (!(e.target as HTMLElement).closest('button, input, textarea, a')) ref.current?.focus({ preventScroll: true }) }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); void addImages(imageFilesFromTransfer(e.dataTransfer)) }}
        onPaste={e => {
          const files = imageFilesFromTransfer(e.clipboardData)
          if (!files.length) return
          e.preventDefault(); e.stopPropagation(); void addImages(files)
        }}>
        <textarea
          ref={ref}
          rows={2}
          disabled={busy}
          aria-label="写评论"
          className="min-h-[52px] w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          placeholder="写评论，@ 提醒某人"
          value={body}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (picker && people.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault()
              pick(people[0].id)
            } else if (e.key === 'Escape') setPicker(null)
            else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
        />
        {picker && people.length > 0 && (
          <div className="absolute bottom-full left-2 z-10 mb-1 grid max-h-48 w-48 overflow-auto rounded-md border bg-popover p-1 shadow-md">
            {people.slice(0, 8).map((u, i) => (
              <button key={u.id} type="button" onMouseDown={(e) => (e.preventDefault(), pick(u.id))} className={cn('flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent', i === 0 && 'bg-accent/60')}>
                <Avatar user={u} size={18} /> {u.name}
              </button>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="flex items-center gap-2">
            <Thumbs pics={images.map((src, i) => ({ src, name: `图${i + 1}.jpg` }))} imgClass="h-12 w-10" />
            <button type="button" className="text-xs text-muted-foreground hover:text-danger" disabled={busy || readingImages || inputBusy} onClick={() => setImages([])}>
              清空图片
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ImageInputActions pickerOnly pickLabel="上传截图" onReading={imageInputReading} onFiles={addImages} disabled={busy || readingImages || inputBusy} compact pasteTargetRef={ref}/>
          <span className="flex flex-wrap gap-1">
            {mentions.map((id) => (
              <span key={id} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                @{user(id)?.name}
              </span>
            ))}
          </span>
          <Button size="sm" className="h-7 gap-1" disabled={busy || readingImages || inputBusy || (!body.trim() && !images.length)} onClick={() => void send()}>
            <PaperPlaneRight size={13} /> 发送
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 把正文里的 @名字 标成主色 */
function highlight(text: string, names: string[]) {
  const ok = names.filter(Boolean)
  if (!ok.length) return text
  const re = new RegExp(`(@(?:${ok.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g')
  return text.split(re).map((part, i) => (re.test(part) && part.startsWith('@') ? <span key={i} className="font-medium text-primary">{part}</span> : part))
}

// ---------- 待收 ----------

/** 收款页签里的「待收」：记一笔预计哪天收到多少，到期提醒归属销售；收到后点一下转成实收 */
export function ReceivablesSection({ v }: { v: OrderView }) {
  const { s, can, role } = useSession()
  const [adding, setAdding] = useState(false)
  const [amt, setAmt] = useState('')
  const [due, setDue] = useState(iso(addDays(today(), 7)))
  const [tag, setTag] = useState('尾款')
  const [note, setNote] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [collecting, setCollecting] = useState<string | null>(null)
  const [collectNote, setCollectNote] = useState('')
  const [collectProof, setCollectProof] = useState<string>()
  const [readingProof, setReadingProof] = useState(false)
  const [savingCollection, setSavingCollection] = useState(false)
  const collectionLock = useRef(false)
  const closeCollection = () => { setCollecting(null); setCollectNote(''); setCollectProof(undefined) }
  async function saveCollection(id: string, amount: number) {
    if (collectionLock.current || readingProof) return
    if (!role.locked && !collectNote.trim() && !collectProof) return toast.error('请填写收款备注或粘贴截图')
    collectionLock.current = true; setSavingCollection(true)
    try {
      if (await collectReceivable(v.id, id, iso(today()), { note: collectNote.trim(), proof: collectProof })) {
        closeCollection(); toast.success(`已转成实收 ${money(amount)}`)
      }
    } finally { collectionLock.current = false; setSavingCollection(false) }
  }
  if (!v.receivables) return null
  const editable = can('payment.create')
  const open = v.receivables.filter((r) => !r.doneAt && !r.cancelledAt)
  const closed = v.receivables.filter((r) => r.doneAt || r.cancelledAt)
  const todayKey = iso(today())
  // 新增入口已隐藏；只展示已有的待收记录。
  if (!open.length && !closed.length && !adding) return null
  return (
    <section className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          待收 {open.length > 0 && <Money value={open.reduce((a, r) => a + r.amount, 0)} className="ml-1 text-foreground" />}
        </span>
        {editable && !adding && (
          <button onClick={() => (setAdding(true), setAmt(v.unpaid && v.unpaid > 0 ? String(v.unpaid) : ''))} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus size={12} weight="bold" /> 记一笔待收
          </button>
        )}
      </div>
      <div className="grid px-3 py-1 text-sm">
        {open.length === 0 && !adding && <div className="py-2 text-xs text-muted-foreground">没有进行中的待收</div>}
        {open.map((r) => {
          const late = r.dueDate <= todayKey
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0">
              <span className="tone rounded px-1.5 py-0.5 text-xs" style={{ '--t': late ? 'var(--warn)' : 'var(--info)' } as CSSProperties}>
                {r.tag}
              </span>
              <span className={cn('num text-xs', late ? 'text-warn' : 'text-muted-foreground')}>
                <CalendarCheck size={12} className="mr-0.5 inline" />
                {late ? `${shortDate(r.dueDate)} 到期` : `预计 ${shortDate(r.dueDate)}`}
              </span>
              {r.note && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.note}</span>}
              <span className="ml-auto flex items-center gap-1.5">
                <Money value={r.amount} />
                {editable && (
                  <>
                    <Button size="sm" className="h-7 gap-1 px-2 text-xs" disabled={savingCollection || readingProof} onClick={() => { if (role.locked) { void saveCollection(r.id, r.amount); return } closeCollection(); setCollecting(r.id) }}>
                      <HandCoins size={13} /> 收到了
                    </Button>
                    <button aria-label="取消这笔待收" title="取消" disabled={savingCollection || readingProof} onClick={() => void cancelReceivable(v.id, r.id)} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-danger">
                      <X size={12} />
                    </button>
                  </>
                )}
              </span>
              {collecting === r.id && <form className="w-full" onSubmit={e => { e.preventDefault(); void saveCollection(r.id, r.amount) }}>
                <fieldset className="grid gap-2" disabled={savingCollection || readingProof}>
                  <FinancialNote note={collectNote} proof={collectProof} onNote={setCollectNote} onProof={setCollectProof} onReading={setReadingProof} disabled={savingCollection || readingProof} required={!role.locked} />
                  <div className="flex justify-end gap-2"><Button size="sm" type="button" variant="ghost" onClick={closeCollection}>取消</Button><Button size="sm" type="submit">{savingCollection ? '保存中…' : '确认收款'}</Button></div>
                </fieldset>
              </form>}
            </div>
          )
        })}
        {adding && (
          <form
            className="flex flex-wrap items-center gap-2 py-2"
            onSubmit={async (e) => {
              e.preventDefault()
              const n = Number(amt)
              if (!n) return toast.error('填金额')
              if (await addReceivable(v.id, { amount: n, dueDate: due, tag, note })) {
                setAdding(false)
                setNote('')
                toast.success(`已记待收，${shortDate(due)} 到期提醒`)
              }
            }}
          >
            <input autoFocus aria-label="待收金额" inputMode="decimal" className={cn(inputCls, 'num h-8 w-24 text-right')} placeholder="金额" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
            <DateField  aria-label="预计日期" className={cn(inputCls, 'h-8 w-auto')} value={due} onChange={(e) => setDue(e.target.value)} />
            <SelectField aria-label="标签" className={cn(inputCls, 'h-8 w-auto')} value={tag} onChange={(e) => setTag(e.target.value)}>
              {s.payTags.filter((t) => t !== '退款').map((t) => (
                <option key={t}>{t}</option>
              ))}
            </SelectField>
            <input aria-label="备注" className={cn(inputCls, 'h-8 min-w-0 flex-1')} placeholder="备注（可空）" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button type="submit" size="sm" className="h-8">
              记下
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setAdding(false)}>
              取消
            </Button>
          </form>
        )}
        {closed.length > 0 && (
          <button onClick={() => setShowDone(!showDone)} className="py-1.5 text-left text-xs text-muted-foreground hover:text-foreground">
            {showDone ? '收起' : `已处理 ${closed.length} 笔`}
          </button>
        )}
        {showDone &&
          closed.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <span>{r.tag}</span>
              <span className="num">预计 {shortDate(r.dueDate)}</span>
              <span>{r.doneAt ? `已收 · ${relTime(r.doneAt)}` : '已取消'}</span>
              <Money value={r.amount} className={cn('ml-auto', r.cancelledAt && 'line-through')} />
            </div>
          ))}
      </div>
    </section>
  )
}
