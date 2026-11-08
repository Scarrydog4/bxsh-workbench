import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import JSZip from 'jszip'
import { env } from './env'
import { bad } from './http'
import { fileResponse } from './range-response'
import { safeName } from './files'

const directory = () => path.join(env.storageDir, 'case-originals')
const formats: Record<string,string> = {jpeg:'jpg', png:'png', webp:'webp', gif:'gif', avif:'avif'}

// Rename only completed files so concurrent uploads of the same image never expose partial bytes.
async function writeAtomic(target: string, bytes: Buffer) {
  const tmp = target + '.' + randomUUID()
  try { await writeFile(tmp,bytes); await rename(tmp,target) }
  finally { await rm(tmp,{force:true}) }
}
export async function storeCaseOriginal(source: File | string) {
  const bytes = typeof source === 'string' ? Buffer.from(source.slice(source.indexOf(',')+1),'base64') : Buffer.from(await source.arrayBuffer())
  const image = sharp(bytes,{limitInputPixels:100_000_000})
  const meta = await image.metadata().catch(()=>{throw bad('图片无法读取，请重新选择')})
  const format = meta.format === 'heif' && meta.compression === 'av1' ? 'avif' : meta.format
  const ext = formats[format]
  if (!ext) throw bad('请选择 PNG、JPG、GIF、WebP 或 AVIF 图片')
  const thumb = await image.rotate().resize({width:900,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer().catch(()=>{throw bad('无法生成案例缩略图')})
  const hash = createHash('sha256').update(bytes).digest('hex')
  await mkdir(directory(),{recursive:true})
  await Promise.all([writeAtomic(path.join(directory(),hash+'.'+ext),bytes),writeAtomic(path.join(directory(),hash+'.thumb.webp'),thumb)])
  return {hash,ext}
}
function imageFile(hash: string, original: string | undefined, thumb = false) {
  if (!original) return {path:path.join(env.storageDir,'private-images',hash+'.webp'),ext:'webp'}
  const ext = thumb ? 'webp' : original
  return {path:path.join(directory(),hash+(thumb?'.thumb':'')+'.'+ext),ext}
}
export async function serveCaseImage(req: Request, hash: string, format: string | undefined, name: string) {
  const q = new URL(req.url).searchParams
  const { path: filename, ext } = imageFile(hash,format,q.has('thumb') && !q.has('download'))
  return fileResponse(req,{path:filename,name:safeName(name)+'.'+ext,id:hash+'-'+ext+(q.has('thumb')?'-thumb':''),mime:'image/'+(ext==='jpg'?'jpeg':ext),inline:!q.has('download'),cacheControl:'private, no-store'})
}
export function galleryArchive(title: string, hashes: string[], originals: Record<string,string>) {
  const zip = new JSZip()
  const digits = Math.max(2, String(hashes.length).length)
  hashes.forEach((hash,index)=>{
    const file = imageFile(hash,originals[hash])
    const name = String(index+1).padStart(digits,'0')+'.'+file.ext
    zip.file(name,Readable.from((async function*(){ yield* createReadStream(file.path) })()))
  })
  const name = encodeURIComponent(safeName(title)+'.zip').replace(/'/g,'%27')
  const stream = zip.generateNodeStream({streamFiles:true,compression:'STORE'})
  return new Response(Readable.toWeb(stream as Readable) as ReadableStream,{headers:{
    'content-type':'application/zip','content-disposition':`attachment; filename="case.zip"; filename*=UTF-8''${name}`,
    'cache-control':'private, no-store','vary':'Cookie, Authorization','x-content-type-options':'nosniff',
  }})
}
