/**
 * 建表 + 写入预置数据（角色、选项）。可以反复执行。
 * 用法：pnpm db:migrate
 */
import postgres from 'postgres'
import { migrateAndSeed } from '../src/server/setup'

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://bxsh@127.0.0.1:5433/workbench', { max: 1, onnotice: () => {} })
migrateAndSeed(sql)
  .then(() => console.log('表结构和预置数据已就绪'))
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => sql.end())
