import { z } from 'zod'
import { bad } from './http'
import { MAX_REWRITE_INPUT, MAX_REWRITE_TEXT } from '@/shared/toolbox'

export async function rewriteInput(req: Request, draftOnly = false) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_REWRITE_INPUT + 64_000) throw bad('每份稿件不能超过 10MB')
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = req.body?.getReader()
  if (!reader) throw bad('请选择文件和检测平台')
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_REWRITE_INPUT + 64_000) { await reader.cancel(); throw bad('每份稿件不能超过 10MB') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bounded = new Request(req.url, { method: 'POST', headers: { 'content-type': req.headers.get('content-type') ?? '' }, body: Buffer.concat(chunks) })
  const form = await bounded.formData().catch(() => null)
  if (!form) throw bad('请选择文件和检测平台')
  const parsed = z.object({ platform: z.string().min(1).max(128), language: z.enum(['CN', 'EN', 'RU', 'JA']), orderId: z.string().max(128).optional(),
    attachmentId: z.string().max(128).optional(), expectedPoints: z.number().int().min(draftOnly ? 0 : 1), text: z.string().min(1).max(MAX_REWRITE_TEXT).optional(), whitelist: z.string().max(10000).default('') })
    .safeParse({ platform: form.get('platform'), language: form.get('language'), orderId: form.get('orderId') || undefined,
      attachmentId: form.get('attachmentId') || undefined, expectedPoints: Number(form.get('expectedPoints')), text: form.get('text') || undefined, whitelist: form.get('whitelist') || '' })
  if (!parsed.success) throw bad('请选择检测平台并确认本次处理积分')
  const file = form.get('file')
  if (parsed.data.text && (file instanceof File || parsed.data.attachmentId)) throw bad('文本和 Word 文件请分别提交')
  return { ...parsed.data, file: file instanceof File ? file : undefined, draftOnly }
}
