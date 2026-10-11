import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function worker({ cached, network, offline } = {}) {
  const events = {}, writes = [], messages = [];
  const cache = { match: async () => cached?.clone(), put: async (req, response) => { writes.push(await response.text()); } };
  const caches = { open: async () => cache, match: async key => typeof key === 'string' ? offline?.clone() : cached?.clone(), keys: async () => ['vinall-v3-shell', 'another-app-cache'], delete: async () => true };
  const self = { location: { origin: 'https://vinall.test' }, addEventListener: (type, fn) => { events[type] = fn; }, clients: { matchAll: async () => [{ postMessage: message => messages.push(message) }], claim: async () => {} } };
  vm.runInNewContext(source, { self, caches, fetch: network || (() => Promise.reject(new Error('offline'))), Response, URL, Promise });
  function dispatch(url, mode = 'navigate', method = 'GET') {
    const waits = [];
    let response;
    events.fetch({ request: { url, mode, method }, waitUntil: p => waits.push(p), respondWith: p => { response = p; } });
    return { waits, response };
  }
  return { dispatch, writes, messages };
}
test('cached shell returns while a changed refresh remains alive and notifies the page', async () => {
  let finish;
  const w = worker({ cached: new Response('old shell'), network: () => new Promise(resolve => { finish = resolve; }) });
  const event = w.dispatch('https://vinall.test/');
  assert.equal(event.waits.length, 1);
  assert.equal(await (await event.response).text(), 'old shell');
  finish(new Response('new shell'));
  await Promise.all(event.waits);
  assert.deepEqual(w.writes, ['new shell']); assert.deepEqual(w.messages, ['vinall-sw-updated']);
});
test('first offline navigation uses the offline page', async () => {
  const w = worker({ offline: new Response('VINALL offline') });
  const event = w.dispatch('https://vinall.test/');
  assert.equal(await (await event.response).text(), 'VINALL offline');
  await Promise.all(event.waits);
});
test('static assets retain their cache refresh through worker suspension', async () => {
  const w = worker({ cached: new Response('old icon'), network: async () => new Response('official icon') });
  const event = w.dispatch('https://vinall.test/assets/icons/favicon.ico', 'cors');
  assert.equal(event.waits.length, 1);
  assert.equal(await (await event.response).text(), 'old icon');
  await Promise.all(event.waits); assert.deepEqual(w.writes, ['official icon']);
});
test('private API, cross-origin, reset and live share requests bypass caches', () => {
  const w = worker();
  for (const url of ['https://vinall.test/api/catalogue', 'https://remote.test/image.png', 'https://vinall.test/reset.html', 'https://vinall.test/u/person', 'https://vinall.test/a/42', 'https://vinall.test/r/rating']) assert.equal(w.dispatch(url).response, undefined);
  assert.equal(w.dispatch('https://vinall.test/', 'navigate', 'POST').response, undefined);
});
