import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { deny, notFound, route } from '@/server/http'
import { canSeePaymentCodes, paymentCodeHash, paymentCodePath } from '@/server/company-resources'
import { PAYMENT_CODES, PAYMENT_CODE_LABELS, type PaymentCodeKind } from '@/shared/company-resources'

const thumbs = new Map<string, Buffer>()

export const GET = route<{ kind: string }>(async (req, c, { kind }) => {
  if (!canSeePaymentCodes(c)) throw deny()
  if (!PAYMENT_CODES.includes(kind as PaymentCodeKind)) throw notFound()
  const codeKind = kind as PaymentCodeKind, hash = await paymentCodeHash(codeKind), q = new URL(req.url).searchParams
  if (!hash || q.has('v') && q.get('v') !== hash) throw notFound('收款码已更新，请刷新后重试')
  const bytes = await readFile(paymentCodePath(hash)).catch(() => null)
  if (!bytes) throw notFound('还没有上传收款码')
  // 卡片上只要一张小图；地址带内容哈希，换图后地址就变，可以长期缓存
  if (q.has('thumb')) {
    let small = thumbs.get(hash)
    if (!small) { small = await sharp(bytes).resize(160, 160, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); thumbs.set(hash, small) }
    return new Response(new Uint8Array(small), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } })
  }
  const headers: Record<string, string> = { 'content-type': 'image/png', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
  if (q.has('download')) headers['content-disposition'] = `attachment; filename="${kind}-payment-code.png"; filename*=UTF-8''${encodeURIComponent(PAYMENT_CODE_LABELS[codeKind]+'.png')}`
  return new Response(new Uint8Array(bytes), { headers })
})
