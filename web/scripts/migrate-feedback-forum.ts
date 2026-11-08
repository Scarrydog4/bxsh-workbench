/** Explicit migration; no default connection. Non-preview databases need --confirm-database=<name>. */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrateAndSeed } from '../src/server/setup'
import { migrateFeedback } from '../src/server/migrate-feedback'
import * as schema from '../src/server/schema'

const url = process.env.DATABASE_URL, storage = process.env.STORAGE_DIR
if (!url || !storage) throw new Error('DATABASE_URL and STORAGE_DIR are required')
const target = new URL(url)
const database = target.pathname.slice(1)
// 本机预览/副本库可以直接跑；其他库（包括正式库）必须显式写出库名确认：--confirm-database=<库名>
const confirmed = process.argv.find(arg => arg.startsWith('--confirm-database='))?.split('=')[1]
const local = ['127.0.0.1','localhost','[::1]'].includes(target.hostname) && /preview|forum.*(?:test|copy|migration)/.test(target.pathname)
if (!local && confirmed !== database) throw new Error(`Refusing to migrate "${database}". Re-run with --confirm-database=${database} after stopping writes to the old feedback page.`)
const sql = postgres(url,{max:1,onnotice:()=>{}})
try {
  await migrateAndSeed(sql)
  console.log(JSON.stringify(await migrateFeedback(drizzle(sql,{schema}),storage)))
} finally { await sql.end() }
