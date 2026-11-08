import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { ANDROID_RELEASE } from '@/shared/company-resources'
import { env } from './env'

let cached: { key: string; sha256: Promise<string> } | undefined

/** 只发布固定安装包的公开元信息；文件缺失时不提示员工升级。 */
export async function androidReleaseManifest() {
  const filename = path.join(env.storageDir, 'releases', ANDROID_RELEASE.filename)
  const info = await stat(filename)
  if (!info.isFile() || !info.size) throw new Error('Android release unavailable')
  const key = `${filename}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
  if (cached?.key !== key) {
    const sha256 = (async () => {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(filename)) hash.update(chunk)
      return hash.digest('hex')
    })()
    cached = { key, sha256 }
    void sha256.catch(() => { if (cached?.key === key) cached = undefined })
  }
  return {
    version: ANDROID_RELEASE.version, versionCode: ANDROID_RELEASE.versionCode,
    downloadUrl: new URL(ANDROID_RELEASE.download, 'https://workbench.example.com').href,
    filename: ANDROID_RELEASE.filename, size: info.size,
    sha256: await cached.sha256, notes: ANDROID_RELEASE.notes,
  }
}
