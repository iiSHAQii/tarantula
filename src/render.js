// Schema-1 results -> markdown for terminals and LLMs.
import { countTree } from './engine/reddit.js';

const when = s => (s ? new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown');
const flag = i => (i.status === 'live' ? '' : ` · [${i.status}]`);

export function renderThread({ thread: t, comments, provenance: p, completeness: c, focus }) {
  const out = [
    `# ${t.title}`,
    `r/${t.container} · u/${t.author} · posted ${when(t.created_at)}${flag(t)}`,
    t.url,
    `archived copy via ${p.source}${p.cached ? ' (cached)' : ''}, captured ${when(p.fetched_at)}; scores are as captured, often stale`,
    '',
  ];
  if (t.text.trim()) out.push(t.text.trim(), '');

  const n = countTree(comments);
  out.push('---', focus ? `Comment ${focus} and its replies (${n})` : `${n} comments`, '');
  if (c.truncated) out.push(`> Truncated: showing the first ${n} of ${c.received} comments in this thread.`, '');
  if (c.partial) out.push(`> Warning: the post reports ${c.expected} comments but no source returned any yet.`, '');
  if (c.collapsed) out.push(`> ${c.collapsed} comments were collapsed by the archive and are not shown.`, '');

  const walk = (list, pad) => {
    for (const i of list) {
      out.push(`${pad}- **u/${i.author}** · ${i.score} pts · ${when(i.created_at)}${flag(i)}`);
      for (const line of i.text.trim().split('\n')) out.push(`${pad}  ${line}`);
      walk(i.replies, pad + '  ');
    }
  };
  walk(comments, '');
  return out.join('\n');
}

export function renderSearch({ subreddit, query, results, provenance: p }) {
  const out = [`# r/${subreddit}: "${query}"`, `${results.length} posts via ${p.source}, newest first`];
  if (p.method === 'scan') out.push(`Matched every word in the ${p.scanned} newest posts, back to ${when(p.back_to)} (archive keyword search was unavailable).`);
  // Archives record comment counts minutes after posting, so they read ~0: showing them misleads.
  out.push('Comment counts are not shown (archives capture them too early); open a thread to see its comments.', '');
  if (!results.length) out.push('No matches. Try fewer or other words, or another subreddit.');
  for (const r of results) {
    out.push(`- **${r.title}** · ${when(r.created_at)} · u/${r.author}${flag(r)}`, `  ${r.url}`);
    const snippet = r.text.replace(/\s+/g, ' ').trim();
    if (snippet) out.push(`  > ${snippet.length > 200 ? snippet.slice(0, 200) + '…' : snippet}`);
  }
  return out.join('\n');
}
