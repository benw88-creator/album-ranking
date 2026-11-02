import { test, expect, start } from './fixtures.mjs';
import sharp from 'sharp';
import fs from 'node:fs/promises';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const importKey = 'crate_spotify_import_v1';
const history = [{ user_id: userId, k: 'testartist|song', artist: 'Test Artist', track: 'Song', plays: 12, ms_played: 360000, source: 'spotify-export', updated_at: '2026-10-01T12:00:00Z' }];
const imported = { importedAt: Date.parse('2026-10-01'), updatedAt: Date.parse('2026-10-01'), summary: { history: 12, liked: 1 }, imported: { 'spotify:track:abc': { id: '1000', name: 'Song', artist: 'Test Artist' } }, job: null };

// A tiny persistent test backend exercises the real Supabase client, auth,
// app_state merge and listening queries. All requests remain intercepted.
async function cloudBackend(page, { rows = [], plays = [], collection = [], lore = [], legacy = null, poolDelay = 0, pool = null, spinPrize = null, freeCheckDelay = 0, spinDelay = 120, failSpin = false, profileDelay = 0, fav = false } = {}) {
  plays=plays.map(row=>({...row}));
  let uid = userId, spins = 0, reads = 0;
  const store = new Map(rows.map(row => [row.key, row.value]));
  const writes = [], queries = [];
  await page.addInitScript(({ uid, legacy }) => {
    if(sessionStorage.getItem('polish-seeded'))return;
    sessionStorage.setItem('polish-seeded','1');
    localStorage.setItem('vinall_local_owner', uid);
    localStorage.setItem('crate_onboard_v1', JSON.stringify({ done: true, step: 99 }));
    if (legacy) localStorage.setItem('vinall_spotify_v1', JSON.stringify(legacy));
  }, { uid, legacy });
  const user = () => ({ id: uid, aud: 'authenticated', role: 'authenticated', email: 'local-test@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
  const jwt = () => [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url'), 'test-signature'].join('.');
  await page.route('https://*.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    queries.push({ path, method: req.method(), query: Object.fromEntries(url.searchParams) });
    if (path.endsWith('/token')) return route.fulfill({ json: { access_token: jwt(), refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: user() } });
    if (path.endsWith('/user')) return route.fulfill({ json: user() });
    if (path.endsWith('/logout')) return route.fulfill({ status: 204 });
    if (path.endsWith('/app_state')) {
      if (req.method() === 'POST') {
        const body = req.postDataJSON(); writes.push(body);
        store.set(body.key, body.value);
        return route.fulfill({ status: 201, json: [] });
      }
      reads++;
      return route.fulfill({ json: [...store].map(([key, value]) => ({ key, value })) });
    }
    if (path.endsWith('/profiles') && req.method() === 'GET') {
      if (profileDelay) await new Promise(r => setTimeout(r, profileDelay));
      const profile = { id: uid, username: 'Local Listener', discs: 30000, is_admin: false, owned_themes: [], top3: [], fav_artist: fav ? { id: '42', name: 'Test Artist', image: '/assets/icons/icon-512.png' } : null };
      return route.fulfill({ json: req.headers().accept?.includes('object+json') ? profile : [profile] });
    }
    if (path.endsWith('/listening_plays')) {
      let data = plays.filter(p => p.user_id === uid);
      if (url.searchParams.get('source')) data = data.filter(p => p.source === 'spotify-export');
      if (req.method() === 'POST') {
        const rows=req.postDataJSON();writes.push(rows);
        rows.forEach(row=>{const at=plays.findIndex(p=>p.user_id===row.user_id&&p.k===row.k);if(at<0)plays.push(row);else plays[at]=row;});
        return route.fulfill({ status: 201, json: [] });
      }
      const total=data.length,offset=Number(url.searchParams.get('offset')||0);
      data=data.slice(offset,offset+Math.min(1000,Number(url.searchParams.get('limit')||1000)));
      return route.fulfill({ json: data, headers: { 'content-range': `${offset}-${offset+Math.max(0,data.length-1)}/${total}` } });
    }
    if(path.endsWith('/collection'))return route.fulfill({json:collection.filter(row=>row.user_id===uid)});
    if(path.endsWith('/lore_answers'))return route.fulfill({json:lore.filter(row=>row.user_id===uid)});
    if(path.endsWith('/collection_net_worth'))return route.fulfill({json:{net_worth:collection.filter(row=>row.user_id===uid).reduce((sum,row)=>sum+row.price,0)}});
    if (path.endsWith('/spin_items')) {
      if (poolDelay) await new Promise(r => setTimeout(r, poolDelay));
      return route.fulfill({ json: pool || [{ key: 'test-prize', label: '400 Discs', kind: 'discs', amount: 400, tier: 'common', weight: 1000 }] });
    }
    if (path.endsWith('/spin_free_available')) {
      if (spins && freeCheckDelay) await new Promise(r => setTimeout(r, freeCheckDelay));
      return route.fulfill({ json: spins === 0 });
    }
    if (path.endsWith('/wallet_spin')) {
      spins++;
      await new Promise(r => setTimeout(r, spinDelay));
      if (failSpin) return route.fulfill({ status: 400, json: { message: 'Spin temporarily unavailable', code: 'P0001' } });
      return route.fulfill({ json: spinPrize || { key: 'test-prize', label: '400 Discs', kind: 'discs', tier: 'common', gained: 400, free: spins === 1, discs: 30400 } });
    }
    return route.fallback();
  });
  return { store, writes, queries, spins: () => spins, reads: () => reads, changeUser: id => { uid = id; } };
}

async function login(page) {
  await page.evaluate(() => Cloud.openAuth());
  await page.locator('#auth-email').fill('local-test@example.test');
  await page.locator('#auth-pass').fill('test-password');
  await page.locator('#auth-submit').click();
  await expect.poll(() => page.evaluate(() => Cloud.isOn())).toBe(true);
  await expect(page.locator('#auth-modal')).not.toHaveClass(/open/);
}

test('hover releases entrance transforms, clips artwork cleanly, and honours reduced motion', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page, { seeded: true });
  await page.evaluate(() => goToView('albums'));
  const card = page.locator('.card[data-id="100"]');
  await card.hover();
  await page.waitForTimeout(850);
  const hovered = await card.evaluate(n => ({ transform: getComputedStyle(n).transform, artContain: getComputedStyle(n.querySelector('.art-wrap')).contain, fill: getComputedStyle(n).animationFillMode }));
  expect(new DOMMatrixPolyfill(hovered.transform).scale).toBeGreaterThan(1);
  expect(hovered.fill).toBe('backwards');
  expect(hovered.artContain).toBe('none');
  await page.screenshot({ path: info.outputPath('desktop-album-hover.png') });
  await page.mouse.move(0, 0); await page.waitForTimeout(450);
  expect(await card.evaluate(n => getComputedStyle(n).transform)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card.hover();
  expect(await card.evaluate(n => getComputedStyle(n).transform)).toBe('none');
});
// Parse the scale coefficient without requiring a browser global in Node.
class DOMMatrixPolyfill { constructor(t) { this.scale = Number(t.match(/matrix\(([^,]+)/)?.[1] || 1); } }

test('For You warms initial cards once, without playing or consuming unseen songs', async ({ page }) => {
  let previews = 0, media = 0;
  page.on('request', req => { if (req.url().includes('/api/preview')) previews++; if (req.url().includes('test-preview.wav')) media++; });
  await start(page, { seeded: true });
  await expect.poll(() => page.locator('#fy-feed .fy-card').count()).toBe(2);
  const preloaded = previews;
  expect(preloaded).toBeLessThanOrEqual(2);
  expect(media).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('crate_foryou_songs'))).toBeNull();
  await page.evaluate(() => { ForYou.preload(); ForYou.preload(); });
  await page.waitForTimeout(400);
  expect(previews).toBe(preloaded);
  await page.locator('#modes [data-mode="foryou"]').click();
  await expect(page.locator('#fy-feed .fy-card').first()).toBeVisible();
  await expect.poll(() => page.locator('#fy-feed .fy-card').count()).toBeGreaterThan(2);
});

