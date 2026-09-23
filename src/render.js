// Thread -> markdown for terminals and LLMs.
const when = s => (s ? new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown');
const count = list => list.reduce((n, c) => n + 1 + count(c.replies), 0);

export function renderThread({ post, tree, source, fetchedAt, partial, collapsed, focus }) {
  const out = [
    `# ${post.title}`,
    `r/${post.subreddit} · u/${post.author} · posted ${when(post.created_utc)}`,
    `https://www.reddit.com${post.permalink ?? `/comments/${post.id}/`}`,
    `archived copy via ${source}, captured ${when(fetchedAt)} (scores are as captured, often stale)`,
    '',
  ];
  if (post.selftext?.trim()) out.push(post.selftext.trim(), '');

  const n = count(tree);
  out.push('---', focus ? `Comment ${focus} and its replies (${n})` : `${n} comments`, '');
  if (partial) out.push(`> Warning: the post reports ${post.num_comments} comments but no source returned any yet.`, '');
  if (collapsed) out.push(`> ${collapsed} comments were collapsed by the archive and are not shown.`, '');

  const walk = (list, pad) => {
    for (const c of list) {
      out.push(`${pad}- **u/${c.author}** · ${c.score} pts · ${when(c.created_utc)}`);
      for (const line of String(c.body ?? '').trim().split('\n')) out.push(`${pad}  ${line}`);
      walk(c.replies, pad + '  ');
    }
  };
  walk(tree, '');
  return out.join('\n');
}
