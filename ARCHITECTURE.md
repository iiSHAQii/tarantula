# Architecture

Tarantula is a live reader: you ask for something (today: one Reddit thread), it gets it from
whichever public source can answer, keeps a short-lived copy in a small capped cache, and hands
back a readable result. It is deliberately **not an archive**.

**Keep this file current.** Any change that adds, moves or renames a file, changes the data flow,
or changes an invariant updates this file in the same commit.

Status: **Phase 1 — `tarantula read`** (on-demand thread reader).

## Data flow

```
 reddit link / share link / post id
            │
            ▼
   parseRedditRef ──(share link)──► adapter.resolveShortLink ──► full link
            │
            ▼
   cache.get ── fresh enough (¼ of thread age, 5 min to 24 h) ──────────┐
            │ no, or --fresh                                            │
            ▼                                                           │
   firstHealthy: try adapters in order                                  │
     ├─ arcticshift.thread ─┐  each call goes through http.get          │
     └─ pullpush.thread ────┘  (pacing, 429 backoff, "down" detection)  │
            │                                                           │
            ▼                                                           │
   cache.put (skipped for partial results; prunes expired + over cap)   │
            │                                                           ▼
   buildTree ──► renderThread (markdown) or --json ─────────────────► stdout
```

## Code map

| File | Owns | Must not |
|---|---|---|
| `src/cli.js` | Node version check, argument parsing, user-facing errors, exit codes | contain engine logic |
| `src/render.js` | thread → markdown | fetch or cache anything |
| `src/engine/index.js` | `readThread` orchestration, `firstHealthy` source chain, the freshness rule, default cache folder | know any source's URLs |
| `src/engine/http.js` | per-host pacing, 429 backoff, turning 5xx / non-JSON / network errors into `SourceDown` | know about adapters or the cache |
| `src/engine/cache.js` | one gzipped JSON file per thread: versioned entries, atomic writes, 7-day expiry, 100 MB cap | decide freshness (that's `readThread`'s rule) |
| `src/engine/reddit.js` | Reddit link forms, comment tree | make network calls |
| `src/engine/adapters/*.js` | one source each: its URLs, response shape → raw rows | touch the cache; they only get a `get(url)` |
| `src/engine/errors.js` | `UserError`, `NotFound`, `SourceDown` | — |
| `test/engine.test.js` | the runnable checks (`npm test`), synthetic fixtures, no network | contain real Reddit content |

## Adapter contract (unstable in 0.x)

```js
export default {
  name, minIntervalMs,
  thread(id, get)             // -> { post, comments: flat rows, collapsed? } | null when the source lacks it
  resolveShortLink(path, get) // optional -> '/r/.../comments/...' | null
}
```
`get(url)` returns parsed JSON. Adapters throw nothing of their own: an unreachable or broken
source surfaces as `SourceDown` from `http.js`.

## Invariants

- **Live, not an archive.** Cache entries are deleted after 7 days and the folder is capped at
  100 MB, oldest first. Each file's mtime is its fetch time, so pruning never reads files.
- **Freshness:** a cached thread is reused for a quarter of the thread's age when it was fetched,
  clamped to 5 min–24 h. Young threads are still filling in; old ones barely change. `--fresh`
  bypasses the cache.
- **Partial results are never cached**; they'd hide the complete copy for hours.
- **A cache problem never fails a read.** Unwritable → just don't cache; unreadable or written by
  another version → miss. Writes go to a temp file and are renamed into place.
- **Cache entries carry a version (`v`).** Changing the entry shape means bumping it; old files
  then read as misses. That is the whole migration story.
- **"Down" means fall back, never "empty".** 5xx, non-JSON bodies (block pages), timeouts and
  exhausted 429s are `SourceDown`. A post that reports comments while the source returns none is
  *incomplete*, and the next source is tried; if nothing better exists it is returned with
  `partial: true`. `NotFound` only when every source answered; if any was down the result is
  `SourceDown` ("try again"), because the missing source might have had it.
- **Polite by default:** per-host pacing (Arctic Shift 1 s, PullPush 4 s), exponential backoff on
  429, a User-Agent carrying the repo URL. Both archives are volunteer-run.
- **Comments are shown chronologically.** Archives capture scores near posting time, so score
  order would be noise.
- Timestamps are unix seconds throughout.

## Known limitations (observed, not yet handled)

- **Archive coverage has holes.** 2026-09-20: PullPush had all 54 comments of a thread but not
  the post itself, so it reports "not found" and the chain moves on.
- **Archives may keep text a user later deleted on Reddit.** We show whatever the archive has,
  including its own `[deleted]`/`[removed]` markers.
- **Share links resolve only if the archive has seen them** in some comment; otherwise a clear
  error asks for the full URL.
- `more` stubs are skipped and counted (`collapsed`); with `limit=25000` they should be rare.
- **`--json` returns raw archive rows**, so its shape is the archive's, not ours (see "Output
  contract" below).
- **Pacing is per process.** A CLI run and a future MCP server each keep their own limits.
- A process killed mid-write can leave a `*.tmp` file in the cache folder; nothing prunes it.

## What's next

**Before the first npm publish**
- [x] Versioned storage: cache entries carry `v` (the SQLite database and its migration problem
      are gone).
- [x] Runtime Node version check; floor lowered to 20 (tests pass on 20.20 and 24.11).
- [x] Repo URL in the User-Agent.
- [ ] Tell the Arctic Shift and PullPush maintainers the tool exists (a person, not code).
- [x] README: archived copies, deleted content, cache behaviour.

**Output contract — before Phase 2, because the MCP tool freezes it**
- [ ] Normalise the output instead of passing raw archive rows through: one `Item` shape
      (`platform, id, kind, url, author, created_at, title?, text, score?, parent_id?, replies`)
      plus `extra` for source-specific leftovers, and a `schema: 1` field on every JSON result.
- [ ] Deletion as a field (`status: live | deleted | removed`), not a magic string in `text`.
- [ ] Provenance and completeness on every thread: `source`, `fetched_at`, the archive's own
      `retrieved_on`, and `{ expected, received, collapsed, partial }`.
- [ ] Room for truncation: `truncated` + a cursor, so large threads and search results can be
      paged over MCP.

**Phase 2 (MCP)**
- [ ] Tool output marked as untrusted user-generated content (tool description + delimiters).
      Reddit text goes straight into an agent that can run commands: prompt-injection surface.
- [ ] `search` requires `subreddit`: Arctic Shift full-text only works with a subreddit/author/
      thread filter and not on very active subreddits (their API docs).

**Soon after**
- [ ] Remember a failed source for ~10 min instead of retrying it every read; interactive
      timeout 15–20 s instead of 60 s.
- [x] Cache age scales with thread age; partial results aren't cached.
- [ ] Opt-in `npm run smoke` hitting each adapter once for real (API shape drift is the most
      likely breakage).

**Optional — flagship direction, not scheduled**
- [ ] `ask "<question>"`: an LLM picks subreddits → search → read the top threads → complaints
      and fixes per thread, each with a comment link → merged and ranked across threads. Inside
      Claude Code the MCP tools cover this with no key; `ask` is for standalone use.
- [ ] Localhost GUI (Resume Matcher style) that takes the user's own LLM key (Groq, Gemini, any
      OpenAI-compatible endpoint). Key from env or local config, never cached or logged.
- [ ] More Reddit sources: an official-API adapter using the user's own approved credentials.
      A logged-in-browser source stays out of this repo (account-ban and legal risk); if ever
      built, it's a separate, local, opt-in package.

Then Phase 2: `tarantula mcp` with `read_thread` / `search` tools (plan in the parent project).
