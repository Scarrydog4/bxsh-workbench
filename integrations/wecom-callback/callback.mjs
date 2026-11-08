import { createHash, timingSafeEqual } from 'node:crypto'
import { decrypt, getSignature } from '@wecom/crypto'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

export const CALLBACK_PATH = '/api/wecom/callback'
export const HEALTH_PATH = '/api/wecom/health'
export const MAX_BODY_BYTES = 1024 * 1024
const parser = new XMLParser({ parseTagValue: false, trimValues: false, processEntities: false })

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export function readConfig(env = process.env) {
  const config = { corpId: env.WECOM_CORP_ID, token: env.WECOM_CALLBACK_TOKEN, aesKey: env.WECOM_ENCODING_AES_KEY }
  if (!/^ww[a-zA-Z0-9]+$/.test(config.corpId ?? '')) throw new Error('WECOM_CORP_ID is missing or invalid')
  if (!/^[a-zA-Z0-9]{3,32}$/.test(config.token ?? '')) throw new Error('WECOM_CALLBACK_TOKEN must contain 3–32 letters or digits')
  if (!/^[a-zA-Z0-9+/]{43}$/.test(config.aesKey ?? '') || Buffer.from(config.aesKey + '=', 'base64').length !== 32) throw new Error('WECOM_ENCODING_AES_KEY is missing or invalid')
  return config
}

function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new HttpError(400, 'invalid XML')
  const result = parser.parse(text)
  if (!result.xml || typeof result.xml !== 'object' || Array.isArray(result.xml)) throw new HttpError(400, 'invalid XML root')
  return result.xml
}

function field(value, maxLength = 256) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

export function verifyAndDecrypt(config, query, encrypted, now = Date.now()) {
  const signature = query.get('msg_signature') ?? ''
  const timestamp = query.get('timestamp') ?? ''
  const nonce = query.get('nonce') ?? ''
  if (!/^[a-f0-9]{40}$/i.test(signature) || !/^\d{10,13}$/.test(timestamp) || !nonce || nonce.length > 256 || typeof encrypted !== 'string' || !encrypted.length || encrypted.length > MAX_BODY_BYTES || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encrypted)) throw new HttpError(400, 'invalid callback parameters')
  const expected = getSignature(config.token, timestamp, nonce, encrypted)
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) throw new HttpError(403, 'invalid signature')
  // A valid old request must not create new events. Tencent retries are within this window.
  if (Math.abs(now / 1000 - Number(timestamp)) > 600) throw new HttpError(403, 'expired callback')
  try {
    const { message, id } = decrypt(config.aesKey, encrypted)
    if (id !== config.corpId || typeof message !== 'string') throw new Error('receiver mismatch')
    return message
  } catch { throw new HttpError(403, 'invalid encrypted callback') }
}

export function decodeEvent(config, query, body, now) {
  const envelope = parseXml(body)
  if (typeof envelope.Encrypt !== 'string') throw new HttpError(400, 'missing Encrypt')
  const xml = verifyAndDecrypt(config, query, envelope.Encrypt, now)
  const message = parseXml(xml)
  if (message.ToUserName !== config.corpId || !field(message.MsgType)) throw new HttpError(403, 'invalid receiver or message type')
  const eventType = field(message.Event)
  return {
    id: createHash('sha256').update(config.corpId).update('\0').update(xml).digest('hex'),
    receivedAt: new Date(now ?? Date.now()).toISOString(),
    messageType: field(message.MsgType), eventType,
    createTime: field(message.CreateTime), roomId: field(message.ChatId || message.RoomId),
    needsArchivePull: message.MsgType === 'event' && eventType === 'msgaudit_notify',
    source: eventType === 'integration_smoke_test' ? 'self_test' : 'wecom',
    xml,
  }
}
