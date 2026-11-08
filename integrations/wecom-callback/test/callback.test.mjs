import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { readConfig, verifyAndDecrypt } from '../callback.mjs'
import { createCallbackServer } from '../server.mjs'
import { openStore, readStatus } from '../store.mjs'

const key = randomBytes(32)
const config = { corpId: 'wwCallbackTest123', token: 'TestTokenOnly123', aesKey: key.toString('base64').slice(0, -1) }
// Build Tencent's wire layout independently of the production @wecom/crypto library.
function encryptFixture(message, corpId = config.corpId) {
  const length = Buffer.alloc(4); length.writeUInt32BE(Buffer.byteLength(message))
  const raw = Buffer.concat([Buffer.alloc(16, 7), length, Buffer.from(message), Buffer.from(corpId)])
  const padding = 32 - raw.length % 32
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64')
}
function signed(cipher, timestamp = String(Math.floor(Date.now() / 1000))) {
  const nonce = 'testNonce001'
  return new URLSearchParams({ timestamp, nonce, msg_signature: createHash('sha1').update([config.token, timestamp, nonce, cipher].sort().join('')).digest('hex') })
}
function eventXml(event = 'msgaudit_notify') {
  return `<xml><ToUserName><![CDATA[${config.corpId}]]></ToUserName><FromUserName><![CDATA[sys]]></FromUserName><CreateTime>1793200000</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[${event}]]></Event><MsgId>9876543210987654321</MsgId></xml>`
}
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bxsh-wecom-test-'))
  const filename = join(dir, 'events.sqlite')
  const store = openStore(filename)
  const logs = []
  const server = createCallbackServer({ config, store, log: entry => logs.push(entry) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); rmSync(dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (xml = eventXml(), receiver = config.corpId) => {
    const encrypted = encryptFixture(xml, receiver)
    return { url: `${base}/api/wecom/callback?${signed(encrypted)}`, options: { method: 'POST', body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`, headers: { 'content-type': 'application/xml' } } }
  }
  return { base, store, filename, logs, post }
}

test('GET verifies independent AES-CBC fixture and returns exact UTF-8 echo', async t => {
  const { base, store } = await fixture(t)
  const plain = '回调验证-hello+123'
  const encrypted = encryptFixture(plain), query = signed(encrypted); query.set('echostr', encrypted)
  const response = await fetch(`${base}/api/wecom/callback?${query}`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), plain)
  assert.equal(readStatus(store.db).verifications[0].source, 'wecom')
})

test('rejects signature tampering, wrong corporation and expired signed payload', async t => {
  const { base, store, post } = await fixture(t)
  const request = post()
  const url = new URL(request.url); url.searchParams.set('msg_signature', '0'.repeat(40))
  assert.equal((await fetch(url, request.options)).status, 403)
  const wrong = post(eventXml(), 'wwOtherCorp')
  assert.equal((await fetch(wrong.url, wrong.options)).status, 403)
  const encrypted = encryptFixture('old request')
  const query = signed(encrypted, String(Math.floor(Date.now() / 1000) - 3600)); query.set('echostr', encrypted)
  assert.equal((await fetch(`${base}/api/wecom/callback?${query}`)).status, 403)
  assert.equal(readStatus(store.db).events.length, 0)
})

test('durably records archive notification once across retries and reopen; exposes no event read endpoint', async t => {
  const { base, store, filename, post, logs } = await fixture(t)
  const request = post()
  for (let i = 0; i < 2; i++) {
    const response = await fetch(request.url, request.options)
    assert.equal(response.status, 200); assert.equal(await response.text(), 'success')
  }
  const reopened = openStore(filename)
  const status = readStatus(reopened.db)
  assert.equal(status.events[0].unique_events, 1)
  assert.equal(status.events[0].deliveries, 2)
  assert.equal(status.events[0].pending_archive_notifications, 1)
  assert.match(reopened.db.prepare('SELECT raw_xml FROM events').get().raw_xml, /9876543210987654321/)
  reopened.close()
  assert.equal((await fetch(`${base}/api/wecom/events`)).status, 404)
  assert.equal((await fetch(`${base}/api/wecom/status`)).status, 404)
  assert.equal((await fetch(`${base}/api/wecom/health`)).status, 200)
  assert.ok(!JSON.stringify(logs).includes(config.token))
  assert.ok(!JSON.stringify(logs).includes('9876543210987654321'))
  assert.equal(readStatus(store.db).archiveReaderConnected, false)
})

test('rejects malformed XML, declarations, oversized requests and wrong inner receiver', async t => {
  const { base, store, post } = await fixture(t)
  for (const body of ['<xml>', '<!DOCTYPE xml><xml><Encrypt>x</Encrypt></xml>', '<xml><Encrypt>a</Encrypt><Encrypt>b</Encrypt></xml>']) {
    assert.equal((await fetch(`${base}/api/wecom/callback`, { method: 'POST', body })).status, 400)
  }
  assert.equal((await fetch(`${base}/api/wecom/callback`, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })).status, 413)
  const request = post(eventXml().replace(config.corpId, 'wwWrongInner'))
  assert.equal((await fetch(request.url, request.options)).status, 403)
  assert.equal(readStatus(store.db).events.length, 0)
})

test('storage failure returns retryable error instead of acknowledging lost events', async t => {
  const { store, post } = await fixture(t)
  store.save = () => { throw new Error('disk failure') }
  const request = post()
  const response = await fetch(request.url, request.options)
  assert.equal(response.status, 503)
  assert.equal(await response.text(), 'temporarily unavailable')
})

test('synthetic probes stay separate from actual WeCom events and config fails closed', async t => {
  const { base, store, post } = await fixture(t)
  const request = post('' + eventXml('integration_smoke_test'))
  assert.equal((await fetch(request.url, request.options)).status, 200)
  const cipher = encryptFixture('bxsh-selftest:probe'), query = signed(cipher); query.set('echostr', cipher)
  assert.equal((await fetch(`${base}/api/wecom/callback?${query}`)).status, 200)
  const status = readStatus(store.db)
  assert.equal(status.events[0].source, 'self_test')
  assert.equal(status.events[0].pending_archive_notifications, 0)
  assert.equal(status.verifications[0].source, 'self_test')
  assert.throws(() => readConfig({}), /WECOM_CORP_ID/)
  assert.throws(() => verifyAndDecrypt(config, new URLSearchParams(), ''), /invalid callback/)
})
