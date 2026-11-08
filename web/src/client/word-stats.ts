import JSZip from 'jszip'
import type { WordStats } from '@/shared/toolbox'

export async function wordStats(file: File): Promise<WordStats> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('无法读取文档统计')
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('无法读取文档统计')
  const paragraphs = Array.from(document.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p')).map((p) =>
    Array.from(p.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't')).map((t) => t.textContent ?? '').join('')).filter((p) => p.trim())
  const text = paragraphs.join('\n')
  const chinese = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) ?? []).length
  const english = (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length
  return { chinese, english, paragraphs: paragraphs.length, total: chinese + english }
}
