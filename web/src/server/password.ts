import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>
const PARAMS = { N: 16384, r: 8, p: 1 }

/** 格式：scrypt$N$r$p$salt$hash（都是 base64） */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16)
  const hash = await scrypt(pw, salt, 32, PARAMS)
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, N, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt') return false
  const want = Buffer.from(hash, 'base64')
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) })
  return got.length === want.length && timingSafeEqual(got, want)
}

/** 新账号的临时密码：12 位，去掉容易看错的字符 */
export function tempPassword() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const b = randomBytes(12)
  return Array.from(b, (x) => abc[x % abc.length]).join('')
}

export function passwordProblem(pw: string) {
  if (pw.length < 8) return '密码至少 8 位'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '密码要同时有字母和数字'
  return null
}
