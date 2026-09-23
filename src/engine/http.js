// Polite HTTP for archive APIs: per-host pacing, backoff on 429, and one rule for
// "this source is down" so callers can fall back instead of trusting a bad answer.
import { SourceDown } from './errors.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRIES = 3;

export function createHttp({ fetch = globalThis.fetch, userAgent = 'tarantula', wait = sleep } = {}) {
  const lastHit = new Map(); // host -> ms of last request

  return async function get(url, { minIntervalMs = 1000 } = {}) {
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      const gap = (lastHit.get(host) ?? -Infinity) + minIntervalMs - Date.now();
      if (gap > 0) await wait(gap);
      lastHit.set(host, Date.now());

      let res, text;
      try {
        res = await fetch(url, {
          headers: { 'user-agent': userAgent, accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
        });
        text = await res.text();
      } catch (e) {
        throw new SourceDown(`${host}: ${e.message}`);
      }
      if (res.status === 429 && attempt < RETRIES) { await wait(5000 * 2 ** attempt); continue; }
      if (res.status !== 200) throw new SourceDown(`${host}: HTTP ${res.status}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new SourceDown(`${host}: 200 but not JSON (block page or outage)`);
      }
    }
  };
}
