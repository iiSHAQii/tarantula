// Engine entry: the source chain and the one operation Phase 1 needs, readThread().
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NotFound, SourceDown } from './errors.js';
import { parseRedditRef, buildTree } from './reddit.js';
import arcticshift from './adapters/arcticshift.js';
import pullpush from './adapters/pullpush.js';

export { createHttp } from './http.js';
export { openCache } from './cache.js';
export * from './errors.js';

export function defaultCacheDir() {
  const env = process.env;
  if (env.TARANTULA_CACHE) return env.TARANTULA_CACHE;
  const base = env.LOCALAPPDATA ?? env.XDG_CACHE_HOME
    ?? join(homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache');
  return join(base, 'tarantula');
}

// Try sources in order. Down -> next. Missing or incomplete -> remember, try next.
// Returns the first complete answer, else the first partial one, else throws.
export async function firstHealthy(adapters, attempt, complete = r => r != null) {
  const problems = [];
  let partial = null, missing = false, down = false;
  for (const adapter of adapters) {
    try {
      const result = await attempt(adapter);
      if (complete(result)) return { adapter, result, partial: false };
      if (result == null) { missing = true; problems.push(`${adapter.name}: not found`); continue; }
      partial ??= { adapter, result, partial: true };
      problems.push(`${adapter.name}: incomplete`);
    } catch (e) {
      if (!(e instanceof SourceDown)) throw e;
      down = true;
      problems.push(e.message);
    }
  }
  if (partial) return partial;
  const detail = problems.join('; ');
  // "Not found" only if every source actually answered; a source that was down might have it.
  throw !down && (missing || !problems.length)
    ? new NotFound(detail)
    : new SourceDown(`no source could answer, try again shortly. ${detail}`);
}

const nowS = () => Math.floor(Date.now() / 1000);

// A young thread is still filling in, an old one barely changes: reuse a cached copy for a
// quarter of the thread's age when it was fetched, between 5 minutes and 24 hours.
const freshFor = e => Math.min(Math.max((e.fetchedAt - e.post.created_utc) / 4, 300), 86_400);

export async function readThread(ref, { cache, http, adapters = [arcticshift, pullpush], fresh = false, now = nowS }) {
  const via = adapter => url => http(url, { minIntervalMs: adapter.minIntervalMs });

  let target = parseRedditRef(ref);
  if (target.shortPath) {
    const { result } = await firstHealthy(adapters.filter(a => a.resolveShortLink),
      a => a.resolveShortLink(target.shortPath, via(a))).catch(e => {
      throw e instanceof NotFound
        ? new NotFound(`share link ${target.shortPath} isn't in the archive's index. Open it in a browser and paste the full URL.`)
        : e;
    });
    target = parseRedditRef('https://www.reddit.com' + result);
  }
  const { threadId, commentId } = target;
  const view = (entry, source, partial = false) => {
    const tree = buildTree(entry.comments, commentId);
    const focus = commentId && tree[0]?.id === commentId ? commentId : undefined;
    return { post: entry.post, tree, source, fetchedAt: entry.fetchedAt, partial, collapsed: entry.collapsed, focus };
  };

  const key = `reddit-${threadId}`; // threadId is [a-z0-9] only (parseRedditRef), so safe as a filename
  const hit = !fresh && cache.get(key);
  if (hit && now() - hit.fetchedAt < freshFor(hit)) return view(hit, `${hit.source}, cached`);

  // Silent-200 guard: the post claims comments but the archive returned none -> try the next source.
  const complete = r => r != null && !(r.comments.length === 0 && r.post.num_comments > 0);
  const { adapter, result, partial } = await firstHealthy(adapters, a => a.thread(threadId, via(a)), complete)
    .catch(e => {
      if (e instanceof NotFound) e.message = `thread ${threadId} isn't in any archive yet (they lag Reddit by minutes to hours). ${e.message}`;
      throw e;
    });

  const entry = { source: adapter.name, fetchedAt: now(), post: result.post, comments: result.comments, collapsed: result.collapsed ?? 0 };
  if (!partial) cache.put(key, entry); // a partial copy would hide the full one for hours
  return view(entry, adapter.name, partial);
}
