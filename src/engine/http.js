// Polite HTTP for archive APIs: per-host pacing, backoff on 429, and one rule for
// "this source is down" so callers can fall back instead of trusting a bad answer.
import { SourceDown } from './errors.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Archives explain failures as {"error": "..."}; pass that on instead of a bare status code.
const errorText = body => {
  try {
    const { error } = JSON.parse(body);
    return typeof error === 'string' ? `: ${error.slice(0, 200)}` : '';
  } catch {
    return '';
  }
};
const RETRIES = 3;
const TIMEOUT_MS = 20_000;       // interactive use: fail over to the next source instead of hanging
const DOWN_FOR_MS = 10 * 60_000; // an outage rarely clears in seconds; don't make every call wait on it

export function createHttp({ fetch = globalThis.fetch, userAgent = 'tarantula', wait = sleep } = {}) {
  const lastHit = new Map();   // host -> ms of last request
  const downUntil = new Map(); // host -> ms until which we don't bother asking it

  return async function get(url, { minIntervalMs = 1000 } = {}) {
    const host = new URL(url).host;
    if ((downUntil.get(host) ?? 0) > Date.now()) throw new SourceDown(`${host}: skipped, it failed in the last 10 min`);
    const down = reason => {
      downUntil.set(host, Date.now() + DOWN_FOR_MS);
      return new SourceDown(`${host}: ${reason}`);
    };

    for (let attempt = 0; ; attempt++) {
      const gap = (lastHit.get(host) ?? -Infinity) + minIntervalMs - Date.now();
      if (gap > 0) await wait(gap);
      lastHit.set(host, Date.now());

      let res, text;
      try {
        res = await fetch(url, {
          headers: { 'user-agent': userAgent, accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        text = await res.text();
      } catch (e) {
        throw down(e.message);
      }
      if (res.status === 429 && attempt < RETRIES) { await wait(5000 * 2 ** attempt); continue; }
      const reason = `HTTP ${res.status}${errorText(text)}`;
      if (res.status === 429 || res.status >= 500) throw down(reason);
      // A 4xx is about this request (e.g. a search the archive timed out on), not the host being down.
      if (res.status !== 200) throw new SourceDown(`${host}: ${reason}`);
      try {
        return JSON.parse(text);
      } catch {
        throw down('200 but not JSON (block page or outage)');
      }
    }
  };
}
