#!/usr/bin/env node
import { parseArgs } from 'node:util';

// ponytail: node:sqlite still prints an ExperimentalWarning; drop Node's default printer before
// loading it (dynamic imports below, so this runs first)
process.removeAllListeners('warning');
const { readThread, openStore, createHttp, defaultDbPath, UserError, SourceDown } =
  await import('./engine/index.js');
const { renderThread } = await import('./render.js');
const pkg = (await import('../package.json', { with: { type: 'json' } })).default;

const USAGE = `tarantula ${pkg.version}

Usage:
  tarantula read <reddit link | share link | post id> [--fresh] [--json]

Options:
  --fresh   ignore the local cache and refetch
  --json    print JSON instead of markdown

Environment:
  TARANTULA_DB   database file (now: ${defaultDbPath()})`;

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

const store = openStore(defaultDbPath());
try {
  const thread = await readThread(ref, {
    store,
    fresh: opt.fresh,
    // ponytail: add the repo URL to the User-Agent once it exists (Phase 3)
    http: createHttp({ userAgent: `tarantula/${pkg.version} (local-first archive reader)` }),
  });
  console.log(opt.json ? JSON.stringify(thread, null, 2) : renderThread(thread));
} catch (e) {
  if (!(e instanceof UserError || e instanceof SourceDown)) throw e;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  store.close();
}
