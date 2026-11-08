#!/usr/bin/env python3
"""Private archive collector. No public HTTP interface, execution or group messaging."""
import argparse
import base64
import fcntl
import hashlib
import json
import os
import re
import signal
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from sdk import ArchiveError, FinanceSDK, load_keys


def now():
    return datetime.now(timezone.utc).isoformat()


def safe_error(error):
    return str(error) if isinstance(error, ArchiveError) else type(error).__name__


def media_items(value):
    """Find SDK media references, including nested mixed/forwarded messages."""
    if isinstance(value, list):
        for child in value:
            yield from media_items(child)
    elif isinstance(value, dict):
        if isinstance(value.get('sdkfileid'), str) and value['sdkfileid']:
            yield value
        for key, child in value.items():
            # Some forwarded chat items encode their message body as JSON text.
            if key == 'content' and isinstance(child, str) and child.lstrip().startswith(('{', '[')):
                try:
                    child = json.loads(child)
                except ValueError:
                    pass
            if isinstance(child, (dict, list)):
                yield from media_items(child)


def safe_filename(value):
    name = re.sub(r'[\x00-\x1f/\\:*?"<>|]', '_', str(value)).strip(' .') or 'attachment.bin'
    while len(name.encode('utf-8')) > 180:
        name = name[:-1]
    return name


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.root / 'archive.sqlite')
        self.db.row_factory = sqlite3.Row
        os.chmod(self.root / 'archive.sqlite', 0o600)
        self.db.executescript('''
          PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS envelopes (
            msgid TEXT PRIMARY KEY, seq TEXT NOT NULL, payload TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'pending', error TEXT, received_at TEXT NOT NULL,
            retry_at REAL NOT NULL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS messages (
            msgid TEXT PRIMARY KEY, room_id TEXT NOT NULL, sender TEXT NOT NULL,
            msgtime INTEGER NOT NULL, msgtype TEXT NOT NULL, action TEXT NOT NULL,
            text_content TEXT NOT NULL, payload TEXT NOT NULL, stored_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS messages_room_time ON messages(room_id,msgtime);
          CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY, msgid TEXT NOT NULL, sdkfileid TEXT NOT NULL,
            filename TEXT NOT NULL, expected_size INTEGER, expected_md5 TEXT,
            path TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
            offset INTEGER NOT NULL DEFAULT 0, next_index TEXT NOT NULL DEFAULT '',
            retries INTEGER NOT NULL DEFAULT 0, retry_at REAL NOT NULL DEFAULT 0,
            error TEXT, finished_at TEXT
          );
        ''')

    def close(self):
        self.db.close()

    def meta(self, key, default=None):
        row = self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return row[0] if row else default

    def set_meta(self, key, value):
        self.db.execute('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))

    def bind_corp(self, corp_id):
        previous = self.meta('corp_id')
        if previous and previous != corp_id:
            raise ArchiveError('corp_id_mismatch_use_separate_data_directory')
        with self.db:
            self.set_meta('corp_id', corp_id)

    def accept(self, batch):
        cursor = int(self.meta('seq', '0'))
        max_seq = cursor
        with self.db:
            for row in batch:
                seq = row.get('seq')
                if not isinstance(seq, int) or isinstance(seq, bool) or not 0 <= seq < 2**64:
                    raise ArchiveError('invalid_seq')
                if not all(row.get(k) for k in ['msgid', 'publickey_ver', 'encrypt_random_key', 'encrypt_chat_msg']):
                    raise ArchiveError('incomplete_envelope')
                self.db.execute('INSERT OR IGNORE INTO envelopes (msgid,seq,payload,received_at) VALUES (?,?,?,?)',
                                (row['msgid'], str(seq), json.dumps(row), now()))
                max_seq = max(max_seq, seq)
            self.set_meta('seq', max_seq)
            self.set_meta('last_pull_success', now())
        return max_seq > cursor

    def save_message(self, envelope, message):
        if message.get('msgid') != envelope['msgid']:
            raise ArchiveError('decrypted_msgid_mismatch')
        text = message.get('text', {}).get('content', '') if isinstance(message.get('text'), dict) else ''
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO messages VALUES (?,?,?,?,?,?,?,?,?)',
                            (message['msgid'], message.get('roomid', ''), message.get('from', ''),
                             message.get('msgtime', 0), message.get('msgtype', ''), message.get('action', ''),
                             text, json.dumps(message, ensure_ascii=False), now()))
            for item in media_items(message):
                media_id = hashlib.sha256((message['msgid'] + '\0' + item['sdkfileid']).encode()).hexdigest()
                extension = str(item.get('fileext', 'bin')).lstrip('.')
                filename = safe_filename(item.get('filename') or f'{message.get("msgtype", "media")}.{extension}')
                file_path = self.root / 'files' / media_id / filename
                size = item.get('filesize', item.get('imagesize'))
                if not isinstance(size, int) or size < 0:
                    size = None
                md5 = item.get('md5sum')
                if not isinstance(md5, str) or not re.fullmatch(r'[a-fA-F0-9]{32}', md5):
                    md5 = None
                self.db.execute('''INSERT OR IGNORE INTO media
                  (id,msgid,sdkfileid,filename,expected_size,expected_md5,path) VALUES (?,?,?,?,?,?,?)''',
                  (media_id, message['msgid'], item['sdkfileid'], filename, size, md5, str(file_path)))
            self.db.execute("UPDATE envelopes SET state='decoded',error=NULL WHERE msgid=?", (envelope['msgid'],))

    def status(self):
        counts = lambda table: self.db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
        return {
            'stage': self.meta('stage', 'not_started'), 'seq': self.meta('seq', '0'),
            'lastPullSuccess': self.meta('last_pull_success'), 'lastError': self.meta('last_error'),
            'encryptedMessages': counts('envelopes'), 'decryptedMessages': counts('messages'),
            'waitingDecryption': self.db.execute("SELECT count(*) FROM envelopes WHERE state!='decoded'").fetchone()[0],
            'decryptionErrors': dict(self.db.execute("SELECT error,count(*) FROM envelopes WHERE state='retry' GROUP BY error").fetchall()),
            'media': dict(self.db.execute('SELECT state,count(*) FROM media GROUP BY state').fetchall()),
            'groupCount': self.db.execute("SELECT count(DISTINCT room_id) FROM messages WHERE room_id!=''").fetchone()[0],
        }


