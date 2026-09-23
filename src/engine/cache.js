// Recent reads, one gzipped JSON file per thread. A live cache, not an archive: every entry
// expires after MAX_AGE_S and the folder is capped at MAX_BYTES, oldest evicted first.
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const VERSION = 1; // bump when the entry shape changes; older files then read as misses
const MAX_AGE_S = 7 * 86_400;
const MAX_BYTES = 100 * 1024 * 1024;

export function openCache(dir, { maxBytes = MAX_BYTES } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = key => join(dir, `${key}.json.gz`);

  function prune(nowS) {
    const files = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json.gz')) continue;
      try {
        const { size, mtimeMs } = statSync(join(dir, name));
        files.push({ name, size, t: mtimeMs / 1000 });
      } catch {} // removed by another process meanwhile
    }
    files.sort((a, b) => b.t - a.t); // newest first
    let total = 0;
    for (const f of files) {
      total += f.size;
      if (total > maxBytes || nowS - f.t > MAX_AGE_S) rmSync(join(dir, f.name), { force: true });
    }
  }

  return {
    get(key) {
      try {
        const entry = JSON.parse(gunzipSync(readFileSync(path(key))));
        return entry.v === VERSION ? entry : null;
      } catch {
        return null; // missing or unreadable is just a miss
      }
    },

    // entry.fetchedAt (unix s) becomes the file's mtime, so expiry and eviction never read files.
    // A cache that can't write is a cache that misses: never fail the caller's read over it.
    put(key, entry) {
      const tmp = `${path(key)}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, gzipSync(JSON.stringify({ v: VERSION, ...entry })));
        utimesSync(tmp, entry.fetchedAt, entry.fetchedAt);
        renameSync(tmp, path(key)); // atomic: readers see the old file or the new one, never half
        prune(entry.fetchedAt);
      } catch {
        rmSync(tmp, { force: true });
      }
    },
  };
}
