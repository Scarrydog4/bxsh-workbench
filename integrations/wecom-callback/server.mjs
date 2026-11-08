import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { CALLBACK_PATH, HEALTH_PATH, MAX_BODY_BYTES, HttpError, readConfig, verifyAndDecrypt, decodeEvent } from './callback.mjs'
import { openStore } from './store.mjs'

async function readBody(req) {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new HttpError(413, 'body too large')
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createCallbackServer({ config, store, log = entry => console.log(JSON.stringify(entry)) }) {
  const server = http.createServer(async (req, res) => {
    const reply = (code, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body)
    }
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === HEALTH_PATH && req.method === 'GET') return reply(200, '{"ok":true,"service":"wecom-callback","stage":"callback_only"}', 'application/json; charset=utf-8')
      if (url.pathname !== CALLBACK_PATH) return reply(404, 'not found')
      if (req.method === 'GET') {
        const echo = verifyAndDecrypt(config, url.searchParams, url.searchParams.get('echostr'))
        const source = echo.startsWith('bxsh-selftest:') ? 'self_test' : 'wecom'
        store.verified(source)
        log({ event: 'callback_verified', source, at: new Date().toISOString() })
        return reply(200, echo)
      }
      if (req.method === 'POST') {
        const event = decodeEvent(config, url.searchParams, await readBody(req))
        store.save(event)
        log({ event: 'callback_received', id: event.id, source: event.source, type: event.eventType || event.messageType, at: event.receivedAt })
        return reply(200, 'success')
      }
      res.setHeader('allow', 'GET, POST'); return reply(405, 'method not allowed')
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, error.message)
      log({ event: 'callback_storage_error', at: new Date().toISOString() })
      return reply(503, 'temporarily unavailable')
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077)
  const config = readConfig()
  const store = openStore(process.env.WECOM_DB_PATH || './data/events.sqlite')
  const server = createCallbackServer({ config, store })
  server.listen(Number(process.env.PORT || 3106), process.env.HOST || '127.0.0.1', () => console.log(JSON.stringify({ event: 'ready', port: Number(process.env.PORT || 3106) })))
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => { store.close(); process.exit(0) }); setTimeout(() => process.exit(1), 5000).unref() })
}
