import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { encrypt, getSignature } from '@wecom/crypto'
import { readConfig, CALLBACK_PATH, HEALTH_PATH } from './callback.mjs'

// Signed synthetic requests only; never print URLs containing signatures or any secret.
const config = readConfig()
const base = process.argv[2] || 'http://127.0.0.1:3106'
const query = encrypted => {
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(8).toString('hex')
  return new URLSearchParams({ timestamp, nonce, msg_signature: getSignature(config.token, timestamp, nonce, encrypted) })
}
const health = await fetch(new URL(HEALTH_PATH, base)); assert.equal(health.status, 200)
const echo = `bxsh-selftest:${randomBytes(8).toString('hex')}`
const encrypted = encrypt(config.aesKey, echo, config.corpId)
const getQuery = query(encrypted); getQuery.set('echostr', encrypted)
let response = await fetch(`${base}${CALLBACK_PATH}?${getQuery}`)
assert.equal(response.status, 200); assert.equal(await response.text(), echo)
const xml = `<xml><ToUserName><![CDATA[${config.corpId}]]></ToUserName><FromUserName><![CDATA[integration_self_test]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[integration_smoke_test]]></Event></xml>`
const cipher = encrypt(config.aesKey, xml, config.corpId)
const postQuery = query(cipher)
const request = { method: 'POST', headers: { 'content-type': 'application/xml' }, body: `<xml><ToUserName><![CDATA[${config.corpId}]]></ToUserName><Encrypt><![CDATA[${cipher}]]></Encrypt></xml>` }
for (let i = 0; i < 2; i++) {
  response = await fetch(`${base}${CALLBACK_PATH}?${postQuery}`, request)
  assert.equal(response.status, 200); assert.equal(await response.text(), 'success')
}
postQuery.set('msg_signature', '0'.repeat(40))
response = await fetch(`${base}${CALLBACK_PATH}?${postQuery}`, request); assert.equal(response.status, 403)
console.log(JSON.stringify({ ok: true, checks: ['health', 'encrypted_url_verification', 'encrypted_event', 'retry_delivery', 'bad_signature_rejected'], source: 'self_test' }))
