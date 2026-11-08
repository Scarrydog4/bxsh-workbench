import { DatabaseSync } from 'node:sqlite'
import { readStatus } from './store.mjs'
const db = new DatabaseSync(process.env.WECOM_DB_PATH || './data/events.sqlite', { readOnly: true })
try { console.log(JSON.stringify(readStatus(db), null, 2)) } finally { db.close() }
