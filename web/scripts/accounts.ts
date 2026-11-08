/**
 * 建四个初始账号（已存在就跳过）。临时密码写进 ../data/accounts-initial.txt（data/ 不进仓库），
 * 不打印到终端；每个人首次登录必须改密码。
 * 用法：pnpm db:accounts
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as t from '../src/server/schema'
import { hashPassword, tempPassword } from '../src/server/password'

const url = process.env.DATABASE_URL ?? 'postgres://bxsh@127.0.0.1:5433/workbench'
const sql = postgres(url, { max: 1 })
const db = drizzle(sql, { schema: t })

export const PEOPLE = [
  { id: 'u-boss', name: '老板', account: 'boss', roleId: 'r-admin', hue: 166, canWrite: false },
  { id: 'u-acheng', name: '销售一', account: 'acheng', roleId: 'r-sales', hue: 212, canWrite: false },
  { id: 'u-yang', name: '销售二', account: 'xiaoyang', roleId: 'r-sales', hue: 28, canWrite: false },
  { id: 'u-xiao', name: '写手一', account: 'xiaosenkai', roleId: 'r-writer', hue: 280, canWrite: true },
]

async function main() {
  const lines: string[] = []
  for (const p of PEOPLE) {
    const [has] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.id, p.id))
    if (has) continue
    const pw = tempPassword()
    await db.insert(t.users).values({ ...p, passwordHash: await hashPassword(pw), mustChangePassword: true })
    lines.push(`${p.name}\t登录名 ${p.account}\t临时密码 ${pw}`)
  }
  // 默认写手：写手一
  await db.insert(t.options).values({ key: 'defaultWriter', values: ['u-xiao'] }).onConflictDoNothing()
  if (lines.length) {
    const dir = path.resolve(process.cwd(), '..', 'data')
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, 'accounts-initial.txt')
    await writeFile(file, `# 初始账号（首次登录必须改密码；发给本人后删掉这个文件）\n${lines.join('\n')}\n`, { flag: 'a' })
    await chmod(file, 0o600)
    console.log(`新建 ${lines.length} 个账号，临时密码已写入 ${file}`)
  } else console.log('账号都已存在，没有新建')
  await sql.end()
}

main().catch(async (e) => {
  console.error(e)
  await sql.end()
  process.exit(1)
})
