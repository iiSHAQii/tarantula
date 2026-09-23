# tarantula

Read Reddit threads without Reddit's API or a browser. Tarantula asks public Reddit archives
(Arctic Shift, then PullPush if that fails), keeps a local copy in SQLite, and prints the thread
as markdown.

```
node src/cli.js read https://www.reddit.com/r/<sub>/comments/<id>/...
node src/cli.js read https://redd.it/<id> --json
node src/cli.js read <link> --fresh      # skip the local cache
```

Early and unstable (0.x). Not affiliated with Reddit. Data comes from
[Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) and [PullPush](https://pullpush.io),
both volunteer-run; tarantula paces its requests to be a good citizen.

How it works: [ARCHITECTURE.md](ARCHITECTURE.md).
