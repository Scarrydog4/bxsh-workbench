import { useRef } from 'react'
import { FolderSimple, Paperclip } from '@phosphor-icons/react'
import { toast } from 'sonner'

export type ProjectPart = {file: File; path: string}
function fromPicker(files: FileList) {
  return Array.from(files,file=>({file,path:file.webkitRelativePath || file.name}))
}

async function walk(entry: FileSystemEntry, parent: string, files: ProjectPart[]) {
  const name = parent + entry.name
  if (entry.isFile) {
    const file = await new Promise<File>((resolve,reject)=>(entry as FileSystemFileEntry).file(resolve,reject))
    files.push({file,path:name})
  } else if(entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject))
      if (!batch.length) break
      for (const child of batch) await walk(child,name+'/',files)
    }
  }
}
export async function fromDrop(data: DataTransfer) {
  // The drop event's data becomes inaccessible after the first await.
  const items = Array.from(data.items).filter(i=>i.kind==='file').map(item=>({entry:item.webkitGetAsEntry?.(),file:item.getAsFile()}))
  if (!items.length) return fromPicker(data.files)
  const files: ProjectPart[] = []
  for (const item of items) {
    if (item.entry) await walk(item.entry,'',files)
    else if (item.file) files.push({file:item.file,path:item.file.webkitRelativePath || item.file.name})
    else throw new Error('无法读取拖入的文件，请使用「选择文件夹」')
  }
  return files
}
/** 工程附件：拖放由外层输入框统一接收，这里只提供选择入口和已选列表。 */
export function useProjectFiles({existing,files,change,removeExisting,reading,setReading,disabled}:{
  existing?:string|null; files:ProjectPart[]; change:(files:ProjectPart[])=>void; removeExisting:()=>void;
  reading:boolean; setReading:(reading:boolean)=>void; disabled:boolean
}) {
  const directory = useRef<HTMLInputElement>(null), single = useRef<HTMLInputElement>(null)
  function add(parts:ProjectPart[]) {
    if(!parts.length) return
    const paths = new Set(files.map(f=>f.path))
    for(const part of parts) {
      if(paths.has(part.path)) { toast.error('已选同路径文件：'+part.path);return }
      paths.add(part.path)
    }
    change([...files,...parts])
  }
  const iconButton = 'grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
  const controls = <>
    <button type="button" className={iconButton} aria-label="添加工程文件" title="添加工程文件" disabled={disabled || reading} onClick={()=>single.current?.click()}><Paperclip size={18} aria-hidden/></button>
    <button type="button" className={iconButton} aria-label="添加工程文件夹" title="添加工程文件夹" disabled={disabled || reading} onClick={()=>directory.current?.click()}><FolderSimple size={18} aria-hidden/></button>
    <input ref={single} aria-label="工程文件" className="hidden" type="file" multiple disabled={disabled || reading} onChange={e=>{if(e.target.files?.length)add(fromPicker(e.target.files));e.target.value=''}}/>
    <input ref={directory} aria-label="工程文件夹" className="hidden" type="file" multiple {...{webkitdirectory:''}} disabled={disabled || reading} onChange={e=>{if(e.target.files?.length)add(fromPicker(e.target.files));e.target.value=''}}/>
  </>
  const list = files.length>0 ? <details className="text-sm"><summary className="cursor-pointer">工程文件 {files.length} 个{existing?' · 保存后替换原附件':''}</summary>
      <ul className="max-h-36 overflow-auto">{files.map(part=><li key={part.path} className="flex items-center justify-between gap-2 border-b py-1"><span className="break-all">{part.path}</span><button disabled={disabled || reading} type="button" onClick={()=>change(files.filter(f=>f.path!==part.path))}>移除</button></li>)}</ul></details>
    : existing ? <div className="flex justify-between gap-2 text-sm"><span className="break-all">{existing}</span><button type="button" disabled={disabled || reading} onClick={removeExisting}>移除附件</button></div> : null
  return { add, controls, list }
}
