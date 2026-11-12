import { PageHeader } from './ui'
import { SelectField } from './SelectField'
import { SlidingSegments } from '@/components/ui/sliding-segments'
import { Disclosure } from '@/components/ui/disclosure'
import { LoadingList } from './PageLoading'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PenNib, Coins, UploadSimple, FileDoc, DownloadSimple, ArrowClockwise, CheckCircle, Clock, GearSix, WarningCircle, CaretRight, ArrowRight, Plus, Info } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Combobox, Empty, inputCls } from './ui'
import { useSession } from './store'
import { useNav } from './nav'
import { fileSize } from './files'
import { relTime } from '@/shared/format'
import { MAX_REWRITE_BATCH, MAX_REWRITE_INPUT, MAX_REWRITE_TEXT, REWRITE_LABELS, REWRITE_LANGUAGES, type RewriteLanguage, type WordStats, type RewriteService, type RewriteJobView, type RewritePlatform } from '@/shared/toolbox'
import { cn } from '@/lib/utils'
import type { PointsView } from '@/shared/points'
import { PointsDialog } from './PointsDialog'
import { RewriteLogin } from './RewriteLogin'
import { wordStats } from './word-stats'
import { captureRewriteDrop, snapshotRewriteFile, rewriteNetworkMessage, type RewriteFileSource } from './rewrite-file'

type PendingBatch = { requestId: string; jobIds: string[]; expectedPoints: number }
type UploadRow = { id: string; file?: File; attachmentId?: string; orderId: string; name: string; size: number; text?: string; stats?: WordStats; statsError?: boolean; reading?: boolean; readError?: string }
type Seed = { orderId: string; attachmentId: string }
interface Connection { available: boolean; levelName: string; levelValue: number; expiresAt: string | null; membershipEnd: string | null }
interface Catalog { connection?: Connection | null; platforms: RewritePlatform[]; error: string | null; configured: boolean; manage: boolean; billing: string }

