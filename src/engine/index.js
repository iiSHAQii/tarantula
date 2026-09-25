// Engine entry: the source chain, readThread() and searchPosts(). Both return schema-1 results.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NotFound, SourceDown, UserError } from './errors.js';
import { parseRedditRef, toItem, buildTree, limitTree, countTree } from './reddit.js';
import arcticshift from './adapters/arcticshift.js';
import pullpush from './adapters/pullpush.js';

export { createHttp } from './http.js';
export { openCache } from './cache.js';
export * from './errors.js';

const ADAPTERS = [arcticshift, pullpush];

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
const via = (http, adapter) => url => http(url, { minIntervalMs: adapter.minIntervalMs });

// A young thread is still filling in, an old one barely changes: reuse a cached copy for a
// quarter of the thread's age when it was fetched, between 5 minutes and 24 hours.
const freshFor = e => Math.min(Math.max((e.fetchedAt - e.post.created_at) / 4, 300), 86_400);

export async function readThread(ref, { cache, http, adapters = ADAPTERS, fresh = false, now = nowS }) {
  let target = parseRedditRef(ref);
  if (target.shortPath) {
    const { result } = await firstHealthy(adapters.filter(a => a.resolveShortLink),
      a => a.resolveShortLink(target.shortPath, via(http, a))).catch(e => {
      throw e instanceof NotFound
        ? new NotFound(`share link ${target.shortPath} isn't in the archive's index. Open it in a browser and paste the full URL.`)
        : e;
    });
    target = parseRedditRef('https://www.reddit.com' + result);
  }
  const { threadId, commentId } = target;

  const key = `reddit-${threadId}`; // threadId is [a-z0-9] only (parseRedditRef), so safe as a filename
  let entry = !fresh && cache.get(key);
  const cached = Boolean(entry && now() - entry.fetchedAt < freshFor(entry));
  if (!cached) {
    // Silent-200 guard: the post claims comments but the archive returned none -> try the next source.
    const complete = r => r != null && !(r.comments.length === 0 && r.post.num_comments > 0);
    const { adapter, result, partial } = await firstHealthy(adapters, a => a.thread(threadId, via(http, a)), complete)
      .catch(e => {
        if (e instanceof NotFound) e.message = `thread ${threadId} isn't in any archive yet (they lag Reddit by minutes to hours). ${e.message}`;
        throw e;
      });
    entry = {
      source: adapter.name, fetchedAt: now(), partial,
      retrievedAt: result.post.retrieved_on ?? result.post.retrieved_utc ?? null,
      post: toItem(result.post), comments: result.comments.map(toItem), collapsed: result.collapsed ?? 0,
    };
    if (!partial) cache.put(key, entry); // a partial copy would hide the full one for hours
  }

  const focusId = commentId && `t1_${commentId}`;
  const comments = buildTree(entry.comments, focusId);
  return {
    schema: 1,
    thread: entry.post,
    comments,
    provenance: { source: entry.source, cached, fetched_at: entry.fetchedAt, retrieved_at: entry.retrievedAt },
    completeness: {
      expected: entry.post.comment_count, received: entry.comments.length, collapsed: entry.collapsed,
      partial: entry.partial, shown: countTree(comments), truncated: false,
    },
    focus: focusId && comments[0]?.id === focusId ? focusId : null,
  };
}

// A readThread result cut to the first `max` comments in reading order.
export function limitThread(result, max) {
  if (!(max < Infinity)) return result;
  const comments = limitTree(result.comments, max);
  const shown = countTree(comments);
  return { ...result, comments, completeness: { ...result.completeness, shown, truncated: shown < result.completeness.shown } };
}

export const SCAN_DAYS = 30, SCAN_PAGES = 20;

// Keyword search on the archive is rationed; its plain listing isn't. So: page through the
// subreddit newest-first and keep posts whose title+body contain every query word.
// ponytail: substring match ("job" also hits "jobs"); no stemming or ranking, add if matches get noisy
async function scan(adapter, { sub, q, after, limit }, get, now) {
  const words = q.toLowerCase().split(/\s+/);
  const since = after ?? now() - SCAN_DAYS * 86_400;
  const seen = new Set(), rows = [];
  let before, backTo = since;
  for (let page = 0; page < SCAN_PAGES && rows.length < limit; page++) {
    const batch = await adapter.list({ subreddit: sub, after: since, before }, get);
    for (const r of batch) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (words.every(w => `${r.title ?? ''} ${r.selftext ?? ''}`.toLowerCase().includes(w))) rows.push(r);
    }
    if (batch.length < 100) { backTo = since; break; }  // reached the start of the window
    backTo = batch.at(-1).created_utc;
    before = backTo + 1; // 1 s overlap so same-second posts aren't skipped; `seen` drops repeats
  }
  return { rows, method: 'scan', scanned: seen.size, back_to: backTo };
}

// Posts in one subreddit matching `query`, newest first. Archive keyword search first (covers all
// time, often refused in ~0.5 s), else a scan of recent posts. A subreddit is required.
export async function searchPosts({ subreddit, query, days, limit = 25 }, { http, adapters = ADAPTERS, now = nowS }) {
  const sub = String(subreddit ?? '').trim().replace(/^\/?r\//i, '');
  const q = String(query ?? '').trim();
  if (!/^[A-Za-z0-9_]{2,21}$/.test(sub)) throw new UserError(`not a subreddit name: ${subreddit}`);
  if (!q) throw new UserError('search needs a query');

  const after = days ? now() - days * 86_400 : undefined;
  const attempt = a => a.search({ subreddit: sub, query: q, after }, via(http, a))
    .then(rows => ({ rows, method: 'search' }))
    .catch(e => {
      if (!(e instanceof SourceDown) || !a.list) throw e;
      return scan(a, { sub, q, after, limit }, via(http, a), now);
    });
  // An empty search page might be the archive, not the subreddit: try the next source first.
  // A scan that read posts and matched none is a real "no matches".
  const { adapter, result } = await firstHealthy(adapters.filter(a => a.search), attempt,
    r => r.rows.length > 0 || r.scanned > 0);
  const results = result.rows.map(toItem).sort((a, b) => b.created_at - a.created_at).slice(0, limit);
  const { rows, ...how } = result;
  return { schema: 1, subreddit: sub, query: q, results, provenance: { source: adapter.name, fetched_at: now(), ...how } };
}
