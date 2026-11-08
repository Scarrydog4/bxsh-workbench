import { readFile } from 'node:fs/promises'
import { route, json, bad } from '@/server/http'
import { jobVisible } from '@/server/toolbox'

export const GET = route<{ id: string }>(async (_req, c, p) => {
  const job = await jobVisible(c, p.id)
  if (job.status !== 'completed' || !job.resultPath) throw bad('结果尚未完成')
  if (job.rewriteOptions?.service === 'AI预测') return json({ prediction: job.providerState.detection, html: job.providerState.resultFormat === 'html',
    ...(job.rewriteOptions.inputKind === 'text' ? { originalText: await readFile(job.sourcePath, 'utf8') } : {}) })
  if (job.rewriteOptions?.inputKind !== 'text') return json({ sourceSize: job.size, resultSize: job.resultSize, hasDiff: !!job.providerState.diffUrl })
  const [originalText, resultText] = await Promise.all([readFile(job.sourcePath, 'utf8'), readFile(job.resultPath, 'utf8')])
  return json({ originalText, resultText })
})
