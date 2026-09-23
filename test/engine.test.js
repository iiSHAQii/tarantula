import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRedditRef, buildTree, toRecord } from '../src/engine/reddit.js';
import { createHttp } from '../src/engine/http.js';
import { openStore } from '../src/engine/store.js';
import { readThread } from '../src/engine/index.js';
import { SourceDown, NotFound } from '../src/engine/errors.js';

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
  assert.equal(toRecord(c('d1', 't3_abc123', 1, '[removed]'), 0).gone, true);
});

test('http: 5xx, block pages and network errors mean "source down"; 429 backs off and retries', async () => {
  const reply = (status, text) => async () => ({ status, text: async () => text });
  const http = f => createHttp({ fetch: f, wait: async () => {} });
  await assert.rejects(http(reply(502, 'error code: 502'))('https://a.test/x'), SourceDown);
  await assert.rejects(http(reply(200, '<!DOCTYPE html>blocked'))('https://a.test/x'), SourceDown);
  await assert.rejects(http(async () => { throw new Error('ENOTFOUND'); })('https://a.test/x'), SourceDown);
  const seq = [reply(429, ''), reply(200, '{"data":[1]}')];
  assert.deepEqual((await http(() => seq.shift()())('https://a.test/x')).json, { data: [1] });
});

const fakeHttp = async url => ({ url, status: 200, text: '{}', json: {} });
const adapter = (name, thread) => ({ name, minIntervalMs: 0, thread });
const down = adapter('down', async () => { throw new SourceDown('down.test: HTTP 502'); });

test('falls back past a dead source, stores raw + records, then serves from cache', async () => {
  const store = openStore(':memory:');
  let calls = 0;
  const good = adapter('good', async (id, get) => { calls++; await get(`https://good.test/${id}`); return { post, comments }; });
  const opts = { store, http: fakeHttp, adapters: [down, good], now: () => 1789001000 };

  const live = await readThread('https://redd.it/abc123', opts);
  assert.equal(live.source, 'good');
  assert.equal(live.tree.length, 3);

  assert.equal((await readThread('https://redd.it/abc123', opts)).source, 'cache');
  assert.equal(calls, 1);

  await readThread('abc123', { ...opts, fresh: true, now: () => 1789002000 });
  assert.equal(calls, 2);
  const row = store.db.prepare(`SELECT fetched_at, last_seen_at FROM records WHERE id = 't3_abc123'`).get();
  assert.deepEqual({ ...row }, { fetched_at: 1789001000, last_seen_at: 1789002000 });
  assert.equal(store.db.prepare('SELECT count(*) n FROM fetches').get().n, 2);
});

test('a source with the post but none of its comments loses to one that has them', async () => {
  const empty = adapter('empty', async () => ({ post, comments: [] }));
  const full = adapter('full', async () => ({ post, comments }));
  const run = adapters => readThread('abc123', { store: openStore(':memory:'), http: fakeHttp, adapters });
  assert.equal((await run([empty, full])).source, 'full');
  assert.equal((await run([empty])).partial, true);
});

test('missing everywhere is NotFound; everything down is SourceDown', async () => {
  const none = adapter('none', async () => null);
  const run = adapters => readThread('abc123', { store: openStore(':memory:'), http: fakeHttp, adapters });
  await assert.rejects(run([down, none]), NotFound);
  await assert.rejects(run([down]), SourceDown);
});
