#!/usr/bin/env node
// Checked before anything else loads (dynamic imports below), so old Node gets a message
// instead of a syntax error.
const MIN_NODE = 20; // keep in sync with package.json "engines"; tests pass on 20.20 and 24.11
if (+process.versions.node.split('.')[0] < MIN_NODE) {
  console.error(`tarantula needs Node ${MIN_NODE} or newer (you have ${process.version}).`);
  process.exit(1);
}

const { parseArgs } = await import('node:util');
const { readThread, openCache, createHttp, defaultCacheDir, UserError, SourceDown } =
  await import('./engine/index.js');
const { renderThread } = await import('./render.js');
const pkg = (await import('../package.json', { with: { type: 'json' } })).default;
const repoUrl = `https://github.com/${pkg.repository.replace(/^github:/, '')}`;

const USAGE = `tarantula ${pkg.version}

Usage:
  tarantula read <reddit link | share link | post id> [--fresh] [--json]

Options:
  --fresh   ignore the local cache and refetch
  --json    print JSON instead of markdown

Cache:
  ${defaultCacheDir()}
  Entries expire after 7 days; the folder is capped at 100 MB. Set TARANTULA_CACHE to move it.`;

const { values: opt, positionals: [cmd, ref] } = parseArgs({
  allowPositionals: true,
  options: {
    fresh: { type: 'boolean' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

if (opt.version) { console.log(pkg.version); process.exit(0); }
if (opt.help || !cmd) { console.log(USAGE); process.exit(0); }
if (cmd !== 'read' || !ref) { console.error(USAGE); process.exit(2); }

try {
  const thread = await readThread(ref, {
    cache: openCache(defaultCacheDir()),
    fresh: opt.fresh,
    http: createHttp({ userAgent: `tarantula/${pkg.version} (+${repoUrl})` }),
  });
  console.log(opt.json ? JSON.stringify(thread, null, 2) : renderThread(thread));
} catch (e) {
  if (!(e instanceof UserError || e instanceof SourceDown)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}
