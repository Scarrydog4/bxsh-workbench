import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ANDROID_RELEASE } from '@/shared/company-resources'

const config = vi.hoisted(() => ({ storageDir: '' }))
vi.mock('@/server/env', () => ({ env: config }))
import { GET } from '@/app/api/download/android/version/route'

beforeAll(async () => {
  config.storageDir = await mkdtemp(path.join(tmpdir(), 'bxsh-android-release-'))
  await mkdir(path.join(config.storageDir, 'releases'))
})
afterAll(async () => { await rm(config.storageDir, { recursive: true, force: true }) })

it('安装包不存在时不给出可升级版本，也不泄露服务器路径', async () => {
  const response = await GET()
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: '暂时无法检查更新，请稍后重试' })
})

it('更新信息对应实际包，固定本站下载地址且不缓存旧版本', async () => {
  const bytes = Buffer.from('isolated apk checksum fixture')
  await writeFile(path.join(config.storageDir, 'releases', ANDROID_RELEASE.filename), bytes)
  const response = await GET(), manifest = await response.json()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(manifest).toMatchObject({ version: ANDROID_RELEASE.version, versionCode: ANDROID_RELEASE.versionCode, downloadUrl: 'https://workbench.example.com/api/download/android', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  expect(Object.keys(manifest).sort()).toEqual(['downloadUrl','filename','notes','sha256','size','version','versionCode'])
})

it('替换安装包后更新校验值，不能返回前一包的校验信息', async () => {
  const bytes = Buffer.from('replacement isolated apk checksum fixture')
  await writeFile(path.join(config.storageDir, 'releases', ANDROID_RELEASE.filename), bytes)
  const manifest = await (await GET()).json()
  expect(manifest.size).toBe(bytes.length)
  expect(manifest.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
})
