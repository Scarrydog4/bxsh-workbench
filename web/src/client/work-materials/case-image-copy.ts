const CACHE_LIMIT = 8
const cache = new Map<string, Promise<Blob>>()

async function readPng(src: string): Promise<Blob> {
  const response = await fetch(src, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('image unavailable')
  const blob = await response.blob()
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(png => png ? resolve(png) : reject(new Error('png failed')), 'image/png'))
  } finally { bitmap.close() }
}

/** 读取原图并转成 PNG；成功结果短暂缓存，失败后允许重试。 */
export function caseImagePng(src: string): Promise<Blob> {
  const cached = cache.get(src)
  if (cached) return cached
  const pending = readPng(src).catch(error => { cache.delete(src); throw error })
  cache.set(src, pending)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return pending
}

/** 必须在点击的同步阶段调用：ClipboardItem 接收 Promise，保留 Safari 所需的用户手势。 */
export function copyCaseImage(src: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return Promise.reject(new Error('unsupported'))
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': caseImagePng(src) })])
}