def validate_file(path, row):
    if row['expected_size'] is not None and path.stat().st_size != row['expected_size']:
        raise ArchiveError('media_size_mismatch')
    if row['expected_md5']:
        digest = hashlib.md5()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest().lower() != row['expected_md5'].lower():
            raise ArchiveError('media_md5_mismatch')


def download(store, sdk, row, max_chunks=32):
    target = Path(row['path'])
    partial = target.with_name(target.name + '.part')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    offset, index = row['offset'], base64.b64decode(row['next_index'])
    try:
        # Recover a crash after rename but before the SQLite completion commit.
        if target.exists():
            validate_file(target, row)
            with store.db:
                store.db.execute("UPDATE media SET state='complete',error=NULL,finished_at=? WHERE id=?", (now(), row['id']))
            return
        if not partial.exists() or partial.stat().st_size < offset:
            offset, index = 0, b''
        with partial.open('r+b' if partial.exists() else 'w+b') as stream:
            stream.truncate(offset)  # Drop any uncommitted tail after a crash.
            stream.seek(offset)
            for _ in range(max_chunks):
                data, next_index, finished = sdk.media(row['sdkfileid'], index)
                if not finished and (not data or not next_index or next_index == index):
                    raise ArchiveError('media_cursor_stalled')
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
                offset += len(data)
                index = next_index
                if row['expected_size'] is not None and offset > row['expected_size']:
                    raise ArchiveError('media_size_mismatch')
                with store.db:
                    store.db.execute("UPDATE media SET offset=?,next_index=?,state='downloading',error=NULL WHERE id=?",
                                     (offset, base64.b64encode(index).decode(), row['id']))
                if finished:
                    validate_file(partial, row)
                    os.replace(partial, target)
                    with store.db:
                        store.db.execute("UPDATE media SET state='complete',error=NULL,finished_at=? WHERE id=?", (now(), row['id']))
                    return
    except Exception as error:
        reset = isinstance(error, ArchiveError) and str(error) in ('media_size_mismatch', 'media_md5_mismatch')
        if reset:
            # Remove only this collector's invalid download, never the source attachment.
            if target.exists():
                target.unlink()
            with partial.open('wb'):
                pass
        with store.db:
            if reset:
                store.db.execute("UPDATE media SET offset=0,next_index='' WHERE id=?", (row['id'],))
            store.db.execute("UPDATE media SET state='retry',retries=retries+1,retry_at=?,error=? WHERE id=?",
                             (time.time() + min(300, 30 * 2 ** min(row['retries'], 4)), safe_error(error), row['id']))


