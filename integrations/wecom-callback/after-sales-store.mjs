import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync, copyFileSync, statSync, constants } from 'node:fs'
import { join, basename, extname, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

// 独立、私有的单笔售后任务。桌面读取的证据不能冒充存档 API 消息。
export function openAfterSales(root) {
  root = resolve(root)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const filename = join(root, 'after-sales.sqlite')
  const db = new DatabaseSync(filename)
  chmodSync(filename, 0o600)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`)
  function get(id) {
    const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id)
    if (!row) throw new Error('售后任务不存在')
    return { id: row.id, state: row.state, ...JSON.parse(row.payload), createdAt: row.created_at, updatedAt: row.updated_at }
  }
  function update(job, state, changes = {}) {
    const { id, createdAt, updatedAt, state: oldState, ...payload } = job
    const result = db.prepare('UPDATE jobs SET state=?,payload=?,updated_at=? WHERE id=? AND state=? AND updated_at=?')
      .run(state, JSON.stringify({ ...payload, ...changes }), new Date().toISOString(), id, oldState, updatedAt)
    if (result.changes !== 1) throw new Error('任务已被其他进程更新，请重新读取')
    return get(id)
  }
  function saveFile(id, kind, path, extension) {
    path = resolve(path)
    if (extname(path).toLowerCase() !== extension || !statSync(path).isFile() || statSync(path).size === 0) {
      throw new Error(`需要非空 ${extension} 文件`)
    }
    const folder = join(root, id, kind, randomUUID())
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const stored = join(folder, basename(path))
    copyFileSync(path, stored, constants.COPYFILE_EXCL)
    chmodSync(stored, 0o600)
    return { name: basename(path), path: stored, bytes: statSync(stored).size }
  }
  return {
    get,
    import(input) {
      for (const key of ['source', 'groupName', 'topic', 'requester', 'requestAtLabel', 'request', 'observedAt']) {
        if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`缺少 ${key}`)
      }
      if (input.source !== 'desktop_observation') throw new Error('当前入口仅接收桌面核对记录，尚未接通存档消息')
      if (input.scopeConfirmed !== true) throw new Error('请先核实售后在订单范围内')
      if (!input.expectedSourceName?.endsWith('.docx')) throw new Error('请指定已交付的开题报告文件名')
      if (!Array.isArray(input.evidence) || !input.evidence.length) throw new Error('需要群内依据')
      const identity = [input.source, input.groupName.trim(), input.topic.trim(), input.requester.trim(), input.requestAtLabel.trim(), input.request.trim()]
      const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
      const id = `as_${key.slice(0, 24)}`
      const now = new Date().toISOString()
      const payload = {
        source: input.source, groupName: input.groupName, topic: input.topic,
        orderReference: input.orderReference || null, platformOrderId: input.platformOrderId || null,
        roomId: null, requester: input.requester, requestAtLabel: input.requestAtLabel,
        request: input.request, observedAt: input.observedAt, scopeConfirmed: true,
        expectedSourceName: input.expectedSourceName, evidence: input.evidence,
        inputFile: null, artifact: null, reviewNote: null,
        automaticChatSync: false, delivery: 'not_sent',
      }
      db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?) ON CONFLICT(source_key) DO NOTHING')
        .run(id, key, 'waiting_source', JSON.stringify(payload), now, now)
      return get(id)
    },
    attach(id, path) {
      const job = get(id)
      if (!['waiting_source', 'ready'].includes(job.state)) throw new Error('制作开始后不能替换原稿')
      if (basename(path) !== job.expectedSourceName) throw new Error(`原稿文件名应为 ${job.expectedSourceName}`)
      return update(job, 'ready', { inputFile: saveFile(id, 'input', path, '.docx') })
    },
    start(id) {
      const job = get(id)
      if (job.state !== 'ready' || !job.inputFile) throw new Error('原稿尚未就绪，不能开始制作')
      if (!statSync(job.inputFile.path).isFile()) throw new Error('原稿文件丢失')
      return update(job, 'running')
    },
    complete(id, path, reviewNote) {
      const job = get(id)
      if (job.state !== 'running') throw new Error('任务尚未进入制作')
      if (!reviewNote?.trim()) throw new Error('请填写实际检查结果')
      return update(job, 'ready_for_review', { artifact: saveFile(id, 'output', path, '.pptx'), reviewNote })
    },
    list() {
      return db.prepare('SELECT id FROM jobs ORDER BY created_at DESC').all().map(({ id }) => get(id))
    },
    close() { db.close() },
  }
}
