import { afterEach, expect, it, vi } from 'vitest'
import { IMAGE_INPUT_EMPTY_MESSAGE, imageFilesFromTransfer, preservePickedImages, readClipboardImages } from '@/client/image-input'

const transfer = (files: File[], items: Partial<DataTransferItem>[] = []) => ({ files, items }) as unknown as Pick<DataTransfer, 'files' | 'items'>
const item = (file: File | null, type = file?.type ?? ''): Partial<DataTransferItem> => ({ kind: 'file', type, getAsFile: () => file })
const image = (name = 'image.png', type = 'image/png', content = 'pixels') => new File([content], name, { type, lastModified: 17 })
const clipboard = (items: Pick<ClipboardItem, 'types' | 'getType'>[]) => {
  const read = vi.fn().mockResolvedValue(items)
  vi.stubGlobal('navigator', { clipboard: { read } })
  return read
}
afterEach(() => vi.unstubAllGlobals())

it('安卓选择器图片复制真实字节，保留文件名类型时间；普通文档继续原分片上传', async () => {
  vi.stubGlobal('navigator', { userAgent: 'Android WebView BxshAndroid/0.1.6' })
  const photo = image(), doc = new File(['pdf'], 'file.pdf', { type: 'application/pdf' })
  const readDoc = vi.spyOn(doc, 'arrayBuffer')
  const ready = await preservePickedImages([photo, doc])
  expect(ready[0]).not.toBe(photo)
  expect(ready[0]).toMatchObject({ name: photo.name, type: photo.type, lastModified: photo.lastModified })
  expect(await ready[0].text()).toBe('pixels')
  expect(ready[1]).toBe(doc)
  expect(readDoc).not.toHaveBeenCalled()
})

it('Safari选择图片不预读或复制文件，保持原调用时机和内存开销', () => {
  vi.stubGlobal('navigator', { userAgent: 'Version/18.0 Safari/605.1.15' })
  const photo = image(), read = vi.spyOn(photo, 'arrayBuffer'), files = [photo]
  expect(preservePickedImages(files)).toBe(files)
  expect(read).not.toHaveBeenCalled()
})

it('粘贴仅在 items 提供文件时也能读取，并同步调用 getAsFile', () => {
  const file = image(), getAsFile = vi.fn(() => file)
  const result = imageFilesFromTransfer(transfer([], [{ kind: 'file', type: 'image/png', getAsFile }]))
  expect(result).toEqual([file]); expect(getAsFile).toHaveBeenCalledOnce()
})

it('items 与 files 交叉去重，不误吞两张元数据相同的截图', () => {
  const first = image('image.png', 'image/png', 'first'), second = image('image.png', 'image/png', 'other')
  const result = imageFilesFromTransfer(transfer([image('image.png', 'image/png', 'first'), image('image.png', 'image/png', 'other')], [item(first), item(second)]))
  expect(result).toEqual([first, second])
  expect(imageFilesFromTransfer(transfer([first, second], [item(first)]))).toEqual([first, second])
})

it('安卓剪贴板两份 File 的时间不同仍只接收一张，保留真实多图数量', () => {
  const first = new File(['pixels'], 'image.png', { type: 'image/png', lastModified: 100 })
  const copy = new File(['pixels'], 'image.png', { type: 'image/png', lastModified: 104 })
  expect(imageFilesFromTransfer(transfer([copy], [item(first)]))).toEqual([first])
  expect(imageFilesFromTransfer(transfer([copy, copy], [item(first), item(first)]))).toEqual([first, first])
})

it('空 MIME 根据图片扩展名或 item 类型补齐，保留数据和最后修改时间', async () => {
  const blank = image('微信图片.JPG', '', 'original')
  const fromName = imageFilesFromTransfer(transfer([blank], [item(blank)]))
  expect(fromName).toHaveLength(1)
  expect(fromName[0]).toMatchObject({ name: '微信图片.JPG', type: 'image/jpeg', lastModified: 17 })
  expect(await fromName[0].text()).toBe('original')
  const noExtension = image('clipboard', '')
  expect(imageFilesFromTransfer(transfer([], [item(noExtension, 'image/png')]))[0].type).toBe('image/png')
})

