import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(filename)
  if (filename !== ':memory:') chmodSync(filename, 0o600)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, received_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      deliveries INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL,
      message_type TEXT NOT NULL, event_type TEXT NOT NULL, create_time TEXT NOT NULL,
      room_id TEXT NOT NULL, needs_archive_pull INTEGER NOT NULL DEFAULT 0, raw_xml TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verification (
      source TEXT PRIMARY KEY, verified_at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1
    );
  `)
  const insert = db.prepare(`INSERT INTO events (id,received_at,last_seen_at,source,message_type,event_type,create_time,room_id,needs_archive_pull,raw_xml)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET deliveries=deliveries+1, last_seen_at=excluded.last_seen_at`)
  return {
    db,
    save(event) {
      insert.run(event.id, event.receivedAt, event.receivedAt, event.source, event.messageType, event.eventType, event.createTime, event.roomId, event.needsArchivePull ? 1 : 0, event.xml)
    },
    verified(source) {
      db.prepare('INSERT INTO verification (source,verified_at) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET verified_at=excluded.verified_at,count=count+1').run(source, new Date().toISOString())
    },
    close() { db.close() },
  }
}

export function readStatus(db) {
  return {
    stage: 'callback_only',
    verifications: db.prepare('SELECT source,verified_at,count FROM verification ORDER BY source').all(),
    events: db.prepare('SELECT source,count(*) AS unique_events,sum(deliveries) AS deliveries,sum(needs_archive_pull) AS pending_archive_notifications FROM events GROUP BY source').all(),
    latest: db.prepare('SELECT received_at,source,message_type,event_type,deliveries,needs_archive_pull FROM events ORDER BY received_at DESC LIMIT 5').all(),
    archiveReaderConnected: false,
  }
}
