export interface WordDownloadProgress { loaded: number; total: number }

/** 预览只读下载；持续收到数据就继续等待，断流后才重连。 */
export async function downloadWordPreview(url: string, signal: AbortSignal, progress: (value: WordDownloadProgress) => void) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const cancel = () => controller.abort(signal.reason)
    if (signal.aborted) cancel()
    signal.addEventListener('abort', cancel, { once: true })
    let idle: ReturnType<typeof setTimeout>
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(new DOMException('预览连接超时', 'TimeoutError')), 45_000) }
    arm()
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Word 预览读取失败')
      if (!response.body) throw new Error('文件内容暂不可读，请重试')
      const total = Number(response.headers.get('content-length') ?? 0)
      let loaded = 0
      const parts: Uint8Array<ArrayBuffer>[] = []
      const reader = response.body.getReader()
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          loaded += chunk.value.length; parts.push(new Uint8Array(chunk.value)); arm()
          progress({ loaded, total })
        }
      } finally { reader.releaseLock() }
      return new Blob(parts, { type: response.headers.get('content-type') ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    } catch (error) {
      const name = (error as Error).name
      if (signal.aborted || attempt === 1 || !(error instanceof TypeError || ['TimeoutError', 'AbortError', 'NetworkError'].includes(name))) throw error
      progress({ loaded: 0, total: 0 })
    } finally { clearTimeout(idle!); signal.removeEventListener('abort', cancel) }
  }
  throw new Error('预览连接中断，请重试')
}
