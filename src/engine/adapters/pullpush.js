// PullPush — https://pullpush.io (volunteer-run Pushshift successor: be polite)
const API = 'https://api.pullpush.io/reddit/search';

export default {
  name: 'pullpush',
  minIntervalMs: 4000, // reported ceiling ~1000 req/hr

  async thread(id, get) {
    const [post] = (await get(`${API}/submission/?ids=${id}`)).data ?? [];
    if (!post) return null;
    const seen = new Map();
    let after;
    // ponytail: 50 pages = 5,000 comments cap; raise if huge threads matter
    for (let page = 0; page < 50; page++) {
      const url = `${API}/comment/?link_id=${id}&size=100&sort=asc&sort_type=created_utc` + (after ? `&after=${after}` : '');
      const rows = (await get(url)).data ?? [];
      const before = seen.size;
      for (const r of rows) seen.set(r.id, r);
      if (rows.length < 100 || seen.size === before) break;
      after = rows.at(-1).created_utc - 1; // overlap 1s so same-second comments aren't skipped
    }
    return { post, comments: [...seen.values()] };
  },

  async search({ subreddit, query, after }, get) {
    const url = `${API}/submission/?subreddit=${subreddit}&q=${encodeURIComponent(query)}&size=100&sort=desc&sort_type=created_utc`
      + (after ? `&after=${after}` : '');
    return (await get(url)).data ?? [];
  },
};
