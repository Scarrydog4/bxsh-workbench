const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Browser writes must come from this site. Native clients can use JSON or Bearer auth. */
export function trustedWriteRequest(req: Request) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true
  const site = req.headers.get('sec-fetch-site')
  if (site === 'cross-site') return false

  const source = req.headers.get('origin') ?? req.headers.get('referer')
  if (source !== null) {
    try {
      const origin = new URL(source)
      const host = req.headers.get('host') ?? new URL(req.url).host
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== host) return false
      // Caddy preserves Host and supplies the external protocol; Next's internal URL can be HTTP.
      const forwardedProtocol = req.headers.get('x-forwarded-proto')
      if (forwardedProtocol && origin.protocol !== `${forwardedProtocol}:`) return false
      if (process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIE !== '1' && origin.protocol !== 'https:') return false
      return true
    } catch { return false }
  }

  if (site === 'same-site') return false // A sibling host is not this app.
  if (site === 'same-origin') return true
  if (/^Bearer \S+$/.test(req.headers.get('authorization') ?? '')) return true
  // Forms can submit these types without a CORS preflight. Do not accept them without source evidence.
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  return !['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'].includes(type)
}

/** The password-free preview must be explicitly enabled and addressed through loopback only. */
export function localDevLoginEnabled(req: Request) {
  if (process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_DEV_LOGIN !== '1') return false
  const local = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  try {
    const url = new URL(req.url)
    const host = new URL(`${url.protocol}//${req.headers.get('host') ?? url.host}`)
    if (!local(url.hostname) || !local(host.hostname)) return false
    const source = req.headers.get('origin') ?? req.headers.get('referer')
    if (source && new URL(source).host !== host.host) return false
    if (['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site') ?? '')) return false
    const forwarded = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip')
    return !forwarded || forwarded.split(',').every(ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip.trim()))
  } catch { return false }
}
