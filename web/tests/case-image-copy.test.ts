import { afterEach, beforeEach, expect, it, vi } from 'vitest'

class FakeItem { constructor(public items: Record<string, Promise<Blob>>) {} }

beforeEach(() => { vi.resetModules(); vi.stubGlobal('ClipboardItem', FakeItem) })
afterEach(() => { vi.unstubAllGlobals() })

it('reads the requested original and writes it as PNG during the click', async () => {
  const png = new Blob(['x'], { type: 'image/png' })
  const fetchMock = vi.fn(async () => new Response(png))
  const write = vi.fn(async () => undefined)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { clipboard: { write } })
  const { copyCaseImage } = await import('../src/client/work-materials/case-image-copy')
  const done = copyCaseImage('/api/materials/a/image?v=2')
  expect(write).toHaveBeenCalledTimes(1)
  await done
  const item = (write.mock.calls as unknown as FakeItem[][][])[0][0][0]
  expect((await item.items['image/png']).type).toBe('image/png')
  expect(fetchMock).toHaveBeenCalledWith('/api/materials/a/image?v=2', { credentials: 'same-origin' })
})

it('rejects when the browser has no image clipboard', async () => {
  vi.stubGlobal('navigator', { clipboard: {} })
  const { copyCaseImage } = await import('../src/client/work-materials/case-image-copy')
  await expect(copyCaseImage('/x')).rejects.toThrow('unsupported')
})

it('allows a retry after the image fails to load', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 500 }))
    .mockResolvedValueOnce(new Response(new Blob(['x'], { type: 'image/png' })))
  vi.stubGlobal('fetch', fetchMock)
  const { caseImagePng } = await import('../src/client/work-materials/case-image-copy')
  await expect(caseImagePng('/y')).rejects.toThrow()
  await expect(caseImagePng('/y')).resolves.toBeInstanceOf(Blob)
})
