import { test as base, expect } from '@playwright/test';
export { expect };
export const album = id => ({ id: String(id), name: `Record ${id}`, album_type: 'album', release_date: '2025-01-01', artists: [{ id: '42', name: 'Test Artist' }], images: [{ url: '/assets/icons/icon-512.png', width: 512, height: 512 }], tracks: { items: Array.from({ length: 16 }, (_, i) => ({ id: `${id}${i}`, name: `Song ${id}-${i}`, artists: [{ id: '42', name: 'Test Artist' }], preview_url: '/test-preview.wav', duration_ms: 180000, track_number: i + 1 })) } });
export const test = base.extend({
  page: async ({ page, browserName, baseURL }, use) => {
    await page.context().routeWebSocket('**/*', socket => socket.close());
    if (browserName === 'webkit') {
      // Windows WebKit cannot decode the PCM fixture or run its Web Audio
      // transport. Exercise the real provider interface with a test clock;
      // Chrome/Firefox continue to play an actual local media element.
      await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        if (!window.VinalAudio) return;
        VinalAudio.register('local-test', {
          label: 'Local test transport', link: () => null,
          resolve: () => Promise.resolve({ url: 'test:local', ms: 30000 }),
          play: function () { this.started = performance.now(); return Promise.resolve(true); },
          stop: function () { this.started = null; },
          position: function () { return this.started == null ? 0 : (performance.now() - this.started) / 1000; }
        });
        VinalAudio.use('local-test');
      }));
    }
    await page.context().route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      // All remote traffic, including automatic telemetry, is intercepted.
      // No test can read or write production user data.
      if (url.hostname.endsWith('supabase.co')) {
        const single = request.headers().accept?.includes('object+json');
        const body = url.pathname.includes('/auth/') ? { user: null, session: null } : (single ? null : []);
        return route.fulfill({ json: body, headers: { 'content-range': '0-0/0' } });
      }
      if (url.pathname === '/api/catalogue') {
        const p = url.searchParams.get('path') || url.searchParams.get('endpoint') || '';
        const a = album(url.searchParams.get('id') || '100');
        let data = a;
        if (p.includes('search')) data = { albums: { items: Array.from({ length: 12 }, (_, i) => album(100 + i)) }, artists: { items: [{ id: '42', name: 'Test Artist', images: a.images }] }, tracks: { items: a.tracks.items } };
        if (p.startsWith('artist')) data = p.includes('albums') ? { items: Array.from({ length: 12 }, (_, i) => album(100 + i)) } : { id: '42', name: 'Test Artist', images: a.images };
        if (p === 'album-tracks') data = a.tracks;
        return route.fulfill({ json: data });
      }
      if (url.pathname === '/api/preview') {
        const id = (url.searchParams.get('album') || '').match(/\d+/)?.[0] || '100';
        return route.fulfill({ json: { cover: '/assets/icons/icon-512.png', tracks: Array.from({ length: 16 }, (_, i) => ({ id: `${id}${i}`, title: `Song ${id}-${i}`, artist: 'Test Artist', duration: 180, preview: '/test-preview.wav' })) } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
      if (url.origin !== new URL(baseURL).origin) return route.fulfill({ status: 200, body: '', contentType: 'text/plain' });
      if (url.pathname === '/test-preview.wav') {
        const size = 8000 * 30 * 2, wav = Buffer.alloc(44 + size);
        wav.write('RIFF'); wav.writeUInt32LE(36 + size, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(size, 40);
        return route.fulfill({ body: wav, contentType: 'audio/wav' });
      }
      return route.continue();
    });
    await use(page);
  }
});
export async function start(page, { seeded = false } = {}) {
  await page.addInitScript(({ seeded }) => {
    window.__vinallTest = true;
    if (seeded) {
      const records = {};
      for (let i = 100; i < 112; i++) records[i] = { id: String(i), name: `Record ${i}`, artist: 'Test Artist', artistId: '42', art: '/assets/icons/icon-512.png', score: 85, ratedAt: Date.now() };
      localStorage.setItem('crate_albums_v1', JSON.stringify(records));
    }
  }, { seeded });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.goToView === 'function');
  const go = page.locator('#splash-cta');
  if (await go.isVisible()) await go.click();
  await expect(page.locator('#splash-gate')).toHaveCount(0);
}
