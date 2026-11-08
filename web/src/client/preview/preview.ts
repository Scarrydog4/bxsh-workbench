'use client'

import { useSyncExternalStore } from 'react'
import { extOf } from '../forum/format'

/** 要预览的文件：url 是可以在浏览器里读的地址（论坛 previewUrl，订单 ?inline=1），downloadUrl 是下载地址。 */
export interface PreviewFile { name: string; size?: number; mime?: string; url: string; downloadUrl: string }
export type PreviewKind = 'pdf' | 'docx' | 'doc' | 'markdown' | 'text' | 'video' | 'video-unsupported' | 'image' | 'none'

const VIDEO = ['mp4', 'webm', 'mov', 'm4v']
const VIDEO_OTHER = ['avi', 'wmv', 'mkv', 'flv', '3gp', 'rmvb', 'mpg', 'mpeg']
const IMAGE = ['png', 'jpg', 'jpeg', 'webp', 'gif']

export function previewKind(name: string, mime = ''): PreviewKind {
  const ext = extOf(name)
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'txt') return 'text'
  if (VIDEO.includes(ext)) return 'video'
  if (VIDEO_OTHER.includes(ext) || mime.startsWith('video/')) return 'video-unsupported'
  if (IMAGE.includes(ext) || /^image\/(png|jpe?g|webp|gif)$/.test(mime)) return 'image'
  return 'none'
}
/** 列表里要不要显示「预览」按钮：不能预览的类型只给下载。 */
export const canPreview = (name: string, mime?: string) => previewKind(name, mime) !== 'none'

let current: PreviewFile | null = null
const listeners = new Set<() => void>()
export function openPreview(file: PreviewFile) { current = file; listeners.forEach(l => l()) }
export function closePreview() { current = null; listeners.forEach(l => l()) }
export function usePreviewFile() {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => current, () => null)
}
