// Arctic Shift — https://github.com/ArthurHeitmann/arctic_shift (volunteer-run: be polite)
const API = 'https://arctic-shift.photon-reddit.com/api';

// Reddit-style Listing tree -> flat rows; counts "more" stubs the archive collapsed.
function flatten(children, rows, stats) {
  for (const child of children ?? []) {
    if (child.kind === 'more') {
      stats.collapsed += (child.data?.children ?? child.children ?? []).length;
      continue;
    }
    const { replies, ...row } = child.data;
    rows.push(row);
    flatten(replies?.data?.children, rows, stats);
  }
}

export default {
  name: 'arcticshift',
  minIntervalMs: 1000,

  async thread(id, get) {
    const [post] = (await get(`${API}/posts/ids?ids=${id}`)).data ?? [];
    if (!post) return null;
    const rows = [], stats = { collapsed: 0 };
    flatten((await get(`${API}/comments/tree?link_id=t3_${id}&limit=25000`)).data, rows, stats);
    return { post, comments: rows, collapsed: stats.collapsed };
  },

  // `query` matches title and body. Rationed: most calls get 422 "Timeout. Maybe slow down a bit"
  // within 0.5 s, even on small subreddits; the engine then scans `list` instead.
  async search({ subreddit, query, after }, get) {
    const url = `${API}/posts/search?subreddit=${subreddit}&query=${encodeURIComponent(query)}&limit=100&sort=desc`
      + (after ? `&after=${after}` : '');
    return (await get(url)).data ?? [];
  },

  // Plain newest-first listing, no keywords: not rationed like `query` search (stress test 2026-09-24).
  async list({ subreddit, after, before }, get) {
    const url = `${API}/posts/search?subreddit=${subreddit}&limit=100&sort=desc`
      + (after ? `&after=${after}` : '') + (before ? `&before=${before}` : '');
    return (await get(url)).data ?? [];
  },

  // /r/x/s/<code> -> full path; only works for share links the archive has seen in some comment
  async resolveShortLink(path, get) {
    const [hit] = (await get(`${API}/short_links?paths=${path}`)).data ?? [];
    return hit?.resolved_path ?? null;
  },
};
