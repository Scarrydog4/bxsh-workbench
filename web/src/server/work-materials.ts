import { alias } from 'drizzle-orm/pg-core'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { newFilePath, safeName } from './files'
import { uid } from './ids'
import { storeCaseOriginal, serveCaseImage, galleryArchive } from './case-originals'
import { and, desc, eq, isNull, count, sql } from 'drizzle-orm'
import { z } from 'zod'
import { canMaintainMaterials, UNCATEGORIZED, type ReviewMessage } from '@/shared/work-materials'
import { can } from '@/shared/perm'
import { log, WRITE_LOCK } from './actions'
import { db } from './db'
import { materials, materialCategories, materialFavorites, qualityReviews, orders, orderWriters, users } from './schema'
import { saveWorkImage } from './images'
import { env } from './env'
import { fileResponse } from './range-response'
import { bad, deny, notFound, HttpError } from './http'
import type { Ctx } from './session'
import { broadcast } from './events'

const word = (max: number) => z.string().trim().min(1).max(max)
export const imageData = z.string().startsWith('data:image/').max(11_000_000)
const storedImage = z.string().regex(/^\/api\/materials\/[a-zA-Z0-9_-]+\/image\?v=[a-f0-9]{64}$/)
const materialImageUrl = (id: string, hash: string) => `/api/materials/${id}/image?v=${hash}`
export const materialInput = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), kind: z.enum(['case', 'talk']), title: word(120).optional(), content: word(8000),
  category: word(40).default(UNCATEGORIZED), major: z.string().trim().max(80).optional(), image: imageData.optional(),
  pictures: z.array(z.union([imageData, storedImage, z.file()])).min(1).optional(),
  removeFile: z.boolean().optional(),
})
export const reviewInput = z.object({
  id: z.uuid(), orderId: word(80), writerId: word(80), title: word(120), issue: z.string().trim().max(8000).default(''),
  image: imageData.optional(), images: z.array(imageData).max(5).optional(),
}).refine(data => (data.image ? 1 : 0) + (data.images?.length ?? 0) <= 5 &&
  (!!data.issue || !!data.image || !!data.images?.length), '请填写复盘内容或添加截图，最多 5 张')
