import { randomBytes } from 'node:crypto'

export function uid(prefix: string) {
  return `${prefix}_${randomBytes(9).toString('base64url')}`
}
