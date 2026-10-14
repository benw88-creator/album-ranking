import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const between=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const source=between('  function itemStamp(x)','  function mergeClaimed(a,b)');
const writes=between('  async function syncRating(kind,itemId,data)','  async function setRatingsVisibility(level)');
const storage=new Map(),sent=[],flashes=[];
let fail=false,wait=null;
const ctx=vm.createContext({Date,Promise,user:{id:'owner-a'},flash:s=>flashes.push(s),
  sb:{rpc:async(name,args)=>{assert.equal(name,'rating_delete');sent.push({delete:args,owner:ctx.user.id});if(wait)await wait;return fail?{error:{message:'offline'}}:{data:args.p_deleted_ms};},
    from:table=>({upsert:async row=>{assert.equal(table,'ratings');sent.push({rating:row});return{};}})},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}});
vm.runInContext(`function isOn(){return !!user;} function lsGet(k){return JSON.parse(localStorage.getItem(k)||'null');}
  function lsSetRaw(k,v){localStorage.setItem(k,JSON.stringify(v));}
  ${source}${writes}
  globalThis.core={mergeItemMap,applyRatingDeletions,deleteRating,syncRating,flushRatingDeletes};`,ctx);
const C=ctx.core;
const plain=x=>JSON.parse(JSON.stringify(x));
let n=0;
const check=async(name,fn)=>{await fn();n++;console.log('ok — '+name);};
await check('a remote deletion suppresses a stale local/cloud union and preserves later re-ratings',async()=>{
  const stale={x:{ratedAt:100}},fresh={x:{ratedAt:300}},d={'album|x':200};
  assert.deepEqual(plain(C.applyRatingDeletions(C.mergeItemMap(stale,{}),'album',d)),{});
  assert.deepEqual(plain(C.applyRatingDeletions(C.mergeItemMap(stale,fresh),'album',d)),fresh);
  assert.deepEqual(plain(C.applyRatingDeletions(stale,'song',d)),stale);
});
await check('offline deletions retain their event time and retry before a new rating',async()=>{
  fail=true;await C.deleteRating('album','x',{ratedAt:100});
  const pending=JSON.parse(storage.get('crate_rating_delete_pending_v1')),at=pending['album|x'];
  assert.ok(at>100);assert.equal(flashes.length,1);
  fail=false;sent.length=0;
  await C.syncRating('album','x',{ratedAt:at+1,score:90});
  assert.equal(sent[0].delete.p_deleted_ms,at);assert.equal(sent[1].rating.data.score,90);
  assert.deepEqual(JSON.parse(storage.get('crate_rating_delete_pending_v1')),{});
  await C.syncRating('album','x',{ratedAt:100,score:85});
  assert.equal(sent.length,2,'stale rating must never be uploaded');
});
await check('queued work from one account cannot run under another account',async()=>{
  let finish;wait=new Promise(resolve=>{finish=resolve;});
  const first=C.deleteRating('song','slow',{ratedAt:100});
  // Let the first request start, then queue another behind it.
  await new Promise(resolve=>setTimeout(resolve,0));
  const queued=C.flushRatingDeletes();ctx.user={id:'owner-b'};
  finish();wait=null;await first;await queued;
  assert.ok(!sent.some(x=>x.owner==='owner-b'));
  assert.equal(sent.filter(x=>x.delete?.p_item_id==='slow').length,1,'concurrent flushes reuse one deletion request');
  assert.ok(JSON.parse(storage.get('crate_rating_delete_pending_v1'))['song|slow']);
});
await check('Apple fallback retains the exact store link alongside its audio URL',async()=>{
  const start=html.indexOf('  function appleMap(meta)');
  const end=html.indexOf('\n  }',start)+4;
  const apple=vm.createContext({encodeURIComponent,norm:s=>String(s).toLowerCase(),fetch:async()=>({ok:true,json:async()=>({results:[
    {collectionName:'Record',trackName:'Song',previewUrl:'https://audio.example/clip',trackViewUrl:'https://music.apple.com/us/album/song/123?i=456'},
    {collectionName:'Record',trackName:'No attribution',previewUrl:'https://audio.example/other'}]})})});
  vm.runInContext(html.slice(start,end)+'\nglobalThis.resolve=appleMap;',apple);
  const map=plain(await apple.resolve({artist:'Artist',name:'Record'}));
  assert.deepEqual(map.song,{url:'https://audio.example/clip',link:'https://music.apple.com/us/album/song/123?i=456',source:'apple'});
  assert.equal(Object.keys(map).length,1);
});
console.log(`launch sync selfcheck: ${n} groups passed`);
