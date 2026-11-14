// Isolated transport/receipt regressions: no network, accounts or live database.
import assert from 'node:assert/strict';
import { createMusicBrainzClient, MusicBrainzUnavailable } from '../assets/rocketrun-musicbrainz.js';
import { answerReceipt, receiptArrival } from '../api/_rocketrun-retry.js';
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const options = { intervalMs: 1, timeoutMs: 20, budgetMs: 200 };
let calls=0;
const retries=[];
const recover=createMusicBrainzClient({...options,onRetry:r=>retries.push(r),fetcher:async()=>{
 calls++;if(calls===1)throw new TypeError('Failed to fetch');
 if(calls===2)return new Response('{}',{status:503,headers:{'Retry-After':'0'}});
 return json({artists:[]});
}});
assert.deepEqual(await recover('artist/?fmt=json'),{artists:[]});
assert.deepEqual(retries.map(r=>r.code),['network','http']);
assert.equal(retries[1].status,503);

calls=0;
const malformed=createMusicBrainzClient({...options,fetcher:async()=>++calls===1?new Response('<html>busy</html>'):json({artists:[]})});
assert.deepEqual(await malformed('artist/'),{artists:[]});assert.equal(calls,2);
calls=0;
const schema=createMusicBrainzClient({...options,fetcher:async()=>++calls===1?json({error:'busy'}):json({artists:[]})});
assert.deepEqual(await schema('artist/',{validate:j=>Array.isArray(j.artists)}),{artists:[]});assert.equal(calls,2);

calls=0;
const timeout=createMusicBrainzClient({...options,attempts:2,fetcher:(_,init)=>{
 calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')),{once:true}));
}});
await assert.rejects(timeout('artist/'),e=>e instanceof MusicBrainzUnavailable&&e.code==='timeout');assert.equal(calls,2);
const stalledBody=createMusicBrainzClient({...options,attempts:1,fetcher:async(_,init)=>({
 status:200,ok:true,json:()=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Body timeout','AbortError')),{once:true}))
})});
await assert.rejects(stalledBody('artist/'),e=>e.code==='timeout','response bodies have the same timeout as headers');
calls=0;
const rateLimited=createMusicBrainzClient({...options,budgetMs:50,fetcher:async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':'60'}});}});
await assert.rejects(rateLimited('artist/'),e=>e.status===429);assert.equal(calls,1,'do not retry before Retry-After');
calls=0;
const forbidden=createMusicBrainzClient({...options,fetcher:async()=>{calls++;return new Response('{}',{status:403});}});
await assert.rejects(forbidden('artist/'),e=>e.status===403);assert.equal(calls,1);
assert.equal(await createMusicBrainzClient({...options,fetcher:async()=>new Response('',{status:404})})('artist/'),null);

calls=0;const abort=new AbortController();
const cancel=createMusicBrainzClient({...options,intervalMs:100,onRetry:()=>abort.abort(),fetcher:async()=>{calls++;throw new TypeError('offline');}});
await assert.rejects(cancel('artist/',{signal:abort.signal}),e=>e.name==='AbortError');assert.equal(calls,1);

const secret='isolated-test-signing-key';const fields={user:'fixture',day:2509,q:0,id:'chosen-answer',at:new Date().toISOString()};
const expected={user:fields.user,day:fields.day,q:fields.q,id:fields.id};
const token=answerReceipt(fields,secret);
assert.equal(receiptArrival(token,expected,secret),fields.at);
for(const change of [{user:'another'},{day:2510},{q:1},{id:'different'}])assert.equal(receiptArrival(token,{...expected,...change},secret),null);
assert.equal(receiptArrival(token,expected,'wrong-key'),null);
assert.equal(receiptArrival(token+'x',expected,secret),null);
assert.equal(receiptArrival(token,expected,secret,Date.parse(fields.at)+90001),null);
assert.equal(receiptArrival(token,expected,secret,Date.parse(fields.at)-1),null);
console.log('rocketrun network selfcheck: recovery, malformed JSON/schema, timeout, Retry-After, terminal errors, cancellation and bound/expiring receipts passed');