export function ToolboxPage({ seed, clearSeed }: { seed: Seed | null; clearSeed: () => void }) {
  const { views, me, can } = useSession()
  const { openOrder } = useNav()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [jobs, setJobs] = useState<RewriteJobView[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [wallet, setWallet] = useState<PointsView | null>(null)
  const [pointsOpen, setPointsOpen] = useState(false)
  const [error, setError] = useState('')
  const [files, setFiles] = useState<UploadRow[]>([])
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([])
  const [pending, setPending] = useState<PendingBatch | null>(null)
  const [progress, setProgress] = useState('')
  const [platform, setPlatform] = useState('')
  const [language, setLanguage] = useState<RewriteLanguage>('CN')
  const [service, setService] = useState<RewriteService>('降AI')
  const [platformName, setPlatformName] = useState('')
  const [inputKind, setInputKind] = useState<'file' | 'text'>('file')
  const [text, setText] = useState('')
  const [textOrderId, setTextOrderId] = useState('')
  const [whitelist, setWhitelist] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [settings, setSettings] = useState(false)
  const [over, setOver] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const jobRequest = useRef(false)
  const catalogRequest = useRef(false)
  const mounted = useRef(true)
  const chosen = catalog?.platforms.find((p) => p.id === platform)
  const canUse = can('toolbox.use')
  const manage = can('toolbox.manage')

  const pendingKey = `bxsh:pending-rewrite:${me.id}`
  const draftJobs = jobs.filter((j) => j.status === 'draft' && j.userId === me.id)
  const modes = (catalog?.platforms ?? []).filter((p) => p.service === service && p.languages.includes(language))
  const platformNames = [...new Set(modes.map((p) => p.platform ?? p.name))]
  const modeOptions = modes.filter((p) => p.platform === platformName)
  const platformPlaceholder = catalogLoading ? '正在加载平台…' : catalog?.error ? '平台加载失败' : !platformNames.length ? '暂无可用平台' : '选择平台'
  const uploads: UploadRow[] = inputKind === 'text'
    ? (text.trim() ? [{ id: 'text', name: '文本改写.txt', orderId: textOrderId, size: text.length, text }] : []) : files
  const fileNotReady = uploads.some((row) => row.reading || !!row.readError)
  const totalFiles = uploads.length + selectedDrafts.length
  const totalPoints = totalFiles * (wallet?.price?.points ?? 0)
  const fieldCls = cn(inputCls, 'h-11 min-w-0 text-left [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>svg]:shrink-0 rounded-lg border-0 bg-muted/70 px-3 text-sm font-medium text-foreground shadow-none focus-visible:ring-2 focus-visible:ring-primary/25')
  const needsSelection = uploads.length > 0 || selectedDrafts.length === 0
  const submitHint = submitting ? '正在提交，请稍候'
    : pending ? '使用原批次继续确认，不会重复扣费'
    : catalogLoading ? '正在加载平台和模式，请稍候'
    : catalog?.error ? '平台加载失败，请点击“重新加载”'
    : catalog?.connection?.available === false ? '会员尚未开通或已过期，请联系管理员'
    : needsSelection && !platformName ? '请先选择检测平台'
    : needsSelection && !chosen ? '请选择改写模式'
    : !totalFiles ? inputKind === 'file' ? '请上传 Word 文件' : '请粘贴正文'
    : fileNotReady ? uploads.some((row) => row.reading) ? '正在读取文件，完成后即可处理' : '请移除读取失败的文件后重新选择'
    : !wallet?.price ? '等待管理员设置积分价格'
    : wallet.available < totalPoints ? '积分不足，请联系管理员'
    : '已准备好，处理完成后可在记录中下载'
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(pendingKey) ?? 'null')
      if (saved?.requestId && Array.isArray(saved.jobIds) && Number.isInteger(saved.expectedPoints)) setPending(saved)
    } catch { /* 无待恢复批次 */ }
  }, [pendingKey])
  useEffect(() => {
    if (!seed) return
    setInputKind('file')
    const a = views.find((o) => o.id === seed.orderId)?.attachments.find((a) => a.id === seed.attachmentId)
    if (a) { setFiles([{ id: crypto.randomUUID(), attachmentId: a.id, orderId: seed.orderId, name: a.name, size: a.size }]); clearSeed() }
  }, [seed, views])

  const loadJobs = useCallback(async (showLoading = false) => {
    if (jobRequest.current) return
    jobRequest.current = true
    if (showLoading) setJobsLoading(true)
    try {
      const r = await fetch('/api/toolbox', { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? '读取处理记录失败')
      if (mounted.current) { setJobs(data.jobs); setWallet(data.points); setError('') }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '连接暂时中断，稍后刷新记录') }
    finally { jobRequest.current = false; if (mounted.current) setJobsLoading(false) }
  }, [])
  const loadCatalog = useCallback(async () => {
    if (catalogRequest.current) return
    catalogRequest.current = true
    setCatalogLoading(true)
    try {
      const r = await fetch('/api/toolbox/platforms', { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? '读取检测平台失败')
      if (mounted.current) setCatalog(data)
    } catch (e) {
      if (mounted.current) setCatalog({ platforms: [], error: e instanceof Error ? e.message : '连接暂时中断', configured: false, manage: false, billing: '每次处理固定积分，由管理员设置' })
    } finally {
      catalogRequest.current = false
      if (mounted.current) setCatalogLoading(false)
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    void loadJobs(); void loadCatalog()
    const timer = setInterval(() => { if (!document.hidden) void loadJobs() }, 10_000)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [loadJobs, loadCatalog, me.id])

  function take(incoming: RewriteFileSource[]) {
    const valid = incoming.filter(({ file: f }) => /\.docx$/i.test(f.name) && f.size && f.size <= MAX_REWRITE_INPUT)
    if (valid.length !== incoming.length) toast.error('请选择 10MB 以内的 DOCX 文件；DOC 请先另存为 DOCX')
    if (files.length + selectedDrafts.length + valid.length > MAX_REWRITE_BATCH) return toast.error('每批最多 20 份稿件')
    const added = valid.map(({ file, reopen }) => ({ id: crypto.randomUUID(), file: undefined as File | undefined, reading: true, orderId: '', name: file.name, size: file.size, original: file, reopen }))
    setFiles((rows) => [...rows, ...added])
    for (const row of added) void (async () => {
      let file: File
      try { file = await snapshotRewriteFile(row.original, row.reopen) }
      catch (e) {
        if (mounted.current) setFiles((rows) => rows.map((r) => r.id === row.id ? { ...r, reading: false, readError: (e as Error).message } : r))
        return
      }
      if (mounted.current) setFiles((rows) => rows.map((r) => r.id === row.id ? { ...r, file, size: file.size, reading: false } : r))
      try {
        const stats = await wordStats(file)
        if (mounted.current) setFiles((rows) => rows.map((r) => r.id === row.id ? { ...r, stats } : r))
      } catch { if (mounted.current) setFiles((rows) => rows.map((r) => r.id === row.id ? { ...r, statsError: true } : r)) }
    })()
    clearSeed()
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || fileNotReady || !pending && (catalogLoading || !!catalog?.error || (!chosen && uploads.length > 0) || !totalFiles || !wallet?.price)) return
    setSubmitting(true)
    let commit = pending
    try {
      if (!commit) {
        const ids = [...selectedDrafts]
        for (let i = 0; i < uploads.length; i++) {
          const row = uploads[i]
          setProgress(`上传稿件 ${i + 1}/${uploads.length}`)
          const form = new FormData()
          form.set('platform', platform); form.set('language', language); form.set('expectedPoints', '0'); form.set('whitelist', whitelist)
          if (row.orderId) form.set('orderId', row.orderId)
          if (row.text !== undefined) form.set('text', row.text)
          else if (row.attachmentId) form.set('attachmentId', row.attachmentId)
          else if (row.file) form.set('file', row.file)
          const r = await fetch('/api/toolbox/prepare', { method: 'POST', body: form })
          const data = await r.json()
          if (!r.ok) throw new Error(data.error ?? '上传失败，已上传稿件可在记录中继续确认')
          ids.push(data.id)
        }
        commit = { requestId: crypto.randomUUID(), jobIds: [...new Set(ids)], expectedPoints: wallet!.price!.points }
        // 保存成功才发送确认；收到不明确的回应时保留原批次编号。
        localStorage.setItem(pendingKey, JSON.stringify(commit))
        setPending(commit)
      }
      setProgress('确认批次和积分…')
      const r = await fetch('/api/toolbox/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commit) })
      const data = await r.json()
      if (!r.ok) {
        if (r.status >= 400 && r.status < 500) { localStorage.removeItem(pendingKey); setPending(null) }
        throw new Error(data.error ?? '确认下单失败')
      }
      localStorage.removeItem(pendingKey); setPending(null)
      toast.success(`${data.createdCount} 份稿件已排队，预占 ${data.totalPoints} 积分${data.reusedCount ? `；${data.reusedCount} 份已有原任务，不重复扣费` : ''}`)
      setFiles([]); setText(''); setSelectedDrafts([]); clearSeed()
    } catch (e) { toast.error(rewriteNetworkMessage(e, !!commit)); }
    finally { setSubmitting(false); setProgress(''); await loadJobs() }
  }

  const connected = useCallback(() => {
    toast.success('微信登录成功，工具连接已恢复')
    setSettings(false)
    void loadCatalog()
  }, [loadCatalog])

  const returningLogin = useRef(false)
  useEffect(() => {
    const url = new URL(window.location.href), id = url.searchParams.get('rewriteLogin')
    if (!id || !/^[a-f0-9]{32}$/.test(id) || returningLogin.current) return
    returningLogin.current = true
    url.searchParams.delete('rewriteLogin')
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
    void (async () => {
      try {
        const response = await fetch('/api/toolbox/connection/wechat', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
        const data = await response.json()
        if (!response.ok || data.status !== 'connected') throw new Error(data.error ?? '登录未完成，请在服务设置中重新扫码')
        window.location.replace('/tools')
      } catch (e) { toast.error(e instanceof Error ? e.message : '登录暂未完成，请重新扫码') }
    })()
  }, [])


  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6 text-sm text-foreground">
      <PageHeader className="pb-0 [&_h1]:text-xl [&_h1]:font-semibold" title="工具箱">
        <div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setPointsOpen(true)}><Coins size={16} />{can('points.manage') ? '分配积分' : `我的积分 ${wallet?.available ?? '—'}`}</Button>{manage && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSettings(true)}><GearSix size={16} />服务设置</Button>}</div>
      </PageHeader>
      {canUse && (
        <form onSubmit={submit} className="overflow-hidden rounded-2xl bg-card shadow-[0_4px_28px_-10px_rgba(15,40,35,0.20)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-6 sm:px-7">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><PenNib size={23} weight="duotone" /></span>
              <div><h2 className="text-base font-semibold">{inputKind === 'file' ? 'Word 批量改写' : '文字改写'}</h2><p className="mt-0.5 text-xs text-muted-foreground">{inputKind === 'file' ? '先选平台和模式，再上传稿件，完成后直接下载' : '粘贴正文，完成后下载改写结果'}</p></div>
            </div>
            <button type="button" disabled={submitting || !!pending} onClick={() => setInputKind(inputKind === 'file' ? 'text' : 'file')} className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">{inputKind === 'file' ? '文字改写' : '返回文件改写'}<ArrowRight size={16} /></button>
          </div>
          <div className="grid gap-5 p-5 sm:p-7">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="grid content-start gap-2 sm:col-span-3"><span className="text-sm font-semibold text-foreground">处理方式</span>
                <SlidingSegments value={service} label="处理功能" className="h-12" disabled={submitting || !!pending}
                  options={[{ value: '降重', label: '降重' }, { value: '降AI', label: '降 AI' }, { value: '双降', label: '双降' }]}
                  onValueChange={(value) => { setService(value); setPlatform(''); setPlatformName(''); if (!(catalog?.platforms ?? []).some((p) => p.service === value && p.languages.includes(language))) setLanguage('CN') }} />
              </div>
              <div className="grid min-w-0 content-start gap-2"><label htmlFor="rewrite-language" className="text-sm font-medium text-foreground">稿件语言</label>
                <SelectField id="rewrite-language" className={fieldCls} value={language} disabled={submitting || !!pending || catalogLoading || !!catalog?.error} onChange={(e) => { setLanguage(e.target.value as RewriteLanguage); setPlatform(''); setPlatformName('') }}>{Object.entries(REWRITE_LANGUAGES).map(([value, label]) => <option key={value} value={value} disabled={!(catalog?.platforms ?? []).some((p) => p.service === service && p.languages.includes(value as RewriteLanguage))}>{label}</option>)}</SelectField>
              </div>
              <div className="grid min-w-0 content-start gap-2"><label htmlFor="rewrite-platform" className="text-sm font-medium text-foreground">检测平台</label>
                <SelectField id="rewrite-platform" className={fieldCls} value={platformName} disabled={submitting || !!pending || catalogLoading || !platformNames.length || !!catalog?.error} aria-busy={catalogLoading} onChange={(e) => { setPlatformName(e.target.value); setPlatform('') }}><option value="">{platformPlaceholder}</option>{platformNames.map((name) => <option key={name} value={name}>{name}</option>)}</SelectField>
              </div>
              <div className="grid min-w-0 content-start gap-2"><label htmlFor="rewrite-mode" className="text-sm font-medium text-foreground">改写模式</label>
                <SelectField id="rewrite-mode" title={chosen?.modeName} className={fieldCls} value={platform} disabled={submitting || !!pending || catalogLoading || !!catalog?.error || !platformName} onChange={(e) => setPlatform(e.target.value)}><option value="">{platformName ? '选择模式' : '请先选择平台'}</option>{modeOptions.map((p) => <option key={p.id} value={p.id} disabled={!!catalog?.connection?.available && (p.permissionLevel ?? 0) > catalog.connection.levelValue}>{p.modeName}{(p.permissionLevel ?? 0) > 0 ? ' · SVIP' : ''}</option>)}</SelectField>
              </div>
            </div>
            {catalogLoading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowClockwise size={16} className="animate-spin" />正在加载平台和模式…</p>
              : (catalog?.error || !platformNames.length) && <div role="alert" className="flex items-start gap-2 text-sm text-danger"><WarningCircle className="mt-0.5 shrink-0" size={16} /><span>{catalog?.error ?? '当前处理方式和语言暂无可用平台，请切换或刷新'} {manage && <button type="button" className="mr-2 underline" onClick={() => setSettings(true)}>微信扫码登录</button>}<button type="button" className="underline" onClick={() => void loadCatalog()}>重新加载</button></span></div>}
            {inputKind === 'text' ? <div className="grid gap-2">
              <label htmlFor="rewrite-text" className="sr-only">待处理正文</label>
              <textarea id="rewrite-text" className={cn(inputCls, 'min-h-52 resize-y py-3 leading-6')} value={text} maxLength={MAX_REWRITE_TEXT} disabled={submitting || !!pending} onChange={(e) => setText(e.target.value)} placeholder="粘贴需要降重或降 AI 的正文" />
              <div className="flex justify-between text-xs text-muted-foreground"><span>最多 10 万字</span><span>{text.length.toLocaleString()} 字</span></div>
              <Disclosure className="text-xs text-muted-foreground" triggerClassName="w-fit gap-1 py-1" summary={<><CaretRight size={12} className="disclosure-chevron" />关联订单（可选）</>}><div className="mt-2"><Combobox value={textOrderId} onChange={setTextOrderId} options={[{ value: '', label: '独立处理，不关联订单' }, ...views.map((v) => ({ value: v.id, label: `${v.no} · ${v.title}` }))]} placeholder="选择订单" /></div></Disclosure>
            </div> : <div className="grid gap-3">
              <input ref={picker} type="file" accept=".docx" multiple className="hidden" disabled={submitting || !!pending} onChange={(e) => { if (e.target.files) take(Array.from(e.target.files, (file) => ({ file }))); e.target.value = '' }} />
              <button type="button" disabled={submitting || !!pending} onClick={() => picker.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); if (!submitting && !pending) take(captureRewriteDrop(e.dataTransfer)) }}
                className={cn('group/upload flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary/[.045] px-4 text-center transition-colors hover:border-primary hover:bg-primary/[.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', 'min-h-[200px] py-6 sm:min-h-[240px]', over && 'border-primary bg-primary/15 ring-2 ring-primary/40')}>
                <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary"><UploadSimple size={30} /></span><span className="text-base font-semibold text-foreground">{files.length ? '继续添加 Word 文件' : '点击上传 Word，或将文件拖到这里'}</span><span className="text-xs text-muted-foreground">支持批量 1–20 份 · DOCX · 每份不超过 10MB</span>
              </button>
              {files.length > 0 && <div className="overflow-hidden rounded-xl bg-muted/40"><div className="flex items-center justify-between px-4 pb-1 pt-3 text-sm"><span className="font-medium">待处理文件 · {files.length} 份</span><button type="button" disabled={submitting || !!pending} onClick={() => setFiles([])} className="text-muted-foreground hover:text-danger">清空</button></div><div className="max-h-72 overflow-y-auto">{files.map((row) => <div key={row.id} className="px-4 py-3">
                <div className="flex items-center gap-2"><FileDoc size={21} className="shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate text-sm font-medium" title={row.name}>{row.name}</span><span className="shrink-0 text-xs text-muted-foreground">{fileSize(row.size)}</span><button type="button" disabled={submitting || !!pending} className="shrink-0 px-1 text-xs text-muted-foreground hover:text-danger" onClick={() => setFiles((rows) => rows.filter((r) => r.id !== row.id))}>移除</button></div>
                <div className="ml-7 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{row.stats ? <><span>中文 {row.stats.chinese.toLocaleString()} 字</span><span>英文 {row.stats.english.toLocaleString()} 词</span><span>{row.stats.paragraphs.toLocaleString()} 段</span><span>总字数 {row.stats.total.toLocaleString()}</span></> : <span className={row.readError ? 'text-danger' : undefined}>{row.readError ?? (row.reading ? '正在读取本机文件…' : row.statsError ? '暂无法统计字数，可继续提交' : '正在统计字数…')}</span>}</div>
                <Disclosure className="ml-7 mt-1 text-xs text-muted-foreground" triggerClassName="w-fit gap-1 py-0.5" summary={<><CaretRight size={12} className="disclosure-chevron" />{row.orderId ? `关联订单：${views.find((v) => v.id === row.orderId)?.no ?? '已关联'}` : '关联订单（可选）'}</>}><div className={cn('mt-2 max-w-lg', (submitting || pending || row.attachmentId) && 'pointer-events-none opacity-60')}><Combobox value={row.orderId} onChange={(id) => setFiles((rows) => rows.map((r) => r.id === row.id ? { ...r, orderId: id, attachmentId: id === r.orderId ? r.attachmentId : undefined } : r))} options={[{ value: '', label: '独立处理，不关联订单' }, ...views.map((v) => ({ value: v.id, label: `${v.no} · ${v.title}` }))]} placeholder="选择订单" /></div></Disclosure>
              </div>)}</div></div>}
            </div>}
            {draftJobs.length > 0 && <div className="grid gap-2 rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">已上传、未下单 · 勾选后继续处理（尚未扣费）</p>{draftJobs.map((j) => <label key={j.id} className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={submitting || !!pending} checked={selectedDrafts.includes(j.id)} onChange={(e) => { if (e.target.checked && totalFiles >= MAX_REWRITE_BATCH) return toast.error('每批最多 20 份稿件'); setSelectedDrafts((ids) => e.target.checked ? [...ids, j.id] : ids.filter((id) => id !== j.id)) }} /><span className="break-all">{j.name} · {j.platform}{j.orderNo ? ` · ${j.orderNo}` : ''}</span></label>)}</div>}
            <Disclosure className="text-sm" triggerClassName="w-fit py-1 font-medium text-primary hover:text-primary/80" summary={<><Plus size={16} className="disclosure-plus" /><span className="disclosure-closed-label">{whitelist.trim() ? '编辑保留词句' : '添加保留词句'}</span><span className="disclosure-open-label">收起保留词句</span><span className="text-xs font-normal text-muted-foreground">可选</span></>}>
              <div className="grid gap-2 pt-3"><label htmlFor="rewrite-whitelist" className="text-sm text-foreground">需要原样保留的术语或句子</label><textarea id="rewrite-whitelist" className={cn(inputCls, 'min-h-20 resize-y py-2 text-sm')} maxLength={10000} value={whitelist} disabled={submitting || !!pending} onChange={(e) => setWhitelist(e.target.value)} placeholder="用逗号或换行分隔" /><p className="text-xs leading-5 text-muted-foreground">返回稿完整保留通道的改写内容。关联订单后，返回稿自动保存到订单附件。</p></div>
            </Disclosure>
            {catalog?.connection && !catalog.connection.available && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">当前账号尚未开通会员或会员已过期。开通后可在服务设置中刷新连接。</p>}
            {pending && <p role="alert" className="text-xs text-primary">上次批次尚未收到确认结果。继续确认会使用原编号，不重复下单扣费。</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-5 bg-muted/35 px-5 py-5 sm:px-7">
            <div className="grid gap-1.5">
              <div className="flex items-center gap-2"><span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{wallet?.available ?? '—'}</span><span className="text-sm text-muted-foreground">可用积分</span><button type="button" aria-label="积分规则：成功扣费，失败退回，关闭页面后继续处理" title="每份按固定积分计费。成功扣费，失败退回；关闭页面后任务继续处理。" className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Info size={16} /></button></div>
              <p className="text-sm text-muted-foreground">{wallet?.price ? `每份 ${wallet.price.points} 积分` : '价格待设置'}{totalFiles > 0 && <span className="ml-3 text-foreground">已选 {totalFiles} 份，合计 <strong className="font-semibold">{totalPoints} 积分</strong></span>}</p>
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:min-w-64">
              <Button type="submit" aria-describedby="rewrite-submit-hint" disabled={submitting || fileNotReady || !pending && (catalogLoading || (!chosen && uploads.length > 0) || !totalFiles || !!catalog?.error || catalog?.connection?.available === false || !wallet?.price || wallet.available < totalPoints)} className="h-12 w-full gap-2 rounded-xl px-6 text-base font-semibold shadow-sm disabled:opacity-70">
                {submitting ? <ArrowClockwise size={19} className="animate-spin" /> : <PenNib size={19} />} {submitting ? progress : pending ? '继续确认原批次' : totalFiles ? `开始处理 · ${totalFiles} 份` : '开始处理'}
              </Button>
              <p id="rewrite-submit-hint" role="status" className="text-center text-xs leading-5 text-muted-foreground">{submitHint}</p>
            </div>
          </div>
        </form>
      )}
      <Disclosure triggerClassName="gap-2 py-2 text-sm font-semibold text-foreground" summary={<><CaretRight size={16} className="disclosure-chevron shrink-0" />{manage ? '全部处理记录' : '我的处理记录'}<span className="ml-2 text-xs font-normal text-muted-foreground">最近 100 条</span></>}>
        <div className="grid gap-3 pb-4" aria-busy={jobsLoading}>
        <div className="flex justify-end"><Button variant="ghost" size="sm" className="gap-1.5" disabled={jobsLoading} onClick={() => void loadJobs(true)}><ArrowClockwise size={14} className={jobsLoading ? 'animate-spin motion-reduce:animate-none' : undefined} />{jobsLoading ? '加载中…' : error ? '重试' : '刷新'}</Button></div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {jobsLoading && jobs.length === 0 ? <div role="status" aria-label="正在加载处理记录"><LoadingList rows={3} /></div> : jobs.length === 0 ? error ? null : <Empty icon={<Clock size={22} />} title="还没有处理记录" hint="提交后会在这里显示进度，关闭页面也会继续处理" /> : (
          <div className="overflow-hidden rounded-xl bg-card shadow-sm">
            {jobs.map((j) => <div key={j.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:flex-nowrap">
              <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', j.status === 'completed' ? 'bg-ok/10 text-ok' : j.status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground')}>{j.status === 'completed' ? <CheckCircle size={23} /> : j.status === 'failed' ? <WarningCircle size={23} /> : <FileDoc size={23} />}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={j.name}>{j.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{j.platform} · {REWRITE_LANGUAGES[j.language]}</span><span>· {relTime(j.createdAt)}</span>{manage && <span>· {j.actorName}</span>}{j.points > 0 && <span>· {j.points} 积分</span>}{j.orderId && <button className="text-primary hover:underline" onClick={() => openOrder(j.orderId!, undefined, 'files')}>{j.orderNo}</button>}</div>
                {j.message && <p className="mt-1 text-xs text-muted-foreground">{j.message}</p>}
                {(j.status === 'unknown' || j.status === 'failed') && <p className="mt-1 break-all text-[12px] text-muted-foreground">任务编号：{j.id}</p>}
              </div>
              <span role="status" className={cn('shrink-0 rounded-full px-2 py-1 text-xs', j.status === 'completed' ? 'bg-ok/10 text-ok' : j.status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground')}>{REWRITE_LABELS[j.status]}{j.status === 'processing' && j.progress !== undefined ? ` ${j.progress}%` : ''}</span>
              {j.status === 'completed' && j.hasDiff && <a className="text-xs text-primary hover:underline" href={`/api/toolbox/${j.id}/result?variant=diff`}>彩色对比稿</a>}
              <a className="text-xs text-muted-foreground hover:underline" href={`/api/toolbox/${j.id}/result?variant=source`}>原文件</a>
              {j.status === 'completed' && <a className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent" href={`/api/toolbox/${j.id}/result`}><DownloadSimple size={14} />{j.service === 'AI预测' ? '历史测试报告' : '下载改写稿'}</a>}
            </div>)}
          </div>
        )}
        </div>
      </Disclosure>
      <Dialog open={settings} onOpenChange={setSettings}><DialogContent><DialogHeader><DialogTitle>写作牛服务设置</DialogTitle><DialogDescription>管理员统一维护登录，团队成员直接使用。</DialogDescription></DialogHeader>
        <dl className="grid grid-cols-[90px_1fr] gap-y-3 text-sm"><dt className="text-muted-foreground">连接状态</dt><dd>{catalog?.error ?? (catalog?.configured ? '登录有效' : '尚未连接')}</dd><dt className="text-muted-foreground">会员状态</dt><dd>{catalog?.connection?.available ? catalog.connection.levelName : '未开通或已过期'}</dd><dt className="text-muted-foreground">登录有效期</dt><dd>{catalog?.connection?.expiresAt ? new Date(catalog.connection.expiresAt).toLocaleString() : '—'}</dd><dt className="text-muted-foreground">文件大小</dt><dd>输入 10MB 以内，返回稿 40MB 以内</dd></dl>
        {settings && manage && <RewriteLogin onConnected={connected} />}
      </DialogContent></Dialog>
      <PointsDialog open={pointsOpen} onOpenChange={setPointsOpen} wallet={wallet} reload={loadJobs} />
    </div>
  )
}
