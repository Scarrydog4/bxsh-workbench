import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { notFound } from './http'

type Download = { path: string; name: string; mime: string; id: string; inline?: boolean; notFoundMessage?: string; cacheControl?:string; publicContent?: boolean }

/** Uploaded HTML/SVG are never executed, even when their declared MIME is misleading. */
export function downloadType(name: string, mime: string) {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'md' || ext === 'txt') return { mime: 'text/plain; charset=utf-8', inline: true }
  if (['html', 'htm', 'xhtml', 'svg', 'svgz'].includes(ext ?? '')) return { mime: 'application/octet-stream', inline: false }
  const clean = mime.split(';')[0].trim().toLowerCase()
  const safe = /^(image\/(png|jpe?g|webp|gif|avif|bmp)|application\/pdf|video\/(mp4|webm|quicktime))$/.test(clean)
  const inlineExtension = ['png','jpg','jpeg','webp','gif','avif','bmp','pdf','mp4','webm','mov'].includes(ext ?? '')
  if (safe && inlineExtension) return { mime: clean, inline: true }
  return { mime: clean === 'text/html' || clean === 'application/xhtml+xml' || clean === 'image/svg+xml' || !/^[\w.+-]+\/[\w.+-]+$/.test(clean) ? 'application/octet-stream' : clean, inline: false }
}

/** One byte range, including suffix/open ended ranges. Unsupported/malformed ranges are 416. */
export function byteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size === 0) return null
  const first = match[1] ? Number(match[1]) : null
  const last = match[2] ? Number(match[2]) : null
  if (first !== null && !Number.isSafeInteger(first) || last !== null && !Number.isSafeInteger(last)) return null
  if (first === null) return last && last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null
  if (first >= size || last !== null && last < first) return null
  return { start: first, end: Math.min(last ?? size - 1, size - 1) }
}

/** Call only after access checks. Streaming avoids buffering large PDF/video files in memory. */
export async function fileResponse(req: Request, file: Download) {
  const info = await stat(file.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw notFound(file.notFoundMessage)
    throw error
  })
  if (!info.isFile()) throw notFound(file.notFoundMessage)
  const type = downloadType(file.name, file.mime)
  const etag = `W/"${file.id}-${info.size}-${info.mtimeMs}"`
  const headers = new Headers({
    'accept-ranges': 'bytes', 'content-type': type.mime,
    'content-disposition': `${file.inline && type.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    'x-content-type-options': 'nosniff', 'cache-control': file.cacheControl ?? 'private, no-cache',
    etag, 'last-modified': info.mtime.toUTCString(),
  })
  // Content-addressed public avatars have identical bytes for every session. Private files keep their auth variants.
  if (!file.publicContent) headers.set('vary', 'Cookie, Authorization')
  if (req.headers.get('if-none-match')?.split(/,\s*/).some(value => value === etag || value === '*')) return new Response(null, { status: 304, headers })
  const requested = req.headers.get('range')
  const ifRange = req.headers.get('if-range')
  // A weak ETag is not a valid If-Range validator (RFC 9110); fall back to the full representation.
  const useRange = requested && (!ifRange || !ifRange.startsWith('W/') && ifRange === etag || ifRange === info.mtime.toUTCString())
  const range = useRange ? byteRange(requested, info.size) : undefined
  if (range === null) {
    headers.set('content-range', `bytes */${info.size}`)
    headers.set('content-length', '0')
    return new Response(null, { status: 416, headers })
  }
  headers.set('content-length', String(range ? range.end - range.start + 1 : info.size))
  if (range) headers.set('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
  const body = req.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file.path, range ?? {})) as ReadableStream
  return new Response(body, { status: range ? 206 : 200, headers })
}