test('late Home artist media never moves the Island and desktop preserves the full image', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await cloudBackend(page, { fav: true });
  await start(page);
  await login(page);
  await expect(page.locator('#artist-hero')).toBeVisible();
  const navTop = await page.locator('#modes').evaluate(n => n.getBoundingClientRect().top);
  await page.evaluate(async () => {
    const original = Cloud.fetchProfile;
    Cloud.fetchProfile = id => new Promise(resolve => setTimeout(() => resolve({ id, fav_artist: { id: '43', name: 'Late Artist', image: '/assets/icons/icon-512.png' } }), 450));
    renderArtistHero();
    Cloud.fetchProfile = original;
  });
  await expect(page.locator('#artist-hero-name')).toHaveText('Late Artist');
  expect(await page.locator('#modes').evaluate(n => n.getBoundingClientRect().top)).toBe(navTop);
  expect(await page.locator('#artist-hero-bg').evaluate(n => getComputedStyle(n).objectFit)).toBe('contain');
  await page.screenshot({ path: info.outputPath('desktop-artist.png') });
  await page.locator('#modes [data-mode="albums"]').click();
  await expect(page.locator('#view-albums')).toBeVisible();
  expect(await page.locator('#modes').evaluate(n => n.getBoundingClientRect().top)).toBe(navTop);
});

