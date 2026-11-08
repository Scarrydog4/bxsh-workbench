import { cp, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const standalone = path.join(root, '.next/standalone')
await access(path.join(standalone, 'server.js'))
await cp(path.join(root, '.next/static'), path.join(standalone, '.next/static'), { recursive: true })
try { await access(path.join(root, 'public')); await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
process.env.NODE_ENV = 'production'
process.env.PORT ??= '3100'
process.env.HOSTNAME ??= '127.0.0.1'
// 启动文件改变工作目录前固定上传文件的位置。
process.env.STORAGE_DIR ??= path.resolve(root, '../storage')
await import(path.join(standalone, 'server.js'))
