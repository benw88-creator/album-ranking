// PERF=1 only: a throttled timing harness (4x CPU, 390x844), Chromium. It
// prints numbers rather than asserting them; the asserted budget lives in
// performance.spec.mjs. Run before and after a change and compare.
import { test, start } from './fixtures.mjs';

test('measure: load and every view switch at 4x CPU', async ({ page, browserName }) => {
  test.skip(!process.env.PERF || browserName !== 'chromium', 'PERF=1 in Chromium only');
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now();
  await start(page, { seeded: true });
  const load = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { domInteractive: Math.round(n.domInteractive), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null };
  });
  const modes = await page.evaluate(() => Array.from(document.querySelectorAll('section.view[id^="view-"]')).map((s) => s.id.slice(5)).filter((m) => m !== 'album-detail'));
  const out = {};
  for (let round = 0; round < 2; round++) {
    for (const m of modes) {
      const r = await page.evaluate((mode) => new Promise((res) => {
        const s = performance.now();
        try { goToView(mode); } catch (e) {}
        const sync = performance.now() - s;
        requestAnimationFrame(() => setTimeout(() => res({ sync, frame: performance.now() - s }), 0));
      }), m);
      if (round === 1) out[m] = { sync: Math.round(r.sync), frame: Math.round(r.frame) };
      await page.waitForTimeout(120);
    }
  }
  const lt = await page.evaluate(() => ({ heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, nodes: document.getElementsByTagName('*').length }));
  console.log('PERF load ' + JSON.stringify(load) + ' wall ' + (Date.now() - t0) + 'ms ' + JSON.stringify(lt));
  console.log('PERF views ' + JSON.stringify(out));
});

// PERF_PROFILE=<view>: CPU-profiles one switch to that view and prints the
// functions with the most self time.
test('profile one view switch', async ({ page, browserName }) => {
  const target = process.env.PERF_PROFILE;
  test.skip(!target || browserName !== 'chromium', 'PERF_PROFILE=<view> in Chromium only');
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await start(page, { seeded: true });
  await page.evaluate(() => goToView('home'));
  await page.waitForTimeout(800);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
  await page.evaluate((m) => new Promise((res) => { goToView(m); requestAnimationFrame(() => setTimeout(res, 0)); }), target);
  await page.waitForTimeout(300);
  const { profile } = await cdp.send('Profiler.stop');
  const self = {}, dt = {};
  const ids = profile.samples, deltas = profile.timeDeltas;
  ids.forEach((id, i) => { dt[id] = (dt[id] || 0) + (deltas[i] || 0); });
  profile.nodes.forEach((n) => { const f = n.callFrame; const k = (f.functionName || '(anon)') + ' ' + (f.url || '').split('/').pop().split('?')[0] + ':' + (f.lineNumber + 1); self[k] = (self[k] || 0) + (dt[n.id] || 0) / 1000; });
  const top = Object.entries(self).filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18);
  console.log('PROFILE ' + target + '\n' + top.map(([k, v]) => v.toFixed(1).padStart(7) + 'ms  ' + k).join('\n'));
  // Who forced layout: the JS callers of each native layout read.
  const parent = {}; profile.nodes.forEach((n) => (n.children || []).forEach((c) => { parent[c] = n; }));
  const by = {};
  profile.nodes.forEach((n) => {
    if (!/clientWidth|clientHeight|getClientRects|getBoundingClientRect|offsetWidth|offsetHeight|getComputedStyle|scrollTop|scrollHeight/.test(n.callFrame.functionName)) return;
    const chain = []; let p = parent[n.id];
    for (let i = 0; p && i < 4; i++, p = parent[p.id]) chain.push((p.callFrame.functionName || 'anon') + ':' + (p.callFrame.lineNumber + 1));
    const k = n.callFrame.functionName + ' <- ' + chain.join(' <- ');
    by[k] = (by[k] || 0) + (dt[n.id] || 0) / 1000;
  });
  console.log('LAYOUT\n' + Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => v.toFixed(1).padStart(7) + 'ms  ' + k).join('\n'));
});