test('spin locks before pool loading, survives rerenders, and lands the server prize after resize', async ({ page }) => {
  const backend = await cloudBackend(page, { poolDelay: 250 });
  await start(page); await login(page);
  await page.evaluate(() => { goToView('rewards'); renderDrawTab(); const button=document.querySelector('#draw-go'); button.dispatchEvent(new MouseEvent('click',{bubbles:true})); button.dispatchEvent(new MouseEvent('click',{bubbles:true})); renderDrawTab(); });
  await expect.poll(backend.spins).toBe(1);
  await expect(page.locator('#draw-go')).toBeDisabled();
  await page.evaluate(() => renderDrawTab());
  await page.setViewportSize({ width: 900, height: 750 });
  await expect(page.locator('#draw-result')).toContainText('+400 Discs', { timeout: 8500 });
  expect(backend.spins()).toBe(1);
  const centre = await page.evaluate(() => {
    const window = document.querySelector('#draw-window').getBoundingClientRect();
    const tile = document.querySelector('#draw-strip').children[62].getBoundingClientRect();
    return Math.abs((tile.left + tile.width / 2) - (window.left + window.width / 2));
  });
  expect(centre).toBeLessThan(28);
  await page.evaluate(() => { goToView('home'); goToView('rewards'); });
  await expect(page.locator('#draw-result')).toContainText('+400 Discs');
});

