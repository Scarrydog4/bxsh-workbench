import { resolve4 } from 'node:dns/promises'
import { isIP } from 'node:net'
import { connect, type TLSSocket } from 'node:tls'
import { Agent } from 'undici'

const HOST = 'w.ycjg.top'
type Address = { address: string; ttl: number }
let preferred: (Address & { until: number }) | undefined
export function clearRewriteAddress() { preferred = undefined }

async function doh(origin: string): Promise<Address[]> {
  const response = await fetch(`${origin}?name=${HOST}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000), cache: 'no-store', redirect: 'error' })
  if (!response.ok) throw new Error('dns_response')
  const data = await response.json() as { Answer?: Array<{ type: number; data: string; TTL: number }> }
  return (data.Answer ?? []).filter((a) => a.type === 1 && isIP(a.data) === 4).map((a) => ({ address: a.data, ttl: a.TTL }))
}
function dial(address: string, sockets: Set<TLSSocket>): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port: 443, servername: HOST, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] })
    sockets.add(socket)
    const cleanup = () => { socket.removeListener('error', fail); socket.removeListener('timeout', timeout); socket.removeListener('close', closed); socket.setTimeout(0) }
    const fail = (error: Error) => { cleanup(); socket.destroy(); reject(error) }
    const timeout = () => fail(new Error('tls_connect_timeout'))
    const closed = () => fail(new Error('tls_connection_closed'))
    socket.once('error', fail)
    socket.once('close', closed)
    socket.setTimeout(2500, timeout)
    socket.once('secureConnect', () => { cleanup(); resolve(socket) })
  })
}

/** Race verified TLS connections before sending any HTTP headers or document bytes. */
export async function openRewriteSocket(): Promise<TLSSocket> {
  const sockets = new Set<TLSSocket>()
  if (preferred && preferred.until > Date.now()) {
    try { return await dial(preferred.address, sockets) } catch { clearRewriteAddress() }
  }
  let stopped = false
  try {
    const sources: Array<Promise<Address[]>> = [
      resolve4(HOST, { ttl: true }),
      doh('https://cloudflare-dns.com/dns-query'),
      doh('https://dns.google/resolve'),
    ]
    const winner = await Promise.any(sources.map(async (source) => {
      const addresses = await source
      if (stopped) throw new Error('connection_already_selected')
      return Promise.any(addresses.filter((a) => isIP(a.address) === 4).slice(0, 3).map(async (candidate) => ({ candidate, socket: await dial(candidate.address, sockets) })))
    }))
    stopped = true
    for (const socket of sockets) if (socket !== winner.socket) socket.destroy()
    preferred = { ...winner.candidate, until: Date.now() + Math.min(60, Math.max(1, winner.candidate.ttl || 1)) * 1000 }
    return winner.socket
  } catch (error) {
    stopped = true
    for (const socket of sockets) socket.destroy()
    throw error
  }
}

let dispatcher: Agent | undefined
export function rewriteDispatcher() {
  return dispatcher ??= new Agent({
    headersTimeout: 1_200_000,
    bodyTimeout: 1_200_000,
    connect(options, callback) {
      if (options.hostname !== HOST || options.protocol !== 'https:') {
        callback(Object.assign(new Error('unexpected_rewrite_origin'), { code: 'YCJG_CONNECT_UNSENT' }), null)
        return
      }
      openRewriteSocket().then((socket) => callback(null, socket), (cause) => {
        callback(Object.assign(new Error('rewrite_connection_not_opened', { cause }), { code: 'YCJG_CONNECT_UNSENT' }), null)
      })
    },
  })
}
export function rewriteRequestNotSent(error: unknown) {
  return (error as { cause?: { code?: string } })?.cause?.code === 'YCJG_CONNECT_UNSENT'
}
