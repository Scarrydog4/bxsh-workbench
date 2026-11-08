import { MAX_REWRITE_INPUT } from '@/shared/toolbox'

export type RewriteFileSource = { file: File; reopen?: () => Promise<File> }

/** 拖拽事件结束后不能再取目录项，必须在 drop 回调内保留这次授权的文件入口。 */
export function captureRewriteDrop(transfer: DataTransfer): RewriteFileSource[] {
  const sources: RewriteFileSource[] = []
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file) continue
    const entry = item.webkitGetAsEntry?.()
    sources.push({ file, ...(entry?.isFile ? { reopen: () => new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)) } : {}) })
  }
  return sources.length ? sources : Array.from(transfer.files, (file) => ({ file }))
}

/** 微信拖入的临时文件可能仍在更新；旧快照失效时重新打开，再保留独立上传副本。 */
export async function snapshotRewriteFile(file: File, reopen?: () => Promise<File>): Promise<File> {
  for (const delay of [0, 200, 800, 2000]) {
    if (delay) {
      if (!reopen) break
      await new Promise((resolve) => setTimeout(resolve, delay))
      try { file = await reopen() } catch { continue }
    }
    if (file.size > MAX_REWRITE_INPUT) throw new Error('文件超过 10MB，请选择较小的 DOCX 文件')
    try {
      const bytes = await file.arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength !== file.size) throw new Error('incomplete_file')
      return new File([bytes], file.name, { type: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', lastModified: file.lastModified })
    } catch { /* 稍后通过拖入时的目录项取得新的 File，不重复读取已失效的旧快照。 */ }
  }
  throw new Error('文件读取失败，请稍后重新拖入，或点击上传选择已保存的文件')
}
export function rewriteNetworkMessage(error: unknown, confirming: boolean) {
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return confirming
    ? '连接中断，原批次编号已保留，请点击“继续确认原批次”，不会重复扣费'
    : '文件未上传成功，请重新选择文件后再提交；已上传的稿件会保留在待确认记录中'
  return error instanceof Error ? error.message : '连接中断，请继续确认原批次'
}