def collect_once(store, sdk, keys, pages=10):
    pull_error = ''
    try:
        for _ in range(pages):
            batch = sdk.chat(int(store.meta('seq', '0')))
            advanced = store.accept(batch)
            if not batch:
                break
            if not advanced:
                raise ArchiveError('chat_cursor_stalled')
    except Exception as error:
        pull_error = safe_error(error)
    # A failed network pull or old key must not block already stored work.
    pending = store.db.execute("""SELECT payload FROM envelopes WHERE state!='decoded' AND retry_at<=?
        ORDER BY retry_at,rowid LIMIT 1000""", (time.time(),)).fetchall()
    for row in pending:
        envelope = json.loads(row['payload'])
        try:
            store.save_message(envelope, sdk.decrypt(envelope, keys))
        except Exception as error:
            with store.db:
                store.db.execute("UPDATE envelopes SET state='retry',error=?,retry_at=? WHERE msgid=?",
                                 (safe_error(error), time.time() + 60, envelope['msgid']))
    for row in store.db.execute("SELECT * FROM media WHERE state!='complete' AND retry_at<=? ORDER BY rowid LIMIT 10", (time.time(),)).fetchall():
        download(store, sdk, row)
    with store.db:
        store.set_meta('stage', 'error' if pull_error else 'syncing')
        store.set_meta('last_error', pull_error)


def read_config(path):
    cfg = json.loads(Path(path).read_text())
    required = ['corp_id', 'secret', 'sdk_library', 'key_paths', 'data_dir']
    missing = [key for key in required if not cfg.get(key)]
    if missing:
        raise ArchiveError('missing_' + '_'.join(missing))
    if not 10 <= int(cfg.get('interval_seconds', 30)) <= 3600:
        raise ArchiveError('invalid_interval')
    return cfg


def run(path, once=False):
    initial = json.loads(Path(path).read_text())
    store = Store(initial['data_dir'])
    lock = (store.root / 'worker.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise ArchiveError('worker_already_running')
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    sdk, config_signature, last_log = None, None, None
    try:
        while not stop.is_set():
            interval = 30
            try:
                cfg = read_config(path)
                store.bind_corp(cfg['corp_id'])
                interval = int(cfg.get('interval_seconds', 30))
                signature = (cfg['corp_id'], cfg['secret'], cfg['sdk_library'])
                if signature != config_signature:
                    if sdk:
                        sdk.close()
                    sdk = FinanceSDK(cfg['sdk_library'], cfg['corp_id'], cfg['secret'])
                    config_signature = signature
                collect_once(store, sdk, load_keys(cfg['key_paths']))
            except Exception as error:
                code = safe_error(error)
                with store.db:
                    store.set_meta('stage', 'waiting_configuration' if code.startswith('missing_') else 'error')
                    store.set_meta('last_error', code)
            status = store.status()
            fingerprint = json.dumps({k: v for k, v in status.items() if k != 'lastPullSuccess'}, sort_keys=True)
            if fingerprint != last_log:
                print(json.dumps({'at': now(), **status}), flush=True)
                last_log = fingerprint
            if once:
                return status
            stop.wait(interval)
    finally:
        if sdk:
            sdk.close()
        store.close()
        lock.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('command', choices=['run', 'once', 'status', 'files'])
    parser.add_argument('--name', default='')
    args = parser.parse_args()
    os.umask(0o077)
    if args.command in ('run', 'once'):
        run(args.config, args.command == 'once')
        return
    cfg = json.loads(Path(args.config).read_text())
    store = Store(cfg['data_dir'])
    try:
        if args.command == 'status':
            print(json.dumps(store.status(), ensure_ascii=False, indent=2))
        else:
            rows = store.db.execute('''SELECT media.id,media.filename,media.state,media.path,
                media.expected_size,messages.room_id,messages.msgtime FROM media
                JOIN messages ON messages.msgid=media.msgid WHERE instr(media.filename,?)>0
                ORDER BY messages.msgtime DESC LIMIT 100''', (args.name,)).fetchall()
            print(json.dumps([dict(row) for row in rows], ensure_ascii=False, indent=2))
    finally:
        store.close()


if __name__ == '__main__':
    main()
