// Reddit knowledge shared by every Reddit source: link forms, archive row -> item, comment tree.
import { UserError } from './errors.js';

const ID = '[a-z0-9]{4,12}';
const BARE = new RegExp(`^(?:t3_)?(${ID})$`, 'i');
const SHORT = new RegExp(`redd\\.it/(${ID})`, 'i');
const FULL = new RegExp(`reddit\\.com/(?:(?:r|u|user)/[^/]+/)?comments/(${ID})(?:/[^/?#]*/(${ID}))?`, 'i');
const SHARE = /reddit\.com(\/(?:r|u|user)\/[^/]+\/s\/[A-Za-z0-9]+)/i;

// -> { threadId, commentId? } or { shortPath } for /s/ share links (resolved by an archive later)
export function parseRedditRef(ref) {
  const s = String(ref).trim();
  const m = s.match(BARE) ?? s.match(SHORT) ?? s.match(FULL);
  if (m) return { threadId: m[1].toLowerCase(), commentId: m[2]?.toLowerCase() };
  const share = s.match(SHARE);
  if (share) return { shortPath: share[1] };
  throw new UserError(`not a Reddit thread link: ${s}`);
}

const bare = id => String(id ?? '').replace(/^t\d_/, '');
const statusOf = text => (text === '[deleted]' ? 'deleted' : text === '[removed]' ? 'removed' : 'live');

// Archive row -> the output contract's item (schema 1). Ids are Reddit fullnames: t3_ post, t1_ comment.
export function toItem(row) {
  const isPost = row.title !== undefined;
  const text = (isPost ? row.selftext : row.body) ?? '';
  const item = {
    platform: 'reddit',
    id: (isPost ? 't3_' : 't1_') + row.id,
    kind: isPost ? 'post' : 'comment',
    url: 'https://www.reddit.com' + (row.permalink ?? `/comments/${isPost ? row.id : bare(row.link_id)}/`),
    container: row.subreddit ?? null,
    author: row.author ?? null,
    created_at: row.created_utc != null ? Number(row.created_utc) : null,
    edited_at: typeof row.edited === 'number' ? Math.floor(row.edited) : null, // Reddit sends false or a timestamp
    text,
    score: row.score ?? null,
    status: statusOf(text),
  };
  if (isPost) Object.assign(item, { title: row.title, comment_count: row.num_comments ?? null });
  else item.parent_id = row.parent_id ?? null;
  return item;
}

export const countTree = list => list.reduce((n, c) => n + 1 + countTree(c.replies), 0);

// Flat comment items -> nested tree. Archives capture scores near posting time (often all 1),
// so chronological is the only honest order.
export function buildTree(items, focusId) {
  const byId = new Map(items.map(i => [i.id, { ...i, replies: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    // ponytail: a reply whose parent the archive lacks is shown top-level rather than dropped
    (byId.get(node.parent_id)?.replies ?? roots).push(node);
  }
  const sort = list => {
    list.sort((a, b) => a.created_at - b.created_at);
    for (const n of list) sort(n.replies);
  };
  sort(roots);
  const focus = focusId && byId.get(focusId);
  return focus ? [focus] : roots;
}

// Keep the first `max` comments in reading order (depth-first), so a cut thread still reads top-down.
export function limitTree(tree, max) {
  let left = max;
  const cut = list => {
    const out = [];
    for (const n of list) {
      if (left-- <= 0) break;
      out.push({ ...n, replies: cut(n.replies) });
    }
    return out;
  };
  return cut(tree);
}
