// Engine entry: the source chain and the one operation Phase 1 needs, readThread().
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NotFound, SourceDown } from './errors.js';
import { parseRedditRef, buildTree, toRecord } from './reddit.js';
import arcticshift from './adapters/arcticshift.js';
import pullpush from './adapters/pullpush.js';

export { createHttp } from './http.js';
export { openStore } from './store.js';
export * from './errors.js';

export function defaultDbPath() {
  const env = process.env;
  if (env.TARANTULA_DB) return env.TARANTULA_DB;
  const base = env.LOCALAPPDATA ?? env.XDG_DATA_HOME
    ?? join(homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.local/share');
  return join(base, 'tarantula', 'tarantula.db');
}

// Try sources in order. Down -> next. Missing or incomplete -> remember, try next.
// Returns the first complete answer, else the first partial one, else throws.
export async function firstHealthy(adapters, attempt, complete = r => r != null) {
  const problems = [];
  let partial = null, missing = false;
  for (const adapter of adapters) {
    try {
      const result = await attempt(adapter);
      if (complete(result)) return { adapter, result, partial: false };
      if (result == null) { missing = true; problems.push(`${adapter.name}: not found`); continue; }
      partial ??= { adapter, result, partial: true };
      problems.push(`${adapter.name}: incomplete`);
    } catch (e) {
      if (!(e instanceof SourceDown)) throw e;
      problems.push(e.message);
    }
  }
  if (partial) return partial;
  const detail = problems.join('; ');
  throw missing || !problems.length ? new NotFound(detail) : new SourceDown(`all sources failed: ${detail}`);
}

const nowS = () => Math.floor(Date.now() / 1000);
const MAX_AGE_S = 6 * 3600; // cache: a full read younger than this is served locally

export async function readThread(ref, { store, http, adapters = [arcticshift, pullpush], fresh = false, now = nowS }) {
  // Every response an adapter receives is logged so it can be stored raw.
  const via = (adapter, log) => async url => {
    const res = await http(url, { minIntervalMs: adapter.minIntervalMs });
    log.push({ source: adapter.name, url, text: res.text, at: now() });
    return res.json;
  };

  let target = parseRedditRef(ref);
  if (target.shortPath) {
    const { result } = await firstHealthy(adapters.filter(a => a.resolveShortLink),
      a => a.resolveShortLink(target.shortPath, via(a, []))).catch(e => {
      throw e instanceof NotFound
        ? new NotFound(`share link ${target.shortPath} isn't in the archive's index. Open it in a browser and paste the full URL.`)
        : e;
    });
    target = parseRedditRef('https://www.reddit.com' + result);
  }
  const { threadId, commentId } = target;
  const focusOf = tree => (commentId && tree[0]?.id === commentId ? commentId : undefined);

  // ponytail: cache is "any full read younger than MAX_AGE_S"; Phase 4 harvesting will need a real
  // "thread is complete" marker because it stores posts without comments
  if (!fresh) {
    const hit = store.getThread(`t3_${threadId}`);
    if (hit && now() - hit.seenAt < MAX_AGE_S) {
      const tree = buildTree(hit.comments, commentId);
      return { post: hit.post, tree, source: 'cache', seenAt: hit.seenAt, partial: false, collapsed: 0, focus: focusOf(tree) };
    }
  }

  // Silent-200 guard: the post claims comments but the archive returned none -> try the next source.
  const complete = r => r != null && !(r.comments.length === 0 && r.post.num_comments > 0);
  const { adapter, result, partial } = await firstHealthy(adapters, async a => {
    const log = [];
    const r = await a.thread(threadId, via(a, log));
    return r && { ...r, log };
  }, complete).catch(e => {
    if (e instanceof NotFound) e.message = `thread ${threadId} isn't in any archive yet (they lag Reddit by minutes to hours). ${e.message}`;
    throw e;
  });

  const at = now();
  store.saveThread(result.log, [result.post, ...result.comments].map(row => toRecord(row, at)));
  const tree = buildTree(result.comments, commentId);
  return { post: result.post, tree, source: adapter.name, seenAt: at, partial, collapsed: result.collapsed ?? 0, focus: focusOf(tree) };
}
