import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const h = vi.hoisted(() => ({ directory: '' }))
vi.mock('@/server/env', () => ({ env: { get storageDir() { return h.directory } } }))
vi.mock('@/server/http', () => ({ notFound: () => new Error('not found') }))
import { GET } from '@/app/api/img/[name]/route'
import { fileResponse } from '@/server/range-response'
const name = `${'a'.repeat(64)}.96.webp`, bytes = Buffer.from('RIFF0000WEBPthumbnail')
beforeAll(async () => { h.directory = await mkdtemp(path.join(os.tmpdir(), 'bxsh-avatar-cache-')); await mkdir(path.join(h.directory, 'avatars')); await writeFile(path.join(h.directory, 'avatars', name), bytes) })
afterAll(() => rm(h.directory, { recursive: true, force: true }))
const read = (headers: Record<string, string> = {}, method = 'GET') => GET(new Request(`https://test.local/api/img/${name}`, { headers, method }), { params: Promise.resolve({ name }) })

it('public content-hash avatars share a stable cached representation across login cookies', async () => {
  const first = await read({ cookie: 'bxsh_session=first' })
  expect(first.status).toBe(200)
  expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  expect(first.headers.get('vary')).toBeNull()
  expect(Buffer.from(await first.arrayBuffer())).toEqual(bytes)
  const etag = first.headers.get('etag')!
  const cached = await read({ cookie: 'bxsh_session=second', 'if-none-match': etag })
  expect(cached.status).toBe(304)
  expect(await cached.text()).toBe('')
  const head = await read({}, 'HEAD')
  expect(head.headers.get('content-length')).toBe(String(bytes.length))
  expect(await head.text()).toBe('')
})

it('private file responses keep auth-aware cache headers and range support', async () => {
  const response = await fileResponse(new Request('https://test.local/private', { headers: { range: 'bytes=0-3' } }), { path: path.join(h.directory, 'avatars', name), name, mime: 'image/webp', id: name, inline: true })
  expect(response.status).toBe(206)
  expect(response.headers.get('cache-control')).toBe('private, no-cache')
  expect(response.headers.get('vary')).toBe('Cookie, Authorization')
  expect(await response.text()).toBe('RIFF')
})
