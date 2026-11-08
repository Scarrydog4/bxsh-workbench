import type { Attachment } from '@/shared/types'

export type NewFile = Omit<Attachment, 'id' | 'at' | 'by'>

/** 读拖进来或粘贴进来的文件：图片做一张小缩略图，其他只留文件名和大小。 */
export async function readFiles(list: FileList | File[]): Promise<NewFile[]> {
  return Promise.all(
    Array.from(list).map(async (f) => {
      const out: NewFile = { name: f.name || '粘贴的图片.png', size: f.size }
      if (f.type.startsWith('image/')) out.preview = await thumb(f, 480)
      return out
    }),
  )
}

export function thumb(file: File, max: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => resolve(undefined)
    img.src = URL.createObjectURL(file)
  })
}

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function hasFiles(e: { dataTransfer: DataTransfer | null }) {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

/** 从一段到账消息里认金额、日期、标签，比如「微信转账 ¥600.00 10月6日 尾款」。 */
export function parsePaymentText(text: string, tags: string[]) {
  const amt = text.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/) ?? text.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块)/) ?? text.match(/(?:收款|转账|到账|收到)\D{0,6}(\d+(?:\.\d{1,2})?)/)
  const d = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  const tag = tags.find((t) => text.includes(t))
  let date: string | undefined
  if (d) {
    const y = new Date().getFullYear()
    date = `${y}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}`
  }
  return { amount: amt ? amt[1] : undefined, date, tag }
}
