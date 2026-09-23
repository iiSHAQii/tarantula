// One SQLite file. `fetches` is the truth (every response as received); `records` is a
// projection that can be rebuilt from it. All timestamps are unix seconds.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS fetches (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,     -- provider that answered: arcticshift, pullpush, ...
  url          TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  body         BLOB NOT NULL      -- zstd of the exact 200 response text; append-only
);

CREATE TABLE IF NOT EXISTS records (
  platform     TEXT NOT NULL,
  id           TEXT NOT NULL,     -- the platform's global id (Reddit fullname t3_/t1_)
  kind         TEXT NOT NULL,
  url          TEXT,
  parent_id    TEXT,
  thread_id    TEXT,
  container    TEXT,              -- subreddit, company, ...
  author       TEXT,
  title        TEXT,
  text         TEXT,
  created_at   INTEGER,           -- when the author wrote it; NULL if unknown, never guessed
  fetched_at   INTEGER NOT NULL,  -- first captured
  last_seen_at INTEGER NOT NULL,  -- last fetch that returned it
  gone_at      INTEGER,           -- source reported it deleted/removed
  payload      TEXT,              -- the source row as JSON
  PRIMARY KEY (platform, id)
);
CREATE INDEX IF NOT EXISTS records_thread ON records (platform, thread_id);
`;

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const insertFetch = db.prepare(
    'INSERT INTO fetches (source, url, fetched_at, body) VALUES (?, ?, ?, ?)');
  const upsert = db.prepare(`
    INSERT INTO records (platform, id, kind, url, parent_id, thread_id, container, author, title, text,
                         created_at, fetched_at, last_seen_at, gone_at, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (platform, id) DO UPDATE SET
      url = excluded.url, author = excluded.author, title = excluded.title, text = excluded.text,
      payload = excluded.payload, last_seen_at = excluded.last_seen_at,
      gone_at = COALESCE(records.gone_at, excluded.gone_at)`);
  const threadRows = db.prepare(
    `SELECT kind, payload, last_seen_at FROM records WHERE platform = 'reddit' AND thread_id = ?`);

  return {
    db,

    // Raw responses and their records land together or not at all.
    saveThread(fetches, records) {
      db.exec('BEGIN');
      try {
        for (const f of fetches) insertFetch.run(f.source, f.url, f.at, zstdCompressSync(f.text));
        for (const r of records) {
          upsert.run(r.platform, r.id, r.kind, r.url, r.parent_id, r.thread_id, r.container, r.author,
            r.title, r.text, r.created_at, r.seen_at, r.seen_at, r.gone ? r.seen_at : null, r.payload);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    // -> { post, comments, seenAt } from the local copy, or null
    getThread(threadFullname) {
      const rows = threadRows.all(threadFullname);
      const post = rows.find(r => r.kind === 'post');
      if (!post) return null;
      return {
        post: JSON.parse(post.payload),
        comments: rows.filter(r => r.kind === 'comment').map(r => JSON.parse(r.payload)),
        seenAt: post.last_seen_at,
      };
    },

    close: () => db.close(),
  };
}