it('忽略空文件、非图片和只提供路径/私有格式的条目；items 不可读时仍使用 files', () => {
  const getAsFile = vi.fn(() => null), file = image()
  expect(imageFilesFromTransfer(transfer([image('pretend.png', 'text/plain'), new File([], 'empty.png', { type: 'image/png' })], [
    { kind: 'string', type: 'text/uri-list', getAsFile }, { kind: 'string', type: 'application/x-wechat', getAsFile },
  ]))).toEqual([])
  expect(getAsFile).not.toHaveBeenCalled()
  expect(imageFilesFromTransfer(transfer([file], [{ kind: 'file', type: 'image/png', getAsFile: () => { throw new Error('unavailable') } }]))).toEqual([file])
})

it('异步剪贴板等待 Blob Promise，返回实际图片字节而不是 Promise 文本', async () => {
  let resolve!: (blob: Blob) => void
  const deferred = new Promise<Blob>(done => { resolve = done })
  const read = clipboard([{ types: ['image/png'], getType: vi.fn(() => deferred) }])
  const reading = readClipboardImages()
  expect(read).toHaveBeenCalledOnce()
  resolve(new Blob(['actual PNG bytes'], { type: 'image/png' }))
  const result = await reading
  expect(result).toHaveLength(1); expect(result[0].type).toBe('image/png')
  expect(await result[0].text()).toBe('actual PNG bytes')
})

it('同张图的多种 MIME 只读取一份，多个剪贴板图片分别保留', async () => {
  const first = vi.fn(async (type: string) => new Blob(['one'], { type })), second = vi.fn(async () => new Blob(['two']))
  clipboard([{ types: ['text/html', 'image/jpeg', 'image/png'], getType: first }, { types: ['image/webp'], getType: second }])
  const result = await readClipboardImages()
  expect(first).toHaveBeenCalledExactlyOnceWith('image/png')
  expect(result.map(file => file.type)).toEqual(['image/png', 'image/webp'])
  expect(result.map(file => file.name)).toEqual(['粘贴的图片-1.png', '粘贴的图片-2.webp'])
})

it('一个 MIME 读取失败可使用同图另一真实格式；整张失败不返回部分成功', async () => {
  const getType = vi.fn(async (type: string) => { if (type === 'image/png') throw new Error('no png'); return new Blob(['jpeg'], { type }) })
  clipboard([{ types: ['image/png', 'image/jpeg'], getType }])
  expect((await readClipboardImages())[0].type).toBe('image/jpeg')
  clipboard([{ types: ['image/png'], getType: async () => new Blob(['ok'], { type: 'image/png' }) }, { types: ['image/png'], getType: async () => new Blob([]) }])
  await expect(readClipboardImages()).rejects.toThrow('剪贴板图片读取失败')
})

it('文本、HTML图片地址、微信私有格式都不能冒充图片，不读取正文或远程URL', async () => {
  const getType = vi.fn(), fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  clipboard([{ types: ['text/plain', 'text/html', 'text/uri-list', 'application/x-wechat'], getType }])
  await expect(readClipboardImages()).rejects.toThrow(IMAGE_INPUT_EMPTY_MESSAGE)
  expect(getType).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})

it('没有 Clipboard API 或拒绝权限时给出可执行的粘贴提示', async () => {
  vi.stubGlobal('navigator', {})
  await expect(readClipboardImages()).rejects.toThrow('当前页面无法直接读取剪贴板')
  vi.stubGlobal('navigator', { clipboard: { read: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) } })
  await expect(readClipboardImages()).rejects.toThrow('未获准读取剪贴板，请在输入框按 ⌘V / Ctrl+V')
})
