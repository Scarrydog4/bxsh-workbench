import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'
import { env } from './env'

// 开发时热更新会反复加载模块，连接池挂在 globalThis 上复用
const g = globalThis as unknown as { __bxshSql?: ReturnType<typeof postgres> }
export const sql = g.__bxshSql ?? postgres(env.databaseUrl, { max: 10, idle_timeout: 30 })
if (process.env.NODE_ENV !== 'production') g.__bxshSql = sql

export const db = drizzle(sql, { schema })
export type DB = typeof db
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
