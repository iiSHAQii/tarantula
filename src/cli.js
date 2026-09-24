#!/usr/bin/env node
// Checked before anything else loads (dynamic imports below), so old Node gets a message
// instead of a syntax error.
const MIN_NODE = 20; // keep in sync with package.json "engines"; tests pass on 20.20 and 24.11
if (+process.versions.node.split('.')[0] < MIN_NODE) {
  console.error(`tarantula needs Node ${MIN_NODE} or newer (you have ${process.version}).`);
  process.exit(1);
}

const { parseArgs } = await import('node:util');
const { readThread, limitThread, searchPosts, openCache, createHttp, defaultCacheDir, UserError, SourceDown } =
  await import('./engine/index.js');
const { renderThread, renderSearch } = await import('./render.js');
const pkg = (await import('../package.json', { with: { type: 'json' } })).default;
const repoUrl = `https://github.com/${pkg.repository.replace(/^github:/, '')}`;

const USAGE = `tarantula ${pkg.version}

Usage:
  tarantula read <reddit link | share link | post id> [--fresh] [--max <n>] [--json]
  tarantula search <subreddit> <query...> [--days <n>] [--limit <n>] [--json]
  tarantula mcp    serve read/search to Claude Code or any MCP client over stdio

Options:
  --fresh      ignore the local cache and refetch
  --max <n>    show at most n comments
  --days <n>   only posts from the last n days
  --limit <n>  number of search results, 1-100 (default 25)
  --json       print JSON (schema 1) instead of markdown

Cache:
  ${defaultCacheDir()}
  Entries expire after 7 days; the folder is capped at 100 MB. Set TARANTULA_CACHE to move it.`;

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    fresh: { type: 'boolean' },
    json: { type: 'boolean' },
    max: { type: 'string' },
    days: { type: 'string' },
    limit: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

if (opt.version) { console.log(pkg.version); process.exit(0); }
if (opt.help || !cmd) { console.log(USAGE); process.exit(0); }

const int = (name, v, max = Infinity) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    console.error(`--${name} must be a whole number from 1${max < Infinity ? ` to ${max}` : ' up'}`);
    process.exit(2);
  }
  return n;
};

const cache = openCache(defaultCacheDir());
const http = createHttp({ userAgent: `tarantula/${pkg.version} (+${repoUrl})` });
const print = (result, render) => console.log(opt.json ? JSON.stringify(result, null, 2) : render(result));

try {
  if (cmd === 'mcp') {
    (await import('./mcp.js')).serve({ cache, http, version: pkg.version });
  } else if (cmd === 'read' && args.length === 1) {
    const thread = await readThread(args[0], { cache, http, fresh: opt.fresh });
    print(limitThread(thread, int('max', opt.max) ?? Infinity), renderThread);
  } else if (cmd === 'search' && args.length >= 2) {
    const query = args.slice(1).join(' ');
    print(await searchPosts({ subreddit: args[0], query, days: int('days', opt.days), limit: int('limit', opt.limit, 100) }, { http }), renderSearch);
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (e) {
  if (!(e instanceof UserError || e instanceof SourceDown)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}
