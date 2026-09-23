import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRedditRef, buildTree } from '../src/engine/reddit.js';
import { createHttp } from '../src/engine/http.js';
import { openCache } from '../src/engine/cache.js';
import { readThread } from '../src/engine/index.js';
import { SourceDown, NotFound } from '../src/engine/errors.js';

const dirs = [];
const tmpCache = opts => { const d = mkdtempSync(join(tmpdir(), 'tarantula-test-')); dirs.push(d); return [openCache(d, opts), d]; };
after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

// Synthetic rows shaped like Arctic Shift / PullPush output. Never commit real Reddit content.
const post = {
  id: 'abc123', title: 'Where do you buy packaging?', selftext: 'Costs are up.', subreddit: 'testsub',
  author: 'op', created_utc: 1789000000, num_comments: 4, permalink: '/r/testsub/comments/abc123/where/',
};
const c = (id, parent, t, body = `text ${id}`) => ({
  id, parent_id: parent, link_id: 't3_abc123', author: `user_${id}`, body, score: 1, created_utc: t,
  subreddit: 'testsub', permalink: `/r/testsub/comments/abc123/where/${id}/`,
});
const comments = [c('c3', 't1_c1', 300), c('c9', 't1_missing', 400), c('c2', 't3_abc123', 200), c('c1', 't3_abc123', 100)];

test('parses every Reddit link form we accept', () => {
  const p = parseRedditRef;
  assert.equal(p('https://www.reddit.com/r/x/comments/1wkm29u/some_title/').threadId, '1wkm29u');
  assert.equal(p('https://old.reddit.com/r/x/comments/1wkm29u').threadId, '1wkm29u');
  assert.equal(p('https://redd.it/1wkm29u').threadId, '1wkm29u');
  assert.equal(p('t3_1wkm29u').threadId, '1wkm29u');
  assert.equal(p('https://www.reddit.com/r/x/comments/1wkm29u/some_title/pargsnk/').commentId, 'pargsnk');
  assert.equal(p('https://www.reddit.com/r/x/comments/1wkm29u/comment/pargsnk/?utm_source=share').commentId, 'pargsnk');
  assert.equal(p('https://www.reddit.com/r/x/comments/1wkm29u/some_title/?share_id=zz').commentId, undefined);
  assert.equal(p('https://www.reddit.com/r/running/s/3TzXiyxaMD').shortPath, '/r/running/s/3TzXiyxaMD');
  assert.throws(() => p('https://example.com/nope'));
});

test('tree is chronological, keeps orphans, and a comment link focuses its subtree', () => {
  const tree = buildTree(comments);
  assert.deepEqual(tree.map(n => n.id), ['c1', 'c2', 'c9']);
  assert.deepEqual(tree[0].replies.map(n => n.id), ['c3']);
  assert.deepEqual(buildTree(comments, 'c1').map(n => n.id), ['c1']);
});

test('http: 5xx, block pages and network errors mean "source down"; 429 backs off and retries', async () => {
  const reply = (status, text) => async () => ({ status, text: async () => text });
  const http = f => createHttp({ fetch: f, wait: async () => {} });
  await assert.rejects(http(reply(502, 'error code: 502'))('https://a.test/x'), SourceDown);
  await assert.rejects(http(reply(200, '<!DOCTYPE html>blocked'))('https://a.test/x'), SourceDown);
  await assert.rejects(http(async () => { throw new Error('ENOTFOUND'); })('https://a.test/x'), SourceDown);
  const seq = [reply(429, ''), reply(200, '{"data":[1]}')];
  assert.deepEqual(await http(() => seq.shift()())('https://a.test/x'), { data: [1] });
});

const fakeHttp = async () => ({});
const adapter = (name, thread) => ({ name, minIntervalMs: 0, thread });
const down = adapter('down', async () => { throw new SourceDown('down.test: HTTP 502'); });

test('falls back past a dead source; cache lifetime is a quarter of thread age (5 min to 24 h)', async () => {
  const [cache] = tmpCache();
  let calls = 0;
  const good = adapter('good', async () => { calls++; return { post, comments }; });
  const read = (t, extra) => readThread('https://redd.it/abc123', { cache, http: fakeHttp, adapters: [down, good], now: () => t, ...extra });

  const live = await read(post.created_utc + 1000); // young thread: 1000 s / 4 -> clamped up to 300 s
  assert.equal(live.source, 'good');
  assert.equal(live.tree.length, 3);
  assert.equal((await read(post.created_utc + 1200)).source, 'good, cached');
  assert.equal(calls, 1);
  await read(post.created_utc + 1301); // 301 s after fetch: expired
  assert.equal(calls, 2);
  await read(post.created_utc + 1301, { fresh: true });
  assert.equal(calls, 3);

  const [oldCache] = tmpCache();
  const oldRead = t => readThread('abc123', { cache: oldCache, http: fakeHttp, adapters: [good], now: () => t });
  await oldRead(post.created_utc + 10 * 86_400); // 10-day-old thread: capped at 24 h
  await oldRead(post.created_utc + 10 * 86_400 + 23 * 3600);
  assert.equal(calls, 4);
});

test('the cache keeps the newest entries under its size cap and drops anything older than 7 days', () => {
  const entry = t => ({ source: 's', fetchedAt: t, post, comments, collapsed: 0 });
  const [probe, dir] = tmpCache();
  probe.put('a', entry(1000));
  const size = statSync(join(dir, 'a.json.gz')).size;

  const cache = openCache(dir, { maxBytes: size * 2.5 });
  cache.put('b', entry(2000));
  cache.put('c', entry(3000));
  assert.equal(cache.get('a'), null); // oldest, over the cap
  assert.ok(cache.get('b') && cache.get('c'));

  cache.put('d', entry(3000 + 8 * 86_400));
  assert.equal(cache.get('b'), null); // expired
  assert.ok(cache.get('d'));
});

test('a source with the post but none of its comments loses to one that has them; partials are not cached', async () => {
  let emptyCalls = 0;
  const empty = adapter('empty', async () => { emptyCalls++; return { post, comments: [] }; });
  const full = adapter('full', async () => ({ post, comments }));
  const [cache] = tmpCache();
  const run = adapters => readThread('abc123', { cache, http: fakeHttp, adapters, now: () => post.created_utc + 100 });
  assert.equal((await run([empty, full])).source, 'full');

  const [cache2] = tmpCache();
  const runEmpty = () => readThread('abc123', { cache: cache2, http: fakeHttp, adapters: [empty], now: () => post.created_utc + 100 });
  assert.equal((await runEmpty()).partial, true);
  await runEmpty();
  assert.equal(emptyCalls, 3);
});

test('NotFound only when every source answered; any source down means SourceDown', async () => {
  const none = adapter('none', async () => null);
  const run = adapters => readThread('abc123', { cache: tmpCache()[0], http: fakeHttp, adapters });
  await assert.rejects(run([none]), NotFound);
  await assert.rejects(run([down, none]), SourceDown);
  await assert.rejects(run([down]), SourceDown);
});
