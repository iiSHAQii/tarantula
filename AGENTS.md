# AGENTS.md

Instructions for AI coding agents (and humans) working in this repo.

- **Read `ARCHITECTURE.md` first.** Update it in the same change whenever you add, move or rename
  a file, change the data flow, or change an invariant.
- **Commands:** `npm test` (Node's built-in runner, no network). Try it for real with
  `node src/cli.js read <reddit link>`. `TARANTULA_CACHE=<dir>` points at a throwaway cache.
- **Node >= 20, ESM, zero runtime dependencies.** Adding one needs a stated reason. Don't use a
  Node feature newer than 20 without raising `engines` and `MIN_NODE` in `cli.js` together.
- **Test fixtures are synthetic.** Never commit real Reddit content or usernames.
- **Keep the polite defaults** (per-host pacing, backoff, identifying User-Agent). The archives
  are volunteer-run; don't hammer them from tests or scripts.
- **No logged-in-browser scraping** in this repo.
- **Smallest change that works.** Mark deliberate shortcuts with a `ponytail:` comment that names
  the ceiling and the upgrade path.
