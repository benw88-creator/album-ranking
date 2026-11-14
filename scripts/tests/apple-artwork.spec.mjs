// Existing-user artwork, not just fresh Apple search results. All data is local.
import {test,expect,start} from './fixtures.mjs';
import {fileURLToPath} from 'node:url';
const DZ='https://cdn-images.dzcdn.net/images/cover/11111111111111111111111111111111/1000x1000-000000-80-0-0.jpg';
const ART='https://is1-ssl.mzstatic.com/image/thumb/Music/v4/album/100x100bb.jpg';
const record={id:'12345',name:'Blonde',artist:'Frank Ocean',art:DZ,score:88,ratedAt:1000};
test.beforeEach(async({page})=>{
 await page.route('https://is1-ssl.mzstatic.com/**',r=>r.fulfill({path:fileURLToPath(new URL('../../assets/icons/icon-512.png',import.meta.url))}));
 await page.route('https://itunes.apple.com/**',r=>{
  const u=new URL(r.request().url());const collection={wrapperType:'collection',collectionType:'Album',collectionId:111,collectionName:'Blonde',artistId:7,artistName:'Frank Ocean',artworkUrl100:ART,trackCount:17,releaseDate:'2016-08-20T00:00:00Z',collectionViewUrl:'https://music.apple.com/gb/album/blonde/111'};
  const song={...collection,wrapperType:'track',kind:'song',trackId:9001,trackName:'Nikes',trackNumber:1,discNumber:1,trackTimeMillis:200000,previewUrl:'https://audio-ssl.itunes.apple.com/p.m4a'};
  const results=u.pathname==='/lookup'?[collection,song]:u.searchParams.get('entity')==='album'?[collection]:[song];
  return r.fulfill({json:{resultCount:results.length,results}});
 });
 await page.addInitScript(r=>{
  localStorage.setItem('vinall_rights','apple');
  localStorage.setItem('crate_albums_v1',JSON.stringify({[r.id]:r}));
  localStorage.setItem('crate_onboard_v1',JSON.stringify({done:true,at:Date.now()}));
 },record);
});
test('saved legacy artwork resolves in the rankings without rewriting the rating',async({page})=>{
 const legacyRequests=[];page.on('request',r=>{if(r.url().includes('dzcdn.net'))legacyRequests.push(r.url());});
 await start(page);await page.evaluate(()=>goToView('albums'));
 const img=page.locator('#albums-grid .card img.art').first();
 await expect(img).toHaveAttribute('src',/mzstatic\.com/,{timeout:8000});
 await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
 expect(await page.evaluate(()=>loadAlbums()['12345'])).toEqual(record);
 expect(legacyRequests).toEqual([]);
});

test('community records resolve resized URLs and discard an obsolete srcset',async({page})=>{
 await page.route('**/rest/v1/artwork_fixture',r=>r.fulfill({json:[{album_name:record.name,album_artist:record.artist,album_art:DZ}]}));
 await start(page);
 await page.evaluate(async dz=>{
  localStorage.removeItem('crate_albums_v1');
  await fetch('https://fixture.supabase.co/rest/v1/artwork_fixture');
  const img=document.createElement('img');img.id='remote-art';img.width=120;img.height=120;
  img.setAttribute('srcset',dz+' 2x');img.src=dz.replace('1000x1000','250x250');
  document.body.prepend(img);
 },DZ);
 const img=page.locator('#remote-art');
 await expect(img).toHaveAttribute('src',/mzstatic\.com/);
 await expect(img).not.toHaveAttribute('srcset');
 await expect.poll(()=>img.evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);
});

test('a saved liked song resolves by track title rather than treating it as an album',async({page})=>{
 const terms=[];page.on('request',r=>{if(r.url().includes('itunes.apple.com/search'))terms.push(new URL(r.url()).searchParams.get('term'));});
 await page.addInitScript(dz=>{
  localStorage.removeItem('crate_albums_v1');
  localStorage.setItem('crate_liked_songs_v1',JSON.stringify({'9001':{id:'9001',name:'Nikes',artist:'Frank Ocean',art:dz,savedAt:1000}}));
 },DZ);
 await start(page);
 await page.evaluate(dz=>{const img=document.createElement('img');img.id='liked-art';img.width=120;img.height=120;img.src=dz;document.body.prepend(img);},DZ);
 await expect(page.locator('#liked-art')).toHaveAttribute('src',/mzstatic\.com/);
 expect(terms).toContain('Frank Ocean Nikes');
});

test('old cached misses recover, and rerendering reuses a positive artwork cache',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('amc:frankocean|blonde','');
  localStorage.setItem('am1:pick:frankocean|blonde',JSON.stringify({d:{c:null},x:Date.now()+86400000}));
 });
 let searches=0;page.on('request',r=>{if(r.url().includes('itunes.apple.com/search'))searches++;});
 await start(page);await page.evaluate(()=>goToView('albums'));
 await expect(page.locator('#albums-grid .card img.art').first()).toHaveAttribute('src',/mzstatic\.com/);
 const before=searches;
 await page.evaluate(dz=>{
  const host=document.createElement('div');host.id='shelf-art';host.innerHTML=Cert.art(dz,null,{artist:'Frank Ocean',album:'Blonde'});document.body.prepend(host);
 },DZ);
 await expect(page.locator('#shelf-art img').first()).toHaveAttribute('src',/mzstatic\.com/);
 expect(searches).toBe(before);
});

