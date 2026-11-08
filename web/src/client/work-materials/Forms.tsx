import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ImageSquare } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { AppDialogContent, AppDialogBody, AppDialogHeader } from '@/components/ui/app-dialog'
import { imageFilesFromTransfer } from '../image-input'
import { UNCATEGORIZED, type Material, type MaterialKind } from '@/shared/work-materials'
import { fromDrop, useProjectFiles, type ProjectPart } from './ProjectFiles'
import { request } from './data'

export const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm'
export const button = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50'
export const primary = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50'
export function Frame({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return <Dialog open onOpenChange={open => !open && close()}><AppDialogContent size="md" aria-describedby={undefined}>
    <AppDialogHeader><DialogTitle>{title}</DialogTitle></AppDialogHeader>
    <AppDialogBody className="p-5">{children}</AppDialogBody>
  </AppDialogContent></Dialog>
}

/** 案例图片：保留原文件，第一张作封面。 */
function useCaseImages(initial: string[] = []) {
  const [images, setImages] = useState(initial)
  const originals = useRef(new Map<string,File>())
  useEffect(() => {
    for (const url of originals.current.keys()) {
      if (!images.includes(url)) { URL.revokeObjectURL(url); originals.current.delete(url) }
    }
  },[images])
  useEffect(() => {
    const files = originals.current
    return () => { for (const url of files.keys()) URL.revokeObjectURL(url); files.clear() }
  },[])
  function pick(files: File[]) {
    if (!files.length) return
    const added = files.map(file => { const url = URL.createObjectURL(file); originals.current.set(url,file); return url })
    setImages(old => [...old, ...added])
  }
  function paste(e: React.ClipboardEvent) {
    const files = imageFilesFromTransfer(e.clipboardData)
    if (files.length) { e.preventDefault(); e.stopPropagation(); pick(files) }
  }
  const previews = images.length > 0 && <ol className="flex flex-wrap gap-2 px-3 pb-2">{images.map((src,i) => <li key={src+i} className="relative w-20">
    <img src={src.startsWith('/api/') ? src+'&thumb=1' : src} alt={'案例图 '+(i+1)} className="aspect-square w-full rounded-md border object-cover"/>
    <button type="button" aria-label={'移除第 '+(i+1)+' 张图片'} className="absolute right-0 top-0 rounded bg-black/75 px-1.5 text-white" onClick={()=>setImages(rows=>rows.filter((_,index)=>index!==i))}>×</button>
    {i===0 ? <span className="block text-center text-xs text-muted-foreground">封面</span> : <button type="button" className="w-full text-xs text-primary" onClick={()=>setImages(rows=>[rows[i],...rows.filter((_,index)=>index!==i)])}>设为封面</button>}
  </li>)}</ol>
  return { source:(url:string)=>originals.current.get(url) ?? url, images, pick, paste, previews }
}

export function MaterialEditor({ kind, entry, category, close, saved }: { kind: MaterialKind; entry?: Material; category: string; close: () => void; saved: () => void }) {
  const isCase = kind === 'case', label = isCase ? '案例' : '话术'
  const [id] = useState(() => entry?.id ?? crypto.randomUUID())
  const image = useCaseImages(entry?.images), [busy, setBusy] = useState(false), [over, setOver] = useState(false)
  const imagePicker = useRef<HTMLInputElement>(null)
  const [remove, setRemove] = useState(false)
  const [files,setFiles] = useState<ProjectPart[]>([]), [removeFile,setRemoveFile] = useState(false)
  const [readingProject,setReadingProject] = useState(false)
  const project = useProjectFiles({existing:removeFile?null:entry?.fileName,files,change:setFiles,removeExisting:()=>setRemoveFile(true),reading:readingProject,setReading:setReadingProject,disabled:busy})
  async function drop(e: React.DragEvent) {
    e.preventDefault(); setOver(false)
    if (busy || readingProject) return
    const data = fromDrop(e.dataTransfer)
    setReadingProject(true)
    try {
      const parts = await data
      const isImage = (part: ProjectPart) => part.file.type.startsWith('image/') && !part.path.includes('/')
      image.pick(parts.filter(isImage).map(part => part.file))
      project.add(parts.filter(part => !isImage(part)))
    } catch { toast.error('文件读取失败，请重新选择') } finally { setReadingProject(false) }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isCase && !image.images.length) { toast.error('请粘贴案例图片'); return }
    const values = new FormData(e.currentTarget)
    values.set('kind',kind); values.set('id',id); values.set('category',(entry ? entry.category : category) || UNCATEGORIZED)
    if (isCase) image.images.forEach(src => values.append('pictures',image.source(src)))
    for (const part of files) {
      values.append('filePath',part.path)
      values.append('file',part.file,part.file.name)
    }
    if (removeFile) values.set('removeFile','true')
    setBusy(true)
    try {
      await request('/api/materials', entry ? 'PUT' : 'POST', values)
      saved(); close()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  async function withdraw() {
    setBusy(true)
    try { await request('/api/materials/' + id, 'DELETE'); saved(); close() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return <Frame title={(entry ? '编辑' : '发布') + label} close={() => !busy && close()}>
    <form onSubmit={submit} onPaste={image.paste} className="grid gap-3">
      <input required maxLength={120} name="title" aria-label="标题" placeholder="标题" className={field} defaultValue={entry?.title} />
      {isCase ? <div className={'rounded-md border bg-background focus-within:ring-2 focus-within:ring-primary/30 '+(over ? 'border-primary bg-primary/5' : '')}
        onDragOver={e=>{e.preventDefault();setOver(true)}} onDragLeave={()=>setOver(false)} onDrop={drop}>
        <textarea required name="content" aria-label="案例文案" maxLength={8000} rows={5} placeholder="写文案，图片和工程文件直接粘贴或拖进来" className="block w-full resize-y rounded-md bg-transparent px-3 py-2 text-sm outline-none" defaultValue={entry?.content} />
        {image.previews}
        <div className="flex items-center justify-end gap-1 px-2 pb-2">
          {readingProject && <span className="mr-auto pl-1 text-sm text-muted-foreground">正在读取…</span>}
          <button type="button" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" aria-label="添加图片" title="添加图片" onClick={()=>imagePicker.current?.click()}><ImageSquare size={18} aria-hidden/></button>
          <input ref={imagePicker} type="file" accept="image/*" multiple aria-label="选择图片" className="hidden" onChange={e=>{image.pick(Array.from(e.target.files ?? []));e.target.value=''}}/>
          {project.controls}
        </div>
      </div> : <textarea required name="content" aria-label="话术内容" placeholder="话术内容" maxLength={8000} className={field} rows={6} defaultValue={entry?.content} />}
      {isCase && project.list}
      <div className="flex flex-wrap justify-end gap-2">{entry && <button type="button" className={button + ' mr-auto'} disabled={busy} onClick={() => remove ? void withdraw() : setRemove(true)}>{remove ? '确认移除' : '移除'}</button>}
      <button className={primary} disabled={busy || readingProject}>{busy ? '处理中…' : entry ? '保存' : '发布'}</button></div>
    </form></Frame>
}
