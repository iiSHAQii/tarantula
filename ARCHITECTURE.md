# Architecture

Tarantula is a local-first collection engine: you ask for something (today: one Reddit thread),
it gets it from whichever public source can answer, stores the raw response plus a cleaned
record in one SQLite file, and hands back a readable result.

**Keep this file current.** Any change that adds, moves or renames a file, changes the data flow,
or changes an invariant updates this file in the same commit.

Status: **Phase 1 — `tarantula read`** (on-demand thread reader with local cache).

## Data flow

```
 reddit link / share link / post id
            │
            ▼
   parseRedditRef ──(share link)──► adapter.resolveShortLink ──► full link
            │
            ▼
   cache? store.getThread ── fresh enough ──────────────────────────────┐
            │ no                                                        │
            ▼                                                           │
   firstHealthy: try adapters in order                                  │
     ├─ arcticshift.thread ─┐                                           │
     └─ pullpush.thread ────┤  each call goes through http.get          │
                            │  (pacing, 429 backoff, "down" detection)  │
            ▼               │                                           │
   store.saveThread: raw responses + records, one transaction          │
            │                                                           │
            ▼                                                           ▼
   buildTree ──► renderThread (markdown) or --json ──────────────► stdout
```

## Code map

| File | Owns | Must not |
|---|---|---|
| `src/cli.js` | argument parsing, env config, user-facing errors, exit codes | contain engine logic |
| `src/render.js` | thread → markdown | fetch or store anything |
| `src/engine/index.js` | `readThread` orchestration, `firstHealthy` source chain, default DB path | know any source's URLs |
| `src/engine/http.js` | per-host pacing, 429 backoff, turning 5xx / non-JSON / network errors into `SourceDown` | know about adapters or storage |
| `src/engine/reddit.js` | Reddit link forms, comment tree, row → record | make network calls |
| `src/engine/store.js` | SQLite schema, transactional save, cache read | interpret source rows beyond the record fields |
| `src/engine/adapters/*.js` | one source each: its URLs, response shape → raw rows | touch storage; they only get a `get(url)` |
| `src/engine/errors.js` | `UserError`, `NotFound`, `SourceDown` | — |
| `test/engine.test.js` | the runnable checks (`npm test`), synthetic fixtures, no network | contain real Reddit content |

## Adapter contract (unstable in 0.x)

```js
export default {
  name, minIntervalMs,
  thread(id, get)           // -> { post, comments: flat rows, collapsed? } | null when the source lacks it
  resolveShortLink(path, get) // optional -> '/r/.../comments/...' | null
}
```
`get(url)` returns parsed JSON; the engine logs the raw response for storage. Adapters throw
nothing of their own: an unreachable or broken source surfaces as `SourceDown` from `http.js`.

## Invariants

- **`fetches` is the truth.** Every response is stored zstd-compressed, append-only. `records` is
  a projection and can be rebuilt from it.
- **Raw responses and their records commit in one transaction**, or neither does.
- **Record ids are platform-global** (Reddit fullnames `t3_…` / `t1_…`), so the same comment from
  two archives is one record.
- **Time fields are facts, in unix seconds:** `created_at` (author wrote it; NULL if unknown, never
  guessed), `fetched_at` (first capture, never updated), `last_seen_at` (last fetch that returned
  it), `gone_at` (source reported `[deleted]`/`[removed]`; sticky). Deciding freshness is the
  consumer's job.
- **"Down" means fall back, never "empty".** 5xx, non-JSON bodies (block pages), timeouts and
  exhausted 429s are `SourceDown`. A post that reports comments while the source returns none is
  *incomplete*, and the next source is tried; if nothing better exists it is returned with
  `partial: true`.
- **Polite by default:** per-host pacing (Arctic Shift 1 s, PullPush 4 s), exponential backoff on
  429, an identifying User-Agent. Both archives are volunteer-run.
- **Comments are shown chronologically.** Archives capture scores near posting time, so score
  order would be noise.

## Known limitations (observed, not yet handled)

- **Archive coverage has holes.** 2026-09-20: PullPush had all 54 comments of a thread but not
  the post itself, so it reports "not found" and the chain moves on.
- **Archives may keep text a user later deleted on Reddit.** We can't detect that; we only mark
  what the archive itself reports as `[deleted]`/`[removed]`.
- **Share links resolve only if the archive has seen them** in some comment; otherwise a clear
  error asks for the full URL.
- `more` stubs are skipped and counted (`collapsed`); with `limit=25000` they should be rare.
- The cache treats any full read younger than 6 h as fresh, and a cached copy doesn't remember
  that it was `partial`. Phase 4 needs a real "thread complete" marker.
- `payload` duplicates the full source row (~2.4 KB/record) on top of the raw fetch; trim before
  bulk harvesting.
- `node:sqlite` is experimental in Node 24; `cli.js` silences its warning.
- **No schema migrations yet.** A schema change means deleting the local database; fine while it
  is only a cache, must exist before Phase 4 stores data worth keeping.

## What's next

Phase 2: `tarantula mcp` with `read_thread` / `search` tools. See the plan in the parent project.
