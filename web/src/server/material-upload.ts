import busboy from 'busboy'
import archiver from 'archiver'
import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { bad } from './http'

type Part = {key:string; value:string} | {key:string; stage:string; filename:string; mime:string}
async function readParts(req: Request, dir: string) {
  if (!req.body) throw bad('没有收到上传内容')
  const parts: Part[] = [], writes: Promise<void>[] = []
  const parser = busboy({headers:Object.fromEntries(req.headers), defParamCharset:'utf8', limits:{fieldSize:11_000_000}})
  parser.on('field',(key,value,info)=>{
    if(info.valueTruncated) parser.destroy(bad('上传字段过大'))
    else parts.push({key,value})
  })
  parser.on('file',(key,stream,info)=>{
    const stage = path.join(dir,String(parts.length))
    parts.push({key,stage,filename:info.filename,mime:info.mimeType})
    const writing = pipeline(stream,createWriteStream(stage,{flags:'wx'}))
    writes.push(writing)
    writing.catch(error=>parser.destroy(error))
  })
  try {
    await pipeline(Readable.fromWeb(req.body as NodeReadableStream<Uint8Array>),parser)
    await Promise.all(writes)
  } catch {
    await Promise.allSettled(writes)
    throw bad('文件上传未完成，请重新提交')
  }
  return parts
}
type ProjectFile = {relative:string;stage:string}
function projectFiles(parts: Part[]) {
  const paths = parts.filter(p=>p.key==='filePath' && 'value' in p).map(p=>'value' in p ? p.value : '')
  const files = parts.filter(p=>p.key==='file')
  if (paths.length && paths.length !== files.length) throw bad('工程文件清单不完整')
  const seen = new Set<string>()
  const entries: ProjectFile[] = files.map((file,i)=>{
    if(!('stage' in file)) throw bad('附件必须是文件')
    const relative = paths[i] ?? file.filename
    if (!relative || /[\\:\x00-\x1f]/.test(relative) || relative.split('/').some(x=>!x || x==='.' || x==='..'))
      throw bad('工程内有无效路径：'+relative)
    if (seen.has(relative)) throw bad('工程内有重复文件：'+relative)
    seen.add(relative)
    return {relative,stage:file.stage}
  })
  for (const file of entries) {
    const segments = file.relative.split('/')
    while (segments.length > 1) {
      segments.pop()
      if (seen.has(segments.join('/'))) throw bad('文件与目录重名：'+segments.join('/'))
    }
  }
  return entries
}
async function packageProject(files: ProjectFile[], dir:string) {
  const first = files[0]
  if(files.length===1 && !first.relative.includes('/')) return new File([await openAsBlob(first.stage)],first.relative)
  const archivePath = path.join(dir,'project.zip')
  const archive = archiver('zip',{store:true})
  archive.on('warning',error=>archive.destroy(error))
  const written = pipeline(archive,createWriteStream(archivePath,{flags:'wx'}))
  for(const file of files) archive.file(file.stage,{name:file.relative})
  await Promise.all([archive.finalize(),written])
  const root = first.relative.split('/')[0]
  const name = files.every(f=>f.relative.startsWith(root+'/')) ? root+'.zip' : '工程附件.zip'
  return new File([await openAsBlob(archivePath)],name)
}

/** Spool binary parts to disk; only publish once every project file has arrived. */
export async function withMaterialUpload<T>(req: Request, fn:(form:FormData,file?:File)=>Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(),'bxsh-case-'))
  try {
    const parts = await readParts(req,dir)
    const files = projectFiles(parts)
    const form = new FormData()
    for(const part of parts) {
      if (part.key==='file' || part.key==='filePath') continue
      if ('value' in part) form.append(part.key,part.value)
      else form.append(part.key,await openAsBlob(part.stage,{type:part.mime}),part.filename)
    }
    return await fn(form,files.length ? await packageProject(files,dir) : undefined)
  } finally { await rm(dir,{recursive:true,force:true}) }
}
