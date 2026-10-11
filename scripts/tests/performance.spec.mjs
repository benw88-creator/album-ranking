import { test, expect, start } from './fixtures.mjs';
test('records frame cadence and navigation response under repeated interactions', async ({ page }, info) => {
  await start(page, { seeded: true });
  await page.evaluate(() => {
    window.auditTiming = { frames: [], shifts: [], longTasks: [], responses: [] };
    if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) new PerformanceObserver(list => {
      list.getEntries().forEach(e => { if (!e.hadRecentInput) auditTiming.shifts.push(e.value); });
    }).observe({ type: 'layout-shift', buffered: false });
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
      list.getEntries().forEach(e => auditTiming.longTasks.push(e.duration));
    }).observe({ type: 'longtask', buffered: false });
    var previous;
    window.auditFrames = true;
    function sample(now) { if (previous) auditTiming.frames.push(now - previous); previous = now; if (auditFrames) requestAnimationFrame(sample); }
    requestAnimationFrame(sample);
  });
  for (let i = 0; i < 3; i++) for (const mode of ['albums', 'games', 'home']) {
    await page.evaluate(m => { var start = performance.now(); goToView(m); requestAnimationFrame(() => auditTiming.responses.push(performance.now() - start)); }, mode);
    await page.waitForTimeout(100);
  }
  const metrics = await page.evaluate(() => {
    auditFrames = false;
    const sorted = auditTiming.frames.slice().sort((a, b) => a - b);
    return { frameP50Ms: sorted[Math.floor(sorted.length * .5)], frameP95Ms: sorted[Math.floor(sorted.length * .95)], framesOver50Ms: sorted.filter(n => n > 50).length, totalFrames: sorted.length, maxNavigationToFrameMs: Math.max(...auditTiming.responses), layoutShiftScore: PerformanceObserver.supportedEntryTypes.includes('layout-shift') ? auditTiming.shifts.reduce((a, b) => a + b, 0) : null, longTasks: PerformanceObserver.supportedEntryTypes.includes('longtask') ? auditTiming.longTasks : null };
  });
  await info.attach('interaction-timing.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  // Hardware and headed/headless rendering vary; assert responsiveness, not
  // an invented universal 60fps guarantee.
  expect(metrics.maxNavigationToFrameMs).toBeLessThan(250);
  console.log(`${info.project.name} interaction timing: ${JSON.stringify(metrics)}`);
});