test('an empty catalogue response is retried after recovery without changing the rating',async({page})=>{
 let healthy=false;
 await page.route('https://itunes.apple.com/**',async r=>{
  if(!healthy)return r.fulfill({json:{resultCount:0,results:[]}});
  return r.fallback();
 });
 await start(page);await page.evaluate(()=>goToView('albums'));
 const img=page.locator('#albums-grid .card img.art').first();
 await expect(img).toHaveAttribute('src','/assets/sleeve-blank.svg');
 await page.waitForTimeout(300);
 healthy=true;
 // Advance the retry backoff without waiting thirty real seconds.
 await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+31000;window.dispatchEvent(new Event('online'));});
 await expect(img).toHaveAttribute('src',/mzstatic\.com/);
 expect(await page.evaluate(()=>loadAlbums()['12345'])).toEqual(record);
});

test('a recycled image cannot receive the previous record artwork',async({page})=>{
 let release;const gate=new Promise(r=>release=r);
 await page.route('https://itunes.apple.com/**',async r=>{await gate;return r.fallback();});
 await start(page);await page.evaluate(()=>goToView('albums'));
 const img=page.locator('#albums-grid .card img.art').first();
 await expect(img).toHaveAttribute('data-dz',/11111111111111111111111111111111/);
 await img.evaluate(i=>i.src='/assets/icons/icon-192.png');
 release();await page.waitForTimeout(400);
 await expect(img).toHaveAttribute('src','/assets/icons/icon-192.png');
});
test('opening a legacy album displays the artwork returned with its Apple tracklist',async({page})=>{
 await start(page);await page.evaluate(r=>openAlbum(r),record);
 await expect(page.locator('#detail-tracks')).toContainText('Nikes');
 await expect(page.locator('#detail-cover')).toHaveAttribute('src',/mzstatic\.com/,{timeout:8000});
});

test('native iOS: existing library, search, rating, album tracks and profile navigation',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{
  window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'ios',platform:'ios',PluginHeaders:[],Plugins:{},nativePromise:()=>Promise.reject(new Error('native mock')),nativeCallback:()=>{},addListener:()=>({remove(){}})};
 });
 await start(page);
 expect(await page.evaluate(()=>[Native.on,Rights.ON])).toEqual([true,true]);
 await page.evaluate(()=>goToView('albums'));
 await expect(page.locator('#albums-grid .card img.art').first()).toHaveAttribute('src',/mzstatic\.com/);
 await page.locator('#modes button[data-mode="rate"]').click();
 await page.locator('#search-input').fill('Blonde');
 await page.locator('#suggestions .suggestion').first().click();
 await expect(page.locator('#rs-modal')).toHaveClass(/open/);
 await page.locator('#rs-range').fill('83');await page.locator('#rs-save').click();
 await expect(page.locator('#rs-modal')).not.toHaveClass(/open/);
 expect(await page.evaluate(()=>Object.values(loadAlbums()).some(r=>r.score===83))).toBe(true);
 await page.evaluate(r=>openAlbum(r),record);
 await expect(page.locator('#detail-tracks')).toContainText('Nikes');
 await expect(page.locator('#detail-cover')).toHaveAttribute('src',/mzstatic\.com/);
 await expect(page.locator('#detail-spotify')).toHaveAttribute('href',/music\.apple\.com/);
 await page.evaluate(()=>goToView('profile'));
 await expect(page.locator('#view-profile')).toBeVisible();
});

test('background covers respect the API budget and leave room for interactive search',async({page})=>{
 const queries=[];
 await page.route('**/artwork-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body></body></html>'}));
 await page.route('https://itunes.apple.com/**',r=>{
  const term=new URL(r.request().url()).searchParams.get('term');queries.push(term);
  return r.fulfill({json:{resultCount:1,results:[{wrapperType:'track',collectionId:Number((term.match(/\d+/)||['111'])[0])+1,collectionName:term.replace('Artist ',''),artistName:'Artist',artworkUrl100:ART,trackCount:12}]}});
 });
 await page.goto('/artwork-harness');
 await page.addScriptTag({path:fileURLToPath(new URL('../../assets/apple.js',import.meta.url))});
 await page.evaluate(dz=>{
  for(let n=0;n<18;n++){
   const src=dz.replace('11111111111111111111111111111111',String(n).padStart(32,'0'));
   Rights.rememberArtwork({name:'Record '+n,artist:'Artist',art:src},'album');
   const img=document.createElement('img');img.width=10;img.height=10;img.src=src;document.body.append(img);
  }
 },DZ);
 await expect.poll(()=>queries.length).toBe(16);
 await page.evaluate(()=>fetch('/api/catalogue?path=search&type=album&q=Artist%20Urgent').then(r=>r.json()));
 expect(queries.filter(q=>q==='Artist Urgent')).toHaveLength(2);
 expect(queries).toHaveLength(18);
});