export function requireLibrary(c: Ctx) { if (!can(c.role, 'order.view')) throw deny() }
export function requireMaterialMaintainer(c: Ctx) { if (!canMaintainMaterials(c.role, c.me)) throw deny() }
export function requireReview(c: Ctx) {
  if (!c.role.locked && !(can(c.role, 'order.view') && c.me.canWrite)) throw deny()
}
export async function readBody<T>(req: Request, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw bad('请检查必填内容、文字长度和图片格式')
  return parsed.data
}
export async function listMaterials(c: Ctx, kind: 'case' | 'talk') {
  requireLibrary(c)
  const rows = await db.select({ material: materials, favorite: materialFavorites.userId }).from(materials)
    .leftJoin(materialFavorites, and(eq(materialFavorites.materialId, materials.id), eq(materialFavorites.userId, c.me.id)))
    .where(eq(materials.kind, kind)).orderBy(desc(materials.updatedAt), materials.id)
  return rows.map(({ material: { imageHash, extraImageHashes, originalFormats: _formats, filePath: _privatePath, ...entry }, favorite }) => ({
    ...entry, favorite: !!favorite, image: imageHash ? materialImageUrl(entry.id, imageHash) : null,
    images: imageHash ? [imageHash, ...extraImageHashes].map(hash => materialImageUrl(entry.id, hash)) : [],
  }))
}
export async function saveMaterial(c: Ctx, body: z.infer<typeof materialInput>, create: boolean, file?: File) {
  requireMaterialMaintainer(c)
  const { image, pictures, removeFile, ...entry } = body
  const isCase = entry.kind === 'case'
  if (!isCase && (!entry.title || file)) throw bad('请填写话术标题，附件仅用于案例')
  if (!isCase && pictures) throw bad('只有案例可以上传图片组')
  const newFormats: Record<string,string> = {}
  const uploads: { hash: string; existing: boolean }[] = []
  for (const src of pictures ?? (isCase && image ? [image] : [])) {
    if (typeof src !== 'string' || src.startsWith('data:')) {
      const {hash,ext} = await storeCaseOriginal(src)
      uploads.push({hash,existing:false}); newFormats[hash] = ext
    } else {
      const hash = src.split('?v=')[1]
      if (src !== materialImageUrl(entry.id, hash)) throw bad('图片不属于当前案例')
      uploads.push({hash, existing:true})
    }
  }
  const newPath = file ? await newFilePath(uid('case')) : null
  let obsolete: string | null = null
  try {
    if (file && newPath) await pipeline(file.stream() as NodeReadableStream<Uint8Array>, createWriteStream(newPath, {flags:'wx'}))
    obsolete = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
      const [old] = await tx.select().from(materials).where(eq(materials.id, entry.id))
      if (!create && (!old || old.kind !== entry.kind)) throw notFound()
      if (create && old) throw new HttpError(409, '素材已发布，请刷新列表')
      const previous = old?.imageHash ? [old.imageHash, ...old.extraImageHashes] : []
      if (uploads.some(x => x.existing && !previous.includes(x.hash))) throw bad('案例图片已变更，请重新打开')
      const supplied = uploads.map(x => x.hash)
      const gallery = pictures ? supplied : image && isCase ? [...supplied, ...previous.slice(1)] : previous
      const [imageHash = null, ...extraImageHashes] = gallery
      if (isCase && !imageHash) throw bad('请添加案例封面')
      if (entry.category !== UNCATEGORIZED && old?.category !== entry.category) {
        const [known] = await tx.select().from(materialCategories).where(and(eq(materialCategories.kind, entry.kind), eq(materialCategories.name, entry.category)))
        if (!known) throw bad('分类已变更，请重新选择分类')
      }
      const firstLine = (content: string) => content.split(/\r?\n/)[0].slice(0, 120)
      const keepTitle = old && old.title !== firstLine(old.content)
      const knownFormats = {...old?.originalFormats, ...newFormats}
      const originalFormats = Object.fromEntries(gallery.filter(hash => knownFormats[hash]).map(hash => [hash,knownFormats[hash]]))
      const row = { ...entry, originalFormats, title: entry.title ?? (keepTitle ? old.title : firstLine(entry.content)),
        major: entry.major ?? old?.major ?? '', imageHash, extraImageHashes, updatedAt: new Date().toISOString(),
        filePath: newPath ?? (removeFile ? null : old?.filePath ?? null),
        fileName: file ? safeName(file.name) : removeFile ? null : old?.fileName ?? null }
      if (create) await tx.insert(materials).values(row)
      else await tx.update(materials).set(row).where(eq(materials.id, entry.id))
      await log(tx, c, { action: create ? '发布素材' : '编辑素材', objectType: 'material', objectId: entry.id, objectLabel: row.title })
      return old?.filePath && old.filePath !== row.filePath ? old.filePath : null
    })
  } catch (error) {
    if (newPath) await rm(newPath, {force:true})
    throw error
  }
  if (obsolete) await rm(obsolete, {force:true})
  broadcast('changed', [])
}
export async function removeMaterial(c: Ctx, id: string) {
  requireMaterialMaintainer(c)
  const obsolete = await db.transaction(async tx => {
    const [row] = await tx.delete(materials).where(eq(materials.id, id)).returning()
    if (!row) throw notFound()
    await log(tx, c, { action: '移除素材', objectType: 'material', objectId: id, objectLabel: row.title })
    return row.filePath
  })
  if (obsolete) await rm(obsolete, {force:true})
  broadcast('changed', [])
}
export async function favoriteMaterial(c: Ctx, id: string, favorite: boolean) {
  requireLibrary(c)
  await db.transaction(async tx => {
    const [entry] = await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.id, id), eq(materials.kind, 'case'))).for('key share')
    if (!entry) throw notFound()
    if (favorite) await tx.insert(materialFavorites).values({ userId: c.me.id, materialId: id }).onConflictDoNothing()
    else await tx.delete(materialFavorites).where(and(eq(materialFavorites.userId, c.me.id), eq(materialFavorites.materialId, id)))
  })
}
function reviewScope(c: Ctx) {
  requireReview(c)
  return c.role.locked ? undefined : eq(qualityReviews.writerId, c.me.id)
}
export async function reviewCount(c: Ctx) {
  const [row] = await db.select({ count: count() }).from(qualityReviews)
    .where(and(reviewScope(c), eq(qualityReviews.status, c.role.locked ? 'waiting' : 'pending')))
  return row.count
}
export async function listReviews(c: Ctx) {
  const owners = alias(users, 'review_owner')
  const rows = await db.select({ r: qualityReviews, orderNo: orders.no, orderTitle: orders.title, writerName: users.name, ownerId: orders.ownerId, ownerName: owners.name })
    .from(qualityReviews).innerJoin(orders, eq(qualityReviews.orderId, orders.id)).innerJoin(users, eq(qualityReviews.writerId, users.id)).leftJoin(owners, eq(orders.ownerId, owners.id))
    .where(reviewScope(c)).orderBy(desc(qualityReviews.createdAt))
  return rows.map(({ r: { imageHash, extraImageHashes, ...r }, ...info }) => ({ ...r, ...info,
    image: imageHash ? `/api/reviews/${r.id}/image` : null,
    images: [imageHash, ...extraImageHashes].filter((hash): hash is string => !!hash).map(hash => `/api/reviews/${r.id}/image?v=${hash}`),
  }))
}
export async function createReview(c: Ctx, input: z.infer<typeof reviewInput>) {
  if (!c.role.locked) throw deny()
  const { image, images, ...entry } = input
  const [imageHash = null, ...extraImageHashes] = await Promise.all([...(image ? [image] : []), ...(images ?? [])].map(saveWorkImage))
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const [writer] = await tx.select({ id: users.id }).from(orderWriters)
      .innerJoin(orders, eq(orders.id, orderWriters.orderId)).innerJoin(users, eq(users.id, orderWriters.userId))
      .where(and(eq(orders.id, entry.orderId), isNull(orders.deletedAt), eq(users.id, entry.writerId), eq(users.active, true), eq(users.canWrite, true)))
    if (!writer) throw bad('请选择这笔订单当前负责的写手')
    const [saved] = await tx.insert(qualityReviews).values({ ...entry, imageHash, extraImageHashes, creatorId: c.me.id }).onConflictDoNothing().returning()
    if (!saved) throw new HttpError(409, '这条复盘已发起，请刷新列表')
    await log(tx, c, { action: '发起复盘', objectType: 'qualityReview', objectId: entry.id })
  })
  broadcast('changed', [])
}
type ReviewAction = {action:'reply';reply:string;images?:string[]} | {action:'supplement';note:string;images?:string[]} | {action:'confirm'}
export async function transitionReview(c: Ctx, id: string, input: ReviewAction, version?: number) {
  requireReview(c)
  const writer = input.action === 'reply'
  if (!writer && !c.role.locked) throw deny()
  const pictures = input.action === 'confirm' ? [] : await Promise.all((input.images ?? []).map(saveWorkImage))
  await db.transaction(async tx => {
    const where = and(eq(qualityReviews.id,id), writer ? eq(qualityReviews.writerId,c.me.id) : undefined)
    const [row] = await tx.select().from(qualityReviews).where(where).for('update')
    if (!row) throw notFound()
    if (row.status !== (writer ? 'pending' : 'waiting') ||
        (version !== undefined ? version !== row.history.length : row.history.some(m => m.type === 'supplement'))) {
      throw new HttpError(409,'复盘已更新，请查看最新回复后再操作')
    }
    const now = new Date().toISOString()
    if (input.action === 'confirm') {
      await tx.update(qualityReviews).set({status:'done',confirmedAt:now}).where(where)
    } else {
      const text = input.action === 'reply' ? input.reply : input.note
      const message: ReviewMessage = {type:input.action,text,...(pictures.length ? {images:pictures} : {}),actorId:c.me.id,actorName:c.me.name,at:now}
      await tx.update(qualityReviews).set({history:[...row.history,message], ...(input.action === 'reply'
        ? {status:'waiting' as const,reply:text,repliedAt:now} : {status:'pending' as const})}).where(where)
    }
    const actions = {reply:'回复复盘',confirm:'确认复盘',supplement:'要求补充复盘'}
    await log(tx,c,{action:actions[input.action],objectType:'qualityReview',objectId:id})
  })
  broadcast('changed', [])
}
export async function downloadCaseGallery(c: Ctx, id: string) {
  requireLibrary(c)
  const [row] = await db.select().from(materials).where(and(eq(materials.id,id),eq(materials.kind,'case')))
  if (!row?.imageHash) throw notFound()
  return galleryArchive(row.title,[row.imageHash,...row.extraImageHashes],row.originalFormats)
}
export async function workImage(req: Request, c: Ctx, id: string, review: boolean) {
  if (!review) requireLibrary(c)
  const [row] = review
    ? await db.select({ hash: qualityReviews.imageHash, extras: qualityReviews.extraImageHashes, title: qualityReviews.title, history: qualityReviews.history }).from(qualityReviews).where(and(eq(qualityReviews.id, id), reviewScope(c)))
    : await db.select({ hash: materials.imageHash, extras: materials.extraImageHashes, formats: materials.originalFormats, title: materials.title }).from(materials).where(eq(materials.id, id))
  if (!row) throw notFound()
  const query = new URL(req.url).searchParams
  const requested = query.get('v') ?? row.hash
  const gallery = [row.hash, ...row.extras, ...('history' in row ? row.history.flatMap(message => message.images ?? []) : [])].filter((hash): hash is string => !!hash)
  if (!requested) throw notFound()
  const index = gallery.indexOf(requested)
  if (index < 0) throw notFound()
  if ('formats' in row) {
    const title = row.title + (gallery.length > 1 ? '-' + (index + 1) : '')
    return serveCaseImage(req, requested, row.formats[requested], title)
  }
  const name = requested + '.webp'
  return fileResponse(req, { path: path.join(env.storageDir, 'private-images', name), name, mime: 'image/webp', id: name, inline: true, cacheControl: 'private, no-store' })
}
