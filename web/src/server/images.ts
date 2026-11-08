import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { env } from './env'
import type { Tx } from './db'
import * as t from './schema'
import { bad } from './http'
import { uid } from './ids'

function decode(data: string) {
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(data)) throw bad('只能上传图片')
  const bytes = Buffer.from(data.split(',')[1], 'base64')
  if (bytes.length > 8_000_000) throw bad('图片太大')
  return bytes
}
export function orderImageHash(data: string) { return createHash('sha256').update('image-v1').update(decode(data)).digest('hex') }
async function output(data: string, avatar: boolean) {
  const bytes = decode(data)
  const hash = createHash('sha256').update(avatar ? 'avatar-v1' : 'image-v1').update(bytes).digest('hex')
  const dir = path.join(env.storageDir, avatar ? 'avatars' : 'private-images')
  await mkdir(dir,{recursive:true})
  try {
    const original = sharp(bytes,{limitInputPixels:40_000_000}).rotate()
    const full = await (avatar ? original.resize(256,256,{fit:'cover'}) : original.resize(1800,1800,{fit:'inside',withoutEnlargement:true})).webp({quality:88}).toBuffer()
    const thumb = await sharp(full).resize(avatar ? 96 : 256,avatar ? 96 : 256,{fit:avatar?'cover':'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer()
    const fullPath = path.join(dir,`${hash}.webp`), thumbPath = path.join(dir,`${hash}.${avatar?96:256}.webp`)
    await Promise.all([writeFile(fullPath,full),writeFile(thumbPath,thumb)])
    return {hash,fullPath,thumbPath,size:full.length}
  } catch { throw bad('图片无法读取，请换一张截图') }
}
export async function saveAvatar(data: string) {
  return `/api/img/${(await output(data,true)).hash}.96.webp`
}
export async function saveOrderImage(tx: Tx, data: string, input: {orderId:string;by:string;afterSaleId?:string;purpose:'aftersale-shot'|'payment-proof'|'comment-shot'|'cost-proof'}) {
  const image = await output(data,false), id=uid('img')
  await tx.insert(t.attachments).values({...input,id,name:'截图.webp',size:image.size,mime:'image/webp',path:image.fullPath,thumbPath:image.thumbPath,preview:`/api/files/${id}?thumb=1`})
  return id
}
/** 工资凭证只挂在结算单上，不进入订单附件。 */
export async function saveSettlementImages(images: string[], batchId: string, existing: string[]) {
  const result: string[] = []
  for (const image of images) {
    if (image.startsWith('data:')) result.push(`/api/settle/${batchId}/images/${(await output(image, false)).hash}`)
    else if (existing.includes(image)) result.push(image)
    else throw bad('截图不属于这张结算单')
  }
  return [...new Set(result)]
}
/** 报销单据独立鉴权，不挂到订单附件或工资凭证。 */
export async function saveReimbursementImages(images: string[], id: string, existing: string[]) {
  const result: string[] = []
  for (const image of images) {
    if (image.startsWith('data:')) result.push(`/api/reimbursements/${id}/images/${(await output(image, false)).hash}`)
    else if (existing.includes(image)) result.push(image)
    else throw bad('截图不属于这张报销单')
  }
  return [...new Set(result)]
}
/** 平台反馈截图只允许提交人和老板读取。 */
export async function saveFeedbackImages(images: string[], id: string, existing: string[]) {
  const result: string[] = []
  for (const image of images) {
    if (image.startsWith('data:')) result.push(`/api/feedback/${id}/images/${(await output(image, false)).hash}`)
    else if (existing.includes(image)) result.push(image)
    else throw bad('截图不属于这条反馈')
  }
  return [...new Set(result)]
}
/** 渠道款只存一份凭证，通过整笔收款权限鉴权。 */
export async function saveChannelReceiptImage(image: string, id: string) {
  return `/api/channel-receipts/${id}/images/${(await output(image, false)).hash}`
}
export const privateImageUrl = (id: string) => `/api/files/${id}?inline=1`
export async function savePreview(data: string) {
  return (await output(data,false)).thumbPath
}

/** 直接从已上传原图生成小图，浏览器不必再解码、编码和发送一次。 */
export async function attachmentPreview(filePath: string) {
  try {
    const bytes = await sharp(filePath, { limitInputPixels: 40_000_000 }).rotate().resize(256, 256, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
    const dir = path.join(env.storageDir, 'private-images')
    await mkdir(dir, { recursive: true })
    const target = path.join(dir, `${createHash('sha256').update(bytes).digest('hex')}.256.webp`)
    await writeFile(target, bytes)
    return target
  } catch {
    // 普通附件也可包含当前解码器不支持的图片，原文件仍可下载。
    return null
  }
}

/** 素材和复盘各自鉴权，不写入能从订单详情下载的附件列表。 */
export async function saveWorkImage(data: string) {
  return (await output(data, false)).hash
}