test('spin request failures unlock a retry', async ({ page }) => {
  const backend = await cloudBackend(page, { failSpin: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page); await login(page);
  await page.evaluate(() => { goToView('rewards'); renderDrawTab(); });
  await expect(page.locator('#draw-go')).toBeEnabled();
  await page.locator('#draw-go').click();
  await expect(page.locator('#draw-result')).toContainText('Spin temporarily unavailable');
  await expect(page.locator('#draw-go')).toBeEnabled();
  expect(backend.spins()).toBe(1);
});

test('reduced-motion spin reveals the awarded prize without the reel delay', async ({ page }) => {
  await cloudBackend(page, { spinDelay: 50 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page); await login(page);
  await page.evaluate(() => { goToView('rewards');renderDrawTab(); });
  await expect(page.locator('#draw-go')).toBeEnabled();
  await page.locator('#draw-go').click();
  await expect(page.locator('#draw-result')).toContainText('+400 Discs',{timeout:1500});
  await expect(page.locator('#draw-go')).toBeEnabled();
});

test('mixed-prize reel finishes without a resize snap and stops advertising the spent free spin', async ({ page }) => {
  const pool = [
    { key: 'small', label: '400 Discs', kind: 'discs', amount: 400, tier: 'common', weight: 800 },
    { key: 'rare', label: '800 Discs', kind: 'discs', amount: 800, tier: 'rare', weight: 150 },
    { key: 'gold', label: '1,000 Discs', kind: 'discs', amount: 1000, tier: 'legendary', weight: 50 }
  ];
  await page.setViewportSize({width:1440,height:900});
  await cloudBackend(page, {pool,freeCheckDelay:1200,spinPrize:{key:'gold',label:'1,000 Discs',kind:'discs',tier:'legendary',gained:1000,free:true,discs:31000}});
  await start(page);await login(page);
  await page.evaluate(()=>goToView('rewards'));
  await expect(page.locator('#draw-go')).toContainText('Your free spin');
  await page.locator('#draw-go').click();
  await expect.poll(()=>page.locator('#draw-strip').evaluate(n=>n.getAnimations().length)).toBe(1);
  await page.setViewportSize({width:900,height:750});
  const snap=await page.locator('#draw-strip').evaluate(async n=>{
    const animation=n.getAnimations()[0];animation.currentTime=5120;
    const before=new DOMMatrixReadOnly(getComputedStyle(n).transform).m41;
    await animation.finished;await new Promise(requestAnimationFrame);
    const after=new DOMMatrixReadOnly(getComputedStyle(n).transform).m41;
    return Math.abs(after-before);
  });
  expect(snap).toBeLessThan(1);
  await expect(page.locator('#draw-result')).toContainText('+1,000 Discs');
  await expect(page.locator('#draw-go')).not.toContainText('Your free spin');
  const centre=await page.evaluate(()=>{
    const tile=document.querySelector('#draw-strip').children[62].getBoundingClientRect();
    const needle=document.querySelector('.draw-needle').getBoundingClientRect();
    return Math.abs(tile.left+tile.width/2-needle.left-needle.width/2);
  });
  expect(centre).toBeLessThan(1);
});

test('leaving before the spin response preserves the correct result on return',async({page})=>{
  await cloudBackend(page,{spinDelay:500});await start(page);await login(page);
  await page.evaluate(()=>goToView('rewards'));await expect(page.locator('#draw-go')).toBeEnabled();
  await page.locator('#draw-go').click();await page.evaluate(()=>goToView('home'));
  await expect(page.locator('#draw-result')).toContainText('+400 Discs');
  await page.evaluate(()=>goToView('rewards'));await expect(page.locator('#draw-result')).toBeVisible();
  const centre=await page.evaluate(()=>{
    const tile=document.querySelector('#draw-strip').children[62].getBoundingClientRect();
    const needle=document.querySelector('.draw-needle').getBoundingClientRect();
    return Math.abs(tile.left+tile.width/2-needle.left-needle.width/2);
  });expect(centre).toBeLessThan(1);
});

test('an unavailable prize pool displays a retry instead of throwing',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await cloudBackend(page,{pool:[]});await start(page);await login(page);
  await page.evaluate(()=>goToView('rewards'));
  await expect(page.locator('#draw-result')).toContainText('Couldn’t load the prizes');
  await expect(page.locator('#draw-go')).toBeEnabled();await page.locator('#draw-go').click();
  await expect(page.locator('#draw-result')).toContainText('Couldn’t load the prizes');
  expect(errors).toEqual([]);
});

test('desktop cards visibly animate on mouse hover and transitions never clip or transform a view',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await start(page,{seeded:true});
  for(const [mode,selector] of [['albums','#albums-grid .card'],['games','.game-card:not(.locked)']]){
    await page.evaluate(mode=>goToView(mode),mode);
    await expect.poll(()=>page.locator('#view-'+mode).evaluate(view=>view.getAnimations({subtree:true}).some(a=>a.effect.getKeyframes().some(f=>parseFloat(f.translate)===18)))).toBe(true);
    const motion=await page.locator('#view-'+mode).evaluate(view=>({
      transform:getComputedStyle(view).transform,
      frames:view.getAnimations({subtree:true}).filter(a=>a.effect.getKeyframes().some(f=>f.translate)).map(a=>a.effect.getKeyframes())
    }));
    expect(motion.transform).toBe('none');expect(motion.frames.length).toBeGreaterThan(0);
    expect(motion.frames.flat().every(f=>!f.clipPath)).toBe(true);
    const card=page.locator(selector).first();await card.hover();await page.waitForTimeout(600);
    expect(await card.evaluate(n=>new DOMMatrixReadOnly(getComputedStyle(n).transform).a)).toBeGreaterThan(1);
    await page.mouse.move(0,0);await page.waitForTimeout(400);
    expect(await card.evaluate(n=>getComputedStyle(n).transform)).toBe('none');
  }
});

