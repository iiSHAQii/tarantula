# tarantula

Read Reddit threads without Reddit's API or a browser. Tarantula asks public Reddit archives
(Arctic Shift, then PullPush if that fails) and prints the thread as markdown.

```
npx tarantula-cli read https://www.reddit.com/r/<sub>/comments/<id>/...
npx tarantula-cli read https://redd.it/<id> --json
npx tarantula-cli read <link> --fresh      # skip the local cache
```

Needs Node 20 or newer.

**These are archived copies.** Archives capture posts and comments shortly after they're
written, so scores are usually stale, and a copy can include text its author later deleted on
Reddit. Treat what you read accordingly.

**It's a live reader, not an archive.** Recent reads are cached briefly so repeat reads don't
hit the volunteer-run archives again: a young thread for a few minutes, an old one for up to a
day. Entries are deleted after 7 days and the cache folder is capped at 100 MB (`tarantula --help`
shows where it is; set `TARANTULA_CACHE` to move it).

Early and unstable (0.x). Not affiliated with Reddit. Data comes from
[Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) and [PullPush](https://pullpush.io),
both volunteer-run; tarantula paces its requests to be a good citizen.

How it works: [ARCHITECTURE.md](ARCHITECTURE.md).
