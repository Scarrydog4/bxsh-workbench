import { readFile, writeFile, rename } from 'node:fs/promises'
import { route, bad, json } from '@/server/http'
import { jobVisible } from '@/server/toolbox'
import { downloadRewrite, wordExtension, ProviderError } from '@/server/rewrite-provider'

const downloads = new Map<string, Promise<Buffer>>()
export const GET = route<{ id: string }>(async (req, c, p) => {
  const job = await jobVisible(c, p.id)
  const query = new URL(req.url).searchParams
  const variant = query.get('variant') ?? 'result'
  if (!['source', 'result', 'diff', 'pdf', 'data'].includes(variant)) throw bad('请选择有效的文件')
  if (variant !== 'source' && (job.status !== 'completed' || !job.resultPath || !job.resultName)) throw bad('结果文件还未保存完成')
  let bytes: Buffer, name = job.resultName ?? job.name
  try {
    if (variant === 'source') { bytes = await readFile(job.sourcePath); name = job.name }
    else if (variant === 'data') {
      if (!job.providerState.detection) throw bad('此任务没有预测数据')
      bytes = Buffer.from(JSON.stringify(job.providerState.detection, null, 2)); name = `${job.name}_AI预测.json`
    } else if (variant === 'diff' || variant === 'pdf') {
      if (variant === 'diff' && !job.providerState.diffUrl) throw bad('此任务没有对比文档')
      if (variant === 'pdf' && (!job.providerState.reportFiles?.pdf_enabled || !job.providerState.reportFiles?.pdf_summary_url)) throw bad('上游暂未提供 PDF 报告')
      const cache = `${job.resultPath}.${variant}`
      try { bytes = await readFile(cache) } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        let pending = downloads.get(cache)
        if (!pending) {
          pending = (async () => {
            const raw = await downloadRewrite(job.id, job.providerState, variant)
            if (variant === 'diff' && wordExtension(raw) !== '.docx') throw bad('对比文档暂不可用')
            if (variant === 'pdf' && !raw.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw bad('PDF 报告暂不可用')
            const temp = `${cache}.${crypto.randomUUID()}.tmp`
            await writeFile(temp, raw, { mode: 0o600 }); await rename(temp, cache)
            return raw
          })().finally(() => downloads.delete(cache))
          downloads.set(cache, pending)
        }
        bytes = await pending
      }
      name = variant === 'diff' ? job.resultName!.replace(/\.(docx|doc)$/i, '_彩色对比.docx') : job.resultName!.replace(/\.[^.]+$/, '.pdf')
    } else bytes = await readFile(job.resultPath!)
  } catch (e) { if (e instanceof ProviderError) return json({ error: e.message }, { status: 503 }); throw e }
  const html = /\.html$/i.test(name)
  return new Response(new Uint8Array(bytes), { headers: {
    'content-type': /\.txt$/i.test(name) ? 'text/plain; charset=utf-8' : html ? 'text/html; charset=utf-8' : /\.json$/i.test(name) ? 'application/json' : /\.pdf$/i.test(name) ? 'application/pdf' : /\.docx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword',
    'content-disposition': `${query.get('inline') === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'content-length': String(bytes.length), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    ...(html ? { 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; script-src 'none'; frame-ancestors 'self'", 'referrer-policy': 'no-referrer' } : {}),
  } })
})
