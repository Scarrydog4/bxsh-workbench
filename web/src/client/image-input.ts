export const IMAGE_INPUT_EMPTY_MESSAGE = '未读到可上传的图片，请打开图片后复制，或保存后上传'

const imageExtensions: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
  svg: 'image/svg+xml', ico: 'image/x-icon',
}
const imageType = (type: string) => type.toLowerCase().startsWith('image/')

function imageFile(file: File | null, hint = ''): File | null {
  if (!file || file.size === 0) return null
  const type = file.type || (imageType(hint) ? hint : imageExtensions[file.name.split('.').at(-1)?.toLowerCase() ?? ''])
  if (!type || !imageType(type)) return null
  // 微信/Finder 有时提供空 MIME；补齐后，现有图片压缩和上传入口也能识别。
  return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified })
}
// Android WebView 会为 items / files 分别创建 File，修改时间可能相差几毫秒。
// 这里只匹配两组中的副本，组内数量仍保留，不能把一张截图算成两张。
const fileKey = (file: File) => JSON.stringify([file.name, file.size, file.type.toLowerCase()])

/** 同步读取事件里的真实文件；拖拽事件结束后 items 可能已不可读。 */
export function imageFilesFromTransfer(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const images: File[] = [], itemCopies = new Map<string, number>()
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue
    let file: File | null = null
    try { file = imageFile(item.getAsFile(), item.type) } catch { /* 再尝试 files 中的同一文件。 */ }
    if (!file) continue
    images.push(file)
    const key = fileKey(file)
    itemCopies.set(key, (itemCopies.get(key) ?? 0) + 1)
  }
  for (const source of Array.from(data.files ?? [])) {
    const file = imageFile(source)
    if (!file) continue
    const key = fileKey(file), copies = itemCopies.get(key) ?? 0
    if (copies > 0) itemCopies.set(key, copies - 1)
    else images.push(file)
  }
  // 不把文本路径、HTML 图片地址或微信私有数据当成已经取得的图片。
  return images
}

/** Android's picker File can stop being readable once its input is cleared. */
export function preservePickedImages(files: File[]): File[] | Promise<File[]> {
  if (typeof navigator === 'undefined' || !/\bBxshAndroid\//.test(navigator.userAgent ?? '')) return files
  return (async () => {
    const ready: File[] = []
    for (const file of files) {
      // Keep normal documents on the existing chunked-upload path.
      ready.push(imageType(file.type)
        ? new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified })
        : file)
    }
    return ready
  })()
}

function clipboardReadError(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
  return new Error(name === 'NotAllowedError' || name === 'SecurityError'
    ? '未获准读取剪贴板，请在输入框按 ⌘V / Ctrl+V'
    : '剪贴板图片读取失败，请重新复制或选择图片文件')
}

/** 在用户点击时直接调用；getType 的 Blob Promise 必须完成后才能构造 File。 */
export async function readClipboardImages(): Promise<File[]> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.read) throw new Error('当前页面无法直接读取剪贴板，请在输入框按 ⌘V / Ctrl+V')
  let items: ClipboardItems
  try { items = await navigator.clipboard.read() } catch (error) { throw clipboardReadError(error) }
  const files: File[] = []
  for (const item of items) {
    // 同一 ClipboardItem 的不同 MIME 是同一张图的表示，不重复上传。
    const types = item.types.filter(imageType).sort((a, b) => Number(b === 'image/png') - Number(a === 'image/png'))
    if (!types.length) continue
    let result: File | null = null, lastError: unknown
    for (const type of types) {
      try {
        const blob = await item.getType(type)
        if (!blob.size || (blob.type && !imageType(blob.type))) continue
        const mime = blob.type || type
        const extension = Object.keys(imageExtensions).find(key => imageExtensions[key] === mime) ?? 'png'
        result = new File([blob], `粘贴的图片-${files.length + 1}.${extension}`, { type: mime })
        break
      } catch (error) { lastError = error }
    }
    // 一次多图中任意图片读取失败也不假装整批已经读完。
    if (!result) throw clipboardReadError(lastError)
    files.push(result)
  }
  if (!files.length) throw new Error(IMAGE_INPUT_EMPTY_MESSAGE)
  return files
}
