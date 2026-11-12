import { pageAction } from '../WorkspaceHeading'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { CasePreview } from './CasePreview'
import { copyCaseImage } from './case-image-copy'
import { Categories } from './Categories'
import { ChoiceRail } from '@/components/ui/choice-rail'
import { useState } from 'react'
import { Star, CopySimple, Check, DownloadSimple, FileZip, Paperclip, PencilSimple, MagnifyingGlass, Plus, GearSix, DotsThree, TextAlignLeft } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { canMaintainMaterials, UNCATEGORIZED, type Material, type MaterialKind } from '@/shared/work-materials'
import { fuzzyMatch } from '@/shared/search'
import { useSession } from '../store'
import { useCopyFeedback } from '../copy-feedback'
import { PageLoading } from '../PageLoading'
import { field, MaterialEditor } from './Forms'
import { request, useWorkData } from './data'

const toolbarIcon = 'inline-grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/10 aria-pressed:text-primary'

const actionIcon = 'inline-grid size-9 shrink-0 place-items-center rounded-md text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring'

function Copy({ entry, className = actionIcon, showLabel = false }: { entry: Material; className?: string; showLabel?: boolean }) {
  const feedback = useCopyFeedback(entry.id + entry.content)
  const copied = feedback.state === 'copied'
  const label = copied ? '已复制' : entry.kind === 'case' ? '复制文案' : '复制话术'
  const Idle = entry.kind === 'case' ? TextAlignLeft : CopySimple
  return <button type="button" className={className} aria-label={label} title={label} onClick={async () => {
    if (await feedback.copy(() => navigator.clipboard.writeText(entry.content)) === false) toast.error('复制失败，请手动选择文字')
  }}>{copied ? <Check size={18} aria-hidden/> : <Idle size={18} aria-hidden/>}{showLabel && <span>{label}</span>}</button>
}
function SaveImage({ entry, index = 0 }: { entry: Material; index?: number }) {
  const label = entry.images.length > 1 ? (index ? '保存这张图' : '保存封面') : '保存图片'
  return <a className={actionIcon} href={entry.images[index] + '&download=1'} download aria-label={label} title={label}><DownloadSimple size={18} aria-hidden/></a>
}
function SaveGallery({entry}: {entry:Material}) {
  if (entry.images.length < 2) return null
  return <a href={'/api/materials/'+entry.id+'/gallery'} download className={actionIcon} aria-label="保存全部图片" title="保存全部图片"><FileZip size={18} aria-hidden/></a>
}
function Attachment({ entry }: {entry: Material}) {
  if (!entry.fileName) return null
  return <a href={'/api/materials/'+entry.id+'/file'} download={entry.fileName} title={'下载附件：'+entry.fileName} aria-label={'下载附件：'+entry.fileName} className={actionIcon}><Paperclip size={18} aria-hidden/></a>
}
function TalkBrowser({ rows, edit }: { rows: Material[]; edit?: (entry: Material) => void }) {
  const [selected, select] = useState<string>()
  const current = rows.find(x => x.id === selected) ?? rows[0]
  return <div className="grid overflow-hidden rounded-xl border bg-card md:h-[min(640px,calc(100dvh-340px))] md:min-h-[320px] md:grid-cols-[240px_minmax(0,1fr)]">
    <ChoiceRail role="navigation" aria-label="话术列表" className="max-h-44 space-y-0.5 overflow-auto border-b p-1.5 md:max-h-none md:border-b-0 md:border-r">
      {rows.map(x => <button key={x.id} type="button" aria-current={x.id === current.id} onClick={() => select(x.id)}
        className={'block w-full rounded-md px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring '+(x.id === current.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')} title={x.title}><span className="block truncate">{x.title}</span><span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{x.category}</span></button>)}
    </ChoiceRail>
    <article className="relative flex min-h-64 min-w-0 flex-col">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0"><h3 className="break-words font-semibold">{current.title}</h3><span className="text-xs text-muted-foreground">{current.category}</span></div>
        {edit && <button type="button" className={actionIcon} aria-label="编辑话术" title="编辑话术" onClick={() => edit(current)}><PencilSimple size={17} aria-hidden/></button>}
      </header>
      <p key={current.id} className="polish-content-enter min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-5 py-5 text-sm leading-7 [overflow-wrap:anywhere]">{current.content}</p>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3"><span className="text-xs text-muted-foreground">复制后可直接粘贴发送</span><Copy key={current.id} entry={current} showLabel className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary/10 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15" /></footer>
    </article>
  </div>
}

const coverTool = 'grid size-8 sm:size-7 shrink-0 place-items-center rounded-md text-white/90 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50'
const revealed = 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [&:has([data-state=open])]:opacity-100 [@media(hover:none)]:opacity-100'

function CopyCover({ entry }: { entry: Material }) {
  const feedback = useCopyFeedback(entry.images[0])
  return <button type="button" aria-label={'复制封面图：'+entry.title} title="复制封面图" aria-busy={feedback.state === 'copying'} className={coverTool} onClick={async () => {
    const ok = await feedback.copy(() => copyCaseImage(entry.images[0]))
    if (ok) toast.success('已复制封面图，可以粘贴到微信')
    else if (ok === false) toast.error('复制失败，请下载图片后发送')
  }}>{feedback.state === 'copied' ? <Check size={15} aria-hidden/> : <CopySimple size={15} aria-hidden/>}</button>
}

function Card({ entry, preview, edit, reload }: { entry: Material; preview: (index:number) => void; edit?: () => void; reload: () => void }) {
  const [busy, setBusy] = useState(false)
  const lines = entry.content.split(/\r?\n/)
  const excerpt = (lines[0] === entry.title ? lines.slice(1).join(' ') : lines.join(' ')).trim()
  async function favorite() {
    setBusy(true)
    try { await request('/api/materials/' + entry.id, 'PATCH', { favorite: !entry.favorite }); reload() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return <article className="case-card group relative min-w-0 overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/40">
    <button type="button" aria-label={'查看'+entry.title} onClick={() => preview(0)} className="case-cover block aspect-[16/10] w-full overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      {entry.images[0] && <img src={entry.images[0]+'&thumb=1'} alt="" loading="lazy" className="size-full object-cover"/>}
    </button>
    {entry.images.length > 1 && <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-1.5 text-xs leading-5 text-white">{entry.images.length} 张</span>}
    <div className={'absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-black/55 p-0.5 backdrop-blur-sm '+(entry.favorite ? '' : revealed)}>
      {entry.images[0] && <CopyCover entry={entry}/>}
      <button type="button" title={entry.favorite ? '取消收藏' : '收藏案例'} aria-label={(entry.favorite ? '取消收藏' : '收藏') + entry.title} aria-pressed={entry.favorite} disabled={busy} onClick={favorite} className={coverTool+(entry.favorite ? ' text-amber-300 hover:text-amber-200' : '')}><Star aria-hidden weight={entry.favorite ? 'fill' : 'regular'} size={15}/></button>
      <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={'更多操作：'+entry.title} title="更多" className={coverTool}><DotsThree size={17} aria-hidden/></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { navigator.clipboard.writeText(entry.content).then(() => toast.success('已复制文案'), () => toast.error('复制失败，请手动选择文字')) }}>复制文案</DropdownMenuItem>
          {entry.images.length === 1 && <DropdownMenuItem asChild><a href={entry.images[0]+'&download=1'} download>保存图片</a></DropdownMenuItem>}
          {entry.images.length > 1 && <DropdownMenuItem asChild><a href={'/api/materials/'+entry.id+'/gallery'} download>保存全部图片</a></DropdownMenuItem>}
          {entry.fileName && <DropdownMenuItem asChild><a href={'/api/materials/'+entry.id+'/file'} download={entry.fileName}>下载附件</a></DropdownMenuItem>}
          {edit && <DropdownMenuItem onSelect={edit}>编辑案例</DropdownMenuItem>}
        </DropdownMenuContent></DropdownMenu>
    </div>
    <div className="px-2.5 pb-2.5 pt-2">
      <h3 className="truncate text-sm font-semibold leading-5" title={entry.title}>{entry.title}</h3>
      <p className="mt-0.5 min-h-[18px] truncate text-xs leading-[18px] text-muted-foreground" title={excerpt}>{excerpt === entry.title ? '' : excerpt}</p>
      <p className="mt-1 flex min-w-0 gap-2 text-xs leading-[18px]">
        <span className="truncate" title={entry.category}>{entry.category}</span>
        {entry.major && <span className="truncate text-primary" title={entry.major}>{entry.major}</span>}
      </p>
    </div>
  </article>
}
export function Library({ kind }: { kind: MaterialKind }) {
  const { me, role, s } = useSession(), isCase = kind === 'case', page = isCase ? 'cases' : 'talk'
  const maintain = canMaintainMaterials(role, me)
  const { data, error, reload } = useWorkData<Material[]>('/api/materials?kind=' + kind, me.id, s.version)
  const [category, setCategory] = useState('')
  const { data: categories, error: categoryError, reload: reloadCategories } = useWorkData<string[]>('/api/materials/categories?kind='+kind, me.id, s.version)
  const [managing, manage] = useState(false)
  const [search, setSearch] = useState(''), [favorites, setFavorites] = useState(false)
  const [editor, setEditor] = useState<Material | 'new' | null>(null), [preview, setPreview] = useState<{entry:Material;index:number} | null>(null)
  const reduced = useReducedMotion()
  const label = isCase ? '案例' : '话术'
  const names = categories ?? []
  const filter = category === UNCATEGORIZED || names.includes(category) ? category : ''
  const chips = ['', ...names, ...((data ?? []).some(x => x.category === UNCATEGORIZED) ? [UNCATEGORIZED] : [])]
  const rows = (data ?? []).filter(x => (!filter || x.category === filter) && (!favorites || x.favorite) && fuzzyMatch([x.title, x.major, x.category, x.content], search))
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card p-2.5">
      <label className="relative w-full sm:w-72"><MagnifyingGlass className="absolute left-3 top-3 text-muted-foreground"/><input className={field+' pl-9'} aria-label={'搜索'+label} placeholder={'搜索'+label+'名称或关键词'} value={search} onChange={e => setSearch(e.target.value)}/></label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{chips.map(t => <button key={t} aria-pressed={filter === t} onClick={() => setCategory(t)} className={'rounded-md px-3 py-1 text-sm transition-colors '+(filter===t?'bg-primary/10 font-medium text-primary':'hover:bg-muted')}>{t || '全部'}</button>)}</div>
      <div className="ml-auto flex items-center gap-1.5">
        {isCase && <button type="button" aria-label="我的收藏" title="我的收藏" aria-pressed={favorites} onClick={() => setFavorites(!favorites)} className={toolbarIcon}><Star size={19} aria-hidden weight={favorites ? 'fill' : 'regular'}/></button>}
        {maintain && categories && <button type="button" aria-label="管理分类" title="管理分类" aria-haspopup="dialog" className={toolbarIcon} onClick={()=>manage(true)}><GearSix size={19} aria-hidden/></button>}
        {maintain && <button className={pageAction} onClick={() => setEditor('new')}><Plus/>发布{label}</button>}
      </div>
    </div>
    {!data || !categories ? <PageLoading page={page} error={!!error || !!categoryError} onRetry={()=>{reload();reloadCategories()}}/> : <><div className="flex items-center gap-2">{favorites && <h2 className="font-semibold">我的收藏</h2>}<span className="text-sm text-muted-foreground">共 {rows.length} 个</span>{(isCase && filter || search || favorites) && <button className="ml-auto text-sm text-primary" onClick={() => {setSearch(''); setFavorites(false); setCategory('')}}>清空筛选</button>}</div>
    <motion.div key={JSON.stringify([search, filter, favorites])} initial={reduced ? false : {opacity:.5,y:3}} animate={{opacity:1,y:0}} transition={{duration:.15}} className={isCase ? 'grid grid-cols-2 items-start gap-3 sm:[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]' : ''}>
      {isCase && rows.map(x => <Card key={x.id} entry={x} preview={index => setPreview({entry:x,index})} edit={maintain ? () => setEditor(x) : undefined} reload={reload}/>)}
      {!isCase && rows.length > 0 && <TalkBrowser rows={rows} edit={maintain ? setEditor : undefined}/>}
      {!rows.length && <p className="col-span-full rounded-xl border bg-card p-10 text-center text-muted-foreground">{data.length ? '没有符合条件的'+label : '暂无已发布的'+label}</p>}
    </motion.div></>}
    {managing && <Categories kind={kind} names={names} close={()=>manage(false)} saved={change=>{
      if(change.action==='add') setCategory(change.name)
      if(change.action==='rename' && category===change.name) setCategory(change.next)
      if(change.action==='remove' && category===change.name) setCategory('')
      reloadCategories(); reload()
    }}/>}
    {editor && <MaterialEditor entry={editor==='new'?undefined:editor} kind={kind} category={filter || UNCATEGORIZED} close={() => setEditor(null)} saved={reload}/>}
    {preview && <CasePreview entry={preview.entry} index={preview.index} select={index => setPreview({...preview,index})} close={()=>setPreview(null)}
      actions={<><Copy entry={preview.entry}/><SaveImage entry={preview.entry} index={preview.index}/><SaveGallery entry={preview.entry}/><Attachment entry={preview.entry}/></>}/>}
  </section>
}
