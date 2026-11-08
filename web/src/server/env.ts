import path from 'node:path'

/** 所有配置都从环境变量读；本机开发有默认值，服务器上由 .env 提供 */
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://bxsh@127.0.0.1:5433/workbench',
  storageDir: process.env.STORAGE_DIR ?? path.resolve(process.cwd(), '..', 'storage'),
  /** 生产环境走 HTTPS，cookie 必须带 Secure */
  secureCookie: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIE !== '1',
  sessionDays: Number(process.env.SESSION_DAYS ?? 14),
}