test('overlapping history imports retain the richer account aggregate and clear analytics caches', async ({ page }) => {
  const backend=await cloudBackend(page,{plays:history});
  await start(page);await login(page);
  expect(await page.evaluate(()=>VinalListening.loadByArtist())).toEqual({testartist:12});
  const result=await page.evaluate(()=>VinalListening.importEvents([{ts:'2026-10-02T12:00:00Z',ms_played:30000,master_metadata_track_name:'Song',master_metadata_album_artist_name:'Test Artist',master_metadata_album_album_name:'Record'}]));
  expect(result.error).toBeNull();
  const upload=backend.writes.find(Array.isArray);
  expect(upload[0]).toMatchObject({user_id:userId,plays:12,ms_played:360000,source:'spotify-export'});
  expect(await page.evaluate(()=>VinalListening.loadByArtist())).toEqual({testartist:12});
});

test('a delayed wallet profile cannot overwrite the balance returned by a spin',async({page})=>{
  await cloudBackend(page);await start(page);await login(page);
  const result=await page.evaluate(async()=>{
    const original=Cloud.fetchProfile;
    Cloud.fetchProfile=id=>new Promise(resolve=>setTimeout(()=>resolve({id,discs:30000,owned_themes:['classic']}),500));
    const pending=Wallet.load();
    await new Promise(resolve=>setTimeout(resolve,50));
    const won=await Wallet.spin();
    await pending;Cloud.fetchProfile=original;
    return {gained:won.data.gained,balance:Wallet.get().discs};
  });
  expect(result).toEqual({gained:400,balance:30400});
});

test('listening analytics page past the Data API row cap',async({page})=>{
  const plays=Array.from({length:2200},(_,i)=>({user_id:userId,k:'testartist|song'+i,artist:'Test Artist',track:'Song '+i,plays:1,source:'spotify-export',updated_at:'2026-10-01T00:00:00Z'}));
  await cloudBackend(page,{plays});await start(page);await login(page);
  expect(await page.evaluate(async()=> (await listeningPlays(true)).length)).toBe(1500);
  expect(await page.evaluate(()=>VinalListening.loadByArtist())).toEqual({testartist:2200});
});

test('rapid desktop nav gestures preserve history, geometry and the final destination', async ({ page }) => {
  await start(page,{seeded:true});
  const position=await page.locator('#modes').boundingBox();
  await page.locator('#modes [data-mode="albums"]').click();
  await page.locator('#modes [data-mode="games"]').click();
  await expect(page).toHaveTitle('VINALL — Games');
  expect(await page.locator('#modes').boundingBox()).toEqual(position);
  await page.goBack();
  await expect(page).toHaveTitle('VINALL — Albums');
  await page.goBack();
  await expect(page).toHaveTitle('VINALL');
});

