// One bounded, paced MusicBrainz transport for search and server-side judging.
// Keep the timeout alive through JSON parsing: a stalled response body counts too.
export class MusicBrainzUnavailable extends Error {
  constructor(code, status) {
    super('MusicBrainz is temporarily unavailable. Please retry.');
    this.name = 'MusicBrainzUnavailable'; this.code = code; this.status = status;
  }
}
export function createMusicBrainzClient({ fetcher = (...a) => fetch(...a), headers = {}, onRetry = () => {}, timeoutMs = 3500, budgetMs = 14000, intervalMs = 1100, attempts = 3 } = {}) {
  let last = 0, queue = Promise.resolve();
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, Math.max(0, ms));
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
  return async function request(path, { signal, validate = () => true, until = Infinity } = {}) {
    const deadline = Math.min(Date.now() + budgetMs, until);
    let failure = new MusicBrainzUnavailable('timeout');
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
      const slot = queue.catch(() => {}).then(async () => {
        await wait(Math.max(0, last + intervalMs - Date.now()), signal);
        if (Date.now() >= deadline) throw new MusicBrainzUnavailable('timeout');
        last = Date.now();
      });
      queue = slot;
      await slot;
      const ctl = new AbortController();
      const cancel = () => ctl.abort(signal.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => ctl.abort(), Math.min(timeoutMs, deadline - Date.now()));
      let retryAfter = 0;
      try {
        const r = await fetcher('https://musicbrainz.org/ws/2/' + path, { headers: { Accept: 'application/json', ...headers }, signal: ctl.signal });
        if (r.status === 404) return null;
        if (!r.ok) {
          const raw = r.headers.get('retry-after');
          retryAfter = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw || '') - Date.now()) || 0;
          // Release retryable response bodies before making another request.
          await r.body?.cancel().catch(() => {});
          if (![429, 500, 502, 503, 504].includes(r.status)) throw Object.assign(new Error('MusicBrainz request refused (' + r.status + ').'), { terminal: true, status: r.status });
          throw new MusicBrainzUnavailable('http', r.status);
        }
        const data = await r.json();
        if (!validate(data)) throw new MusicBrainzUnavailable('response');
        return data;
      } catch (e) {
        if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
        if (e.terminal) throw e;
        failure = e instanceof MusicBrainzUnavailable ? e : new MusicBrainzUnavailable(ctl.signal.aborted ? 'timeout' : e instanceof SyntaxError ? 'response' : 'network');
        onRetry({ code: failure.code, status: failure.status, attempt: attempt + 1 });
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      }
      const delay = Math.max(retryAfter, intervalMs * 2 ** attempt);
      if (attempt + 1 >= attempts || Date.now() + delay >= deadline) break;
      await wait(delay, signal);
    }
    throw failure;
  };
}
