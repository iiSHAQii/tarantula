# tarantula

Read Reddit without Reddit's API or a browser. Tarantula asks public Reddit archives (Arctic
Shift, then PullPush if that fails) and gives you threads and search results as markdown or
JSON, from the terminal or straight inside Claude Code.

```
npx tarantula-cli read https://www.reddit.com/r/<sub>/comments/<id>/...
npx tarantula-cli read https://redd.it/<id> --max 50        # first 50 comments
npx tarantula-cli search smallbusiness packaging --days 365  # posts in one subreddit
npx tarantula-cli read <link> --json                         # schema-1 JSON
```

Needs Node 20 or newer. `npm i -g tarantula-cli` gives you a plain `tarantula` command that
starts faster than `npx`.

## Use it from Claude Code (MCP)

```
claude mcp add --scope user tarantula -- npx -y tarantula-cli@latest mcp
```

Keep the `@latest`: without it, `npx` reuses whatever version it cached first and never picks
up updates.

Then just ask, e.g. *"search r/smallbusiness for posts about packaging costs this year and
summarise the top complaints"*. Claude gets two tools:

- `read_reddit_thread` — a thread or comment link, share link or post id → the post and its comments
- `search_reddit` — a subreddit and keywords → the most-discussed matching posts, with links

`--scope user` makes it available in every project; leave it off to add it to the current
project only. `claude mcp list` should show `tarantula … ✔ Connected`. Any other MCP client can
run the same command (`npx -y tarantula-cli@latest mcp`, stdio).

Everything the tools return is marked as untrusted user-generated text, so Claude treats it as
material to read, not instructions to follow.

## Things to know

**These are archived copies.** Archives capture posts and comments shortly after they're
written, so scores are usually stale, threads from the last few hours may be missing, and a copy
can include text its author later deleted on Reddit.

**Search needs a subreddit, and busy subreddits can time out.** That's a limit of the archives'
search. If it happens, retry or narrow it with `--days` (e.g. `--days 365`).

**It's a live reader, not an archive.** Recent reads are cached briefly so repeat reads don't
hit the volunteer-run archives again: a young thread for a few minutes, an old one for up to a
day. Entries are deleted after 7 days and the cache folder is capped at 100 MB (`tarantula --help`
shows where it is; set `TARANTULA_CACHE` to move it).

Early and unstable (0.x). Not affiliated with Reddit. Data comes from
[Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) and [PullPush](https://pullpush.io),
both volunteer-run; tarantula paces its requests to be a good citizen.

How it works, including the JSON format: [ARCHITECTURE.md](ARCHITECTURE.md).
