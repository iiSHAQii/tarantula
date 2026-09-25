# Architecture

Tarantula is a live reader: you ask for something (a Reddit thread, or posts in a subreddit), it
gets it from whichever public source can answer, keeps a short-lived copy of threads in a small
capped cache, and hands back a readable result: markdown, schema-1 JSON, or MCP tool output.
It is deliberately **not an archive**.

**Keep this file current.** Any change that adds, moves or renames a file, changes the data flow,
or changes an invariant updates this file in the same commit.

Status: **Phase 2 — `search` + MCP server + schema-1 output** (0.2.0).

## Data flow

```
 cli.js (read / search)          mcp.js (read_reddit_thread / search_reddit)
            └───────────────┬───────────────┘
                            ▼
 readThread(ref)                                  searchPosts({ subreddit, query, days })
   parseRedditRef ─(share link)─► resolveShortLink    validate subreddit + query
   cache.get ── fresh? ──────────────┐                firstHealthy over adapter.search
   firstHealthy over adapter.thread  │                (empty page → next source)
   toItem → cache.put (not partial)  │                toItem, most-discussed first
   buildTree ◄───────────────────────┘                        │
            │                                                 │
            └──────► schema-1 result ◄────────────────────────┘
                            │
      limitThread (--max / max_comments) → renderThread / renderSearch / JSON
                            │
              stdout (CLI)  or  untrusted-wrapped MCP tool result
```

Every archive call goes through `http.get`: per-host pacing, 429 backoff, 20 s timeout,
"down" detection, and a 10-minute skip for a host that just failed.

## Code map

| File | Owns | Must not |
|---|---|---|
| `src/cli.js` | Node version check, argument parsing, user-facing errors, exit codes | contain engine logic |
| `src/mcp.js` | stdio JSON-RPC, both handshake styles, tool definitions, the untrusted wrapper, output-size cap | write anything but protocol messages to stdout |
| `src/render.js` | schema-1 results → markdown | fetch or cache anything |
| `src/engine/index.js` | `readThread`, `limitThread`, `searchPosts`, `firstHealthy`, freshness rule, default cache folder | know any source's URLs |
| `src/engine/http.js` | pacing, backoff, timeout, `SourceDown` rules, remembering failed hosts, passing on archive error text | know about adapters or the cache |
| `src/engine/cache.js` | one gzipped JSON file per thread: versioned entries, atomic writes, 7-day expiry, 100 MB cap | decide freshness (that's `readThread`'s rule) |
| `src/engine/reddit.js` | Reddit link forms, archive row → item (`toItem`), comment tree, `limitTree` | make network calls |
| `src/engine/adapters/*.js` | one source each: its URLs, response shape → raw rows | touch the cache; they only get a `get(url)` |
| `src/engine/errors.js` | `UserError`, `NotFound`, `SourceDown` | — |
| `test/engine.test.js` | the runnable checks (`npm test`), synthetic fixtures, no network | contain real Reddit content |
| `assets/` | README and portfolio artwork; `node assets/generate.mjs` rebuilds the three SVGs, the GIFs are screen recordings | ship in the npm package (not in `files`) |

## Output contract (schema 1)

What `--json` prints and what the engine returns. Consumers depend on this shape: change it only
with a new `schema` number.

```json
{
  "schema": 1,
  "thread":   { "platform": "reddit", "id": "t3_…", "kind": "post", "url": "…", "container": "…",
                "author": "…", "created_at": 0, "edited_at": null, "text": "…", "score": 0,
                "status": "live | deleted | removed", "title": "…", "comment_count": 0 },
  "comments": [ { "…same item fields…": "", "kind": "comment", "parent_id": "t3_… | t1_…", "replies": [] } ],
  "provenance":   { "source": "arcticshift", "cached": false, "fetched_at": 0, "retrieved_at": 0 },
  "completeness": { "expected": 0, "received": 0, "collapsed": 0, "partial": false, "shown": 0, "truncated": false },
  "focus": "t1_… | null"
}
```

Search: `{ schema, subreddit, query, results: [post items], provenance: { source, fetched_at } }`.

- `(platform, id)` is the unique key; `id` is whatever the platform uses (Reddit fullnames here).
- `expected` is the post's own comment count at capture; `received` is what the archive returned.
  They often differ (archives capture both at different moments).
- No `extra` bag of source fields and no paging cursor yet: add a named field, or a cursor, when a
  consumer needs one.

## Adapter contract (unstable in 0.x)

```js
export default {
  name, minIntervalMs,
  thread(id, get)                         // -> { post, comments: flat rows, collapsed? } | null when the source lacks it
  search({ subreddit, query, after }, get) // optional -> raw post rows (empty array when nothing matches)
  resolveShortLink(path, get)             // optional -> '/r/.../comments/...' | null
}
```
`get(url)` returns parsed JSON. Adapters throw nothing of their own: an unreachable or broken
source surfaces as `SourceDown` from `http.js`.

## Invariants

