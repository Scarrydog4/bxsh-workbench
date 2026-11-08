import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { db } from './db'
import { options } from './schema'
import { env } from './env'
import { can } from '@/shared/perm'
import { log, WRITE_LOCK } from './actions'
import { broadcast } from './events'
import type { Ctx } from './session'
import { bad, deny } from './http'
import { PAYMENT_CODES, PAYMENT_CODE_LABELS, type PaymentCodeKind, type PaymentCodeView } from '@/shared/company-resources'

const keyFor = (kind: PaymentCodeKind) => `company-payment-code:${kind}`
export const canSeePaymentCodes = (c: Ctx) => c.role.locked || can(c.role, 'order.create')
export const paymentCodePath = (hash: string) => path.join(env.storageDir, 'company-payment-codes', `${hash}.png`)
export async function paymentCodeHash(kind: PaymentCodeKind) {
  const [row] = await db.select().from(options).where(eq(options.key, keyFor(kind)))
  const hash = row?.values[0]
  return hash && /^[a-f0-9]{64}$/.test(hash) ? hash : null
}
export async function paymentCodeView(): Promise<PaymentCodeView> {
  const entries = await Promise.all(PAYMENT_CODES.map(async kind => { const hash = await paymentCodeHash(kind); return [kind, hash ? `/api/resources/payments/${kind}/image?v=${hash}` : null] }))
  return Object.fromEntries(entries) as PaymentCodeView
}
export async function savePaymentCode(c: Ctx, kind: PaymentCodeKind, image: string) {
  if (!c.role.locked) throw deny('只有老板能更换收款码')
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image) || image.length > 11_000_000) throw bad('请选择 8MB 以内的 PNG、JPG 或 WebP 图片')
  const bytes = Buffer.from(image.split(',')[1], 'base64')
  if (!bytes.length || bytes.length > 8_000_000) throw bad('请选择 8MB 以内的图片')
  // 收款码不裁切、不缩小、不做有损压缩。
  const png = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer().catch(() => null)
  if (!png) throw bad('图片无法读取，请重新选择')
  const hash = createHash('sha256').update(png).digest('hex')
  await mkdir(path.dirname(paymentCodePath(hash)), { recursive: true })
  await writeFile(paymentCodePath(hash), png)
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`)
    const [previous] = await tx.select().from(options).where(eq(options.key, keyFor(kind)))
    if (previous?.values[0] === hash) return
    await tx.insert(options).values({ key: keyFor(kind), values: [hash] }).onConflictDoUpdate({ target: options.key, set: { values: [hash] } })
    await log(tx, c, { action: '更新收款码', objectType: 'resource', objectId: kind, objectLabel: PAYMENT_CODE_LABELS[kind], from: previous?.values[0] ? '原收款码' : '未设置', to: '已更新' })
  })
  broadcast('changed')
  return paymentCodeView()
}