test('a large desktop crate keeps entrances bounded and navigation responsive', async ({ page },info) => {
  await page.setViewportSize({width:1440,height:900});
  await start(page);
  await page.evaluate(()=>{
    const records={};for(let i=100;i<700;i++)records[i]={id:String(i),name:'Record '+i,artist:'Test Artist',score:85,art:'/assets/icons/icon-512.png',ratedAt:Date.now()};
    localStorage.setItem('crate_albums_v1',JSON.stringify(records));
  });
  const timings=[];
  for(const mode of ['albums','games','home','albums'])timings.push(await page.evaluate(mode=>new Promise(resolve=>{const start=performance.now();goToView(mode);const cpu=performance.now()-start;requestAnimationFrame(()=>resolve({mode,cpu,frame:performance.now()-start}));}),mode));
  expect(await page.locator('#albums-grid .card').count()).toBe(600);
  const distant=await page.locator('#albums-grid .card').nth(200).evaluate(n=>({animation:getComputedStyle(n).animationName,layer:getComputedStyle(n).willChange}));
  expect(distant).toEqual({animation:'none',layer:'auto'});
  const max=Math.max(...timings.map(t=>t.frame));
  await info.attach('large-crate-timing.json',{body:JSON.stringify({timings,max}),contentType:'application/json'});
  console.log(`${info.project.name} large crate navigation: ${JSON.stringify(timings)}`);
  // Input processing is the regression budget. Windows WebKit's software
  // renderer takes longer on the first 600-card paint; keep that separate
  // from cached navigation instead of claiming a hardware-independent FPS.
  expect(Math.max(...timings.map(t=>t.cpu))).toBeLessThan(100);
  expect(timings[0].frame).toBeLessThan(info.project.name==='webkit'?350:250);
  expect(Math.max(...timings.slice(1).map(t=>t.frame))).toBeLessThan(250);
});

test('completed import and history restore on a fresh mobile session, after refresh and logout', async ({ page }) => {
  const backend = await cloudBackend(page, { legacy: imported, plays: history });
  await start(page); await login(page);
  await expect.poll(() => backend.store.get(importKey)?.importedAt).toBe(imported.importedAt);
  expect(backend.store.get(importKey)).not.toHaveProperty('job');
  await expect(page.locator('#sp-home')).toBeEmpty();
  await page.evaluate(() => Cloud.logout());
  expect(await page.evaluate(key => localStorage.getItem(key), importKey)).toBeNull();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.Cloud);
  if (await page.locator('#splash-cta').isVisible()) await page.locator('#splash-cta').click();
  await login(page);
  await expect.poll(() => page.evaluate(() => SpotifyBridge.state().importedAt)).toBe(imported.importedAt);
  await page.evaluate(() => SpotifyBridge.open());
  await expect(page.locator('#sp-body')).toContainText('Your Spotify is in.');
  await expect(page.locator('#sp-body')).toContainText('12');
  await page.locator('#sp-close').click();
  expect(await page.evaluate(async () => (await listeningPlays(true))[0].plays)).toBe(12);
  await page.reload();
  await page.waitForFunction(() => Cloud.isOn());
  await expect.poll(() => page.evaluate(() => SpotifyBridge.state().importedAt)).toBe(imported.importedAt);
  expect(backend.queries.filter(q => q.path.endsWith('/listening_plays')).every(q => q.query.user_id === `eq.${userId}`)).toBe(true);
});

test('legacy server history recovers import status without needing the original device', async ({ page }) => {
  const backend = await cloudBackend(page, { plays: history });
  await start(page); await login(page);
  await expect.poll(() => backend.store.get(importKey)?.summary?.historyTracks).toBe(1);
  await page.evaluate(() => SpotifyBridge.open());
  await expect(page.locator('#sp-body')).toContainText('Your Spotify is in.');
  await expect(page.locator('#sp-body')).toContainText('tracks in your listening history');
});