- **Live, not an archive.** Cache entries are deleted after 7 days and the folder is capped at
  100 MB, oldest first. Each file's mtime is its fetch time, so pruning never reads files.
- **Freshness:** a cached thread is reused for a quarter of the thread's age when it was fetched,
  clamped to 5 min–24 h. `--fresh` bypasses the cache. Search results are never cached.
- **Partial results are never cached**; they'd hide the complete copy for hours.
- **A cache problem never fails a read.** Unwritable → just don't cache; unreadable or written by
  another version → miss. Writes go to a temp file and are renamed into place.
- **Cache entries carry a version (`v`, now 2).** Changing the entry shape means bumping it; old
  files then read as misses. That is the whole migration story.
- **"Down" means fall back, never "empty".** 5xx, non-JSON bodies (block pages), timeouts and
  exhausted 429s are `SourceDown` and the host is skipped for 10 minutes. A 4xx is also
  `SourceDown` (fall back) but isn't remembered: it's about that request, not the host. A post that
  reports comments while the source returns none is *incomplete*; an empty search page is too.
  `NotFound` only when every source answered; if any was down the result is `SourceDown`.
- **Archive error text is passed on** (`HTTP 422: Timeout. Maybe slow down a bit`), never a bare code.
- **MCP output is untrusted data.** Tool descriptions, server instructions and a note before every
  result say so, and all Reddit text sits inside `<untrusted-reddit-content>`; any copy of that
  tag inside Reddit text is defused so it can't close the block early.
- **MCP stdout is protocol only.** Engine code never prints; `mcp.js` logs to stderr.
- **MCP output stays under Claude Code's limit** (25k tokens by default): thread output is capped
  at ~60k characters by halving `max_comments` until it fits.
- **Both MCP handshake styles.** Legacy `initialize` (2025-11-25 and earlier; what Claude Code
  2.1.281 sends, observed 2026-09-24) and modern per-request `_meta` + `server/discover`
  (2026-07-28). Unknown versions get `-32022` with the supported list.
- **Polite by default:** per-host pacing (Arctic Shift 1 s, PullPush 4 s), exponential backoff on
  429, a User-Agent carrying the repo URL. Both archives are volunteer-run.
- **Comments are shown chronologically.** Archives capture scores near posting time, so score
  order would be noise.
- Timestamps are unix seconds throughout.

## Known limitations (observed, not yet handled)

- **Archive search times out on busy subreddits.** 2026-09-24, r/smallbusiness: `query` over all
  time → `422 Timeout`; a 365-day window worked, a 30-day window and a title-only search timed
  out minutes later. Small subreddits work. The error suggests `days`; no automatic retry yet.
- **Archive coverage has holes.** 2026-09-20: PullPush had all 54 comments of a thread but not
  the post itself, so it reports "not found" and the chain moves on.
- **Archives may keep text a user later deleted on Reddit.** We show whatever the archive has;
  `status` reflects only the archive's own `[deleted]`/`[removed]` markers.
- **Share links resolve only if the archive has seen them** in some comment.
- `more` stubs are skipped and counted (`collapsed`); with `limit=25000` they should be rare.
- **Pacing and the failed-host memory are per process.** The CLI and a running MCP server each
  keep their own.
- A process killed mid-write can leave a `*.tmp` file in the cache folder; nothing prunes it.

## What's next

**Before the first npm publish** (done for 0.1.0)
- [x] Versioned storage, Node version check (floor 20), repo URL in the User-Agent, README notes.
- [ ] Tell the Arctic Shift and PullPush maintainers the tool exists (a person, not code).

**Output contract** (done in 0.2.0)
- [x] Normalised items + `schema: 1`; deletion as `status`; provenance and completeness;
      truncation via `max_comments` / `--max`. Cursor paging deferred until needed.

**Phase 2 (MCP)** (done in 0.2.0)
- [x] Output marked as untrusted user-generated content (descriptions + wrapper + escaping).
- [x] `search` requires `subreddit`.

**Soon after**
- [x] Remember a failed source for 10 min; interactive timeout 20 s.
- [x] Cache age scales with thread age; partial results aren't cached.
- [ ] Opt-in `npm run smoke` hitting each adapter once for real (API shape drift is the most
      likely breakage).
- [ ] Search on busy subreddits: retry once with a narrower window when the archive times out.

**Optional — flagship direction, not scheduled**
- [ ] `ask "<question>"`: an LLM picks subreddits → search → read the top threads → complaints
      and fixes per thread, each with a comment link → merged and ranked across threads. Inside
      Claude Code the MCP tools cover this with no key; `ask` is for standalone use.
- [ ] Localhost GUI (Resume Matcher style) that takes the user's own LLM key (Groq, Gemini, any
      OpenAI-compatible endpoint). Key from env or local config, never cached or logged.
- [ ] More Reddit sources: an official-API adapter using the user's own approved credentials.
      A logged-in-browser source stays out of this repo (account-ban and legal risk); if ever
      built, it's a separate, local, opt-in package.
