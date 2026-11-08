import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { env } from './env'

export const CHUNK = 8 * 1024 * 1024

/** 文件放 storage/年/月/<id>，原名只存在库里，磁盘上不出现中文和用户给的路径 */
export async function newFilePath(id: string) {
  const d = new Date()
  const dir = path.join(env.storageDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'))
  await mkdir(dir, { recursive: true })
  return path.join(dir, id)
}

export function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 200) || 'file'
}
