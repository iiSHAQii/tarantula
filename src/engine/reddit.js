// Reddit knowledge shared by every Reddit source: link forms and tree building.
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

// Flat comment rows -> nested tree. Archives capture scores near posting time (often all 1),
// so chronological is the only honest order.
export function buildTree(comments, focusId) {
  const byId = new Map(comments.map(c => [c.id, { ...c, replies: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    // ponytail: a reply whose parent the archive lacks is shown top-level rather than dropped
    (byId.get(bare(node.parent_id))?.replies ?? roots).push(node);
  }
  const sort = list => {
    list.sort((a, b) => a.created_utc - b.created_utc);
    for (const n of list) sort(n.replies);
  };
  sort(roots);
  const focus = focusId && byId.get(focusId);
  return focus ? [focus] : roots;
}