test('an open mobile session recognises an import completed on another device when it resumes',async({page})=>{
  const backend=await cloudBackend(page);
  await page.setViewportSize({width:375,height:812});
  await start(page);await login(page);
  await expect(page.locator('#sp-home')).toContainText('Bring your library with you');
  backend.store.set(importKey,imported);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#sp-home')).toBeEmpty();
  expect(await page.evaluate(()=>SpotifyBridge.state().importedAt)).toBe(imported.importedAt);
});

test('listening caches and import jobs are isolated across accounts', async ({ page }) => {
  const backend = await cloudBackend(page, { rows: [{ key: importKey, value: imported }], plays: history });
  await start(page); await login(page);
  expect(await page.evaluate(async () => (await listeningPlays())[0].plays)).toBe(12);
  expect(await page.evaluate(() => VinalListening.loadByArtist())).toEqual({ testartist: 12 });
  await page.evaluate(() => Cloud.logout());
  expect(await page.evaluate(() => VinalListening.byArtist())).toEqual({});
  backend.store.clear(); backend.changeUser(otherId);
  await login(page);
  expect(await page.evaluate(() => listeningPlays())).toEqual([]);
  expect(await page.evaluate(() => VinalListening.loadByArtist())).toEqual({});
  expect(await page.evaluate(() => SpotifyBridge.state().importedAt || null)).toBeNull();
  expect(backend.writes.filter(w => w.user_id === otherId && w.key === importKey).every(w => !w.value.importedAt)).toBe(true);
});

test('collection, Today answers and the artist banner clear when accounts change',async({page})=>{
  const backend=await cloudBackend(page,{fav:true,collection:[{user_id:userId,album_id:'100',name:'Private shelf',artist:'Test Artist',price:900,bought_at:'2026-10-01T00:00:00Z'}],lore:[{user_id:userId,item_kind:'album',item_id:'100',question_id:'test-question',choice:'My answer',created_at:'2026-10-01T00:00:00Z'}]});
  await start(page);await login(page);
  await expect.poll(()=>page.evaluate(()=>CollectionWorth.mine().length)).toBe(1);
  await page.evaluate(()=>VinallLore.load(true));
  expect(await page.evaluate(()=>VinallLore.count())).toBe(1);
  await page.evaluate(()=>Cloud.logout());
  expect(await page.evaluate(()=>CollectionWorth.mine())).toEqual([]);
  expect(await page.evaluate(()=>VinallLore.items())).toEqual([]);
  await expect(page.locator('#artist-hero')).toBeHidden();
  backend.changeUser(otherId);backend.store.clear();
  await login(page);
  await page.evaluate(()=>VinallLore.load(true));
  expect(await page.evaluate(()=>CollectionWorth.mine())).toEqual([]);
  expect(await page.evaluate(()=>VinallLore.items())).toEqual([]);
});

test('late account avatars cannot duplicate the header or resurrect an account after logout',async({page})=>{
  await cloudBackend(page,{profileDelay:400});await start(page);await login(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.stack));
  await page.evaluate(()=>{
    Cloud.syncUI();Cloud.syncUI();
  });
  await page.waitForTimeout(650);
  await expect(page.locator('#auth-area #acct-chip')).toHaveCount(1);
  await page.evaluate(()=>{Cloud.syncUI();});
  await page.evaluate(()=>Cloud.logout());
  await page.waitForTimeout(500);
  await expect(page.locator('#acct-avatar-btn')).toHaveCount(0);
  await expect(page.locator('#auth-area #acct-chip')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('official favicon has transparent margins and suitable PNG/ICO sizes', async () => {
  for (const size of [16, 32, 48]) {
    const png = new URL(`../../assets/icons/favicon-${size}.png`, import.meta.url);
    const { data, info } = await sharp(await fs.readFile(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(size); expect(info.height).toBe(size);
    expect(data[3]).toBe(0);
    expect([...data].filter((_, i) => i % 4 === 3 && data[i] > 180).length).toBeGreaterThan(0);
  }
  const ico = await fs.readFile(new URL('../../assets/icons/favicon.ico', import.meta.url));
  expect(ico.readUInt16LE(4)).toBe(3);
});
