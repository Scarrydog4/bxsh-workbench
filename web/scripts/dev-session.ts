/**
 * 仅本机审查用：给某个账号直接开一个会话，令牌写进文件，不打印。
 * 用法：DATABASE_URL=... tsx scripts/dev-session.ts <用户id> <输出文件>
 */
import { createHash, randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import postgres from 'postgres'

const [userId, out] = process.argv.slice(2)
if (!process.env.DATABASE_URL?.includes('review')) throw new Error('只允许在审查库上用')
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const token = randomBytes(32).toString('base64url')
await sql`insert into sessions (id, user_id, expires_at) values (${createHash('sha256').update(token).digest('hex')}, ${userId}, now() + interval '1 day')`
await writeFile(out, token)
await sql.end()
