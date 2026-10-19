// All network requests are intercepted. Never loads production credentials.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pushEndpoint } from '../api/_push-endpoint.js';
import { sendPush, generateVapidKeys, b64u } from '../api/_webpush.js';
import { spotifyMatch } from '../api/_spotify-match.js';
import deleteAccount from '../api/delete-account.js';
const originalFetch = globalThis.fetch, originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-service-key';
const response = (data, status=200) => new Response(JSON.stringify(data), { status });
const res = () => ({ headers:{}, setHeader(k,v){this.headers[k]=v;}, status(s){this.code=s;return this;}, json(j){this.body=j;return this;}, end(){} });
let groups=0;
const check=async(name,fn)=>{await fn();groups++;console.log('ok — '+name);};
try {
  await check('push rejects arbitrary destinations before making requests; redirects disabled',async()=>{
    let calls=0;
    globalThis.fetch=async(url,opts)=>{calls++;assert.equal(opts.redirect,'error');assert.ok(opts.signal);assert.equal(new URL(url).hostname,'web.push.apple.com');return response({},201);};
    const ua=crypto.createECDH('prime256v1');ua.generateKeys();
    const keys={p256dh:b64u.enc(ua.getPublicKey()),auth:b64u.enc(crypto.randomBytes(16))};
    for(const endpoint of ['https://127.0.0.1/','https://[::1]/','https://web.push.apple.com.evil.test/x','https://evil.test/?to=web.push.apple.com',
      'https://user@web.push.apple.com/x','https://web.push.apple.com:444/x','http://web.push.apple.com/x','https://web.push.apple.com/x#hidden']) {
      await assert.rejects(sendPush({endpoint,keys},{title:'test'},generateVapidKeys()));
    }
    assert.equal(calls,0);
    assert.equal(await sendPush({endpoint:'https://web.push.apple.com/token',keys},{title:'test'},generateVapidKeys()),201);
    for(const endpoint of ['https://fcm.googleapis.com/fcm/send/token','https://fcm.googleapis.com/wp/token','https://updates.push.services.mozilla.com/wpush/v2/token','https://wns2-by3p.notify.windows.com/?token=example']) assert.equal(pushEndpoint(endpoint),endpoint);
  });
  await check('forged URI metadata cannot poison a later import; safe matches remain shared',async()=>{
    const cache=new Map();let dzCalls=0;
    globalThis.fetch=async(url,opts={})=>{
      const u=new URL(url);
      if(u.pathname==='/auth/v1/user')return opts.headers.Authorization==='Bearer good'?response({id:'u'}):response({},401);
      if(u.hostname==='api.deezer.com'){
        dzCalls++;const first=u.searchParams.get('q').toLowerCase().includes('first');
        return response({data:[{id:first?1:2,title:first?'First':'Second',rank:500000,artist:{name:'Artist'},album:{title:'Album'}}]});
      }
      assert.ok(u.pathname.endsWith('/catalogue_matches'),'must not trust the old URI cache');
      if(opts.method==='POST'){
        const rows=JSON.parse(opts.body);assert.equal(new Set(rows.map(r=>r.cache_key)).size,rows.length);
        rows.forEach(r=>cache.set(r.cache_key,r));return response({});
      }
      const keys=u.searchParams.get('cache_key').slice(4,-1).split(',');
      return response(keys.flatMap(k=>cache.has(k)?[cache.get(k)]:[]));
    };
    const uri='spotify:track:1111111111111111111111';
    const run=async(items)=>{const r=res();await spotifyMatch({method:'POST',headers:{authorization:'Bearer good'},body:{kind:'track',items}},r);assert.equal(r.code,200);assert.equal(r.headers['Cache-Control'],'no-store');return r.body.results;};
    assert.equal((await run([{u:uri,a:'Artist',t:'First',b:'Album'}]))[0].m.id,'1');
    assert.equal((await run([{u:uri,a:'Artist',t:'Second',b:'Album'}]))[0].m.id,'2');
    for(const authorization of [undefined,'Bearer bad']){const r=res();await spotifyMatch({method:'POST',headers:{authorization},body:{kind:'track',items:[{u:uri,a:'Artist',t:'First',b:'Album'}]}},r);assert.equal(r.code,401);}
    const calls=dzCalls;
    const other='spotify:track:2222222222222222222222';
    const rows=await run([{u:other,a:'Artist',t:'Second',b:'Album'},{u:uri,a:'Artist',t:'Second',b:'Album'}]);
    assert.equal(rows[0].u,other);assert.equal(rows[1].u,uri);assert.equal(dzCalls,calls);assert.equal(cache.size,2);
  });
  const uid='11111111-1111-4111-8111-111111111111';
  async function deletion({count=0,failList=false,failRemove=false,failPurge=false,badName=false}={}){
    let files=Array.from({length:count},(_,i)=>({name:'avatar-'+i+'.png'}));
    if(badName)files=[{name:'../other-user.png'}];
    const calls=[];
    globalThis.fetch=async(url,opts={})=>{
      const path=new URL(url).pathname;calls.push([path,opts.method||'GET']);
      if(path==='/auth/v1/user')return response({id:uid});
      if(path.endsWith('/object/list/avatars'))return response(files.slice(0,100),failList?503:200);
      if(path.endsWith('/object/avatars')){
        if(failRemove)return response({},503);
        const names=JSON.parse(opts.body).prefixes;
        assert.ok(names.every(n=>n.startsWith(uid+'/')));
        files=files.filter(f=>!names.includes(uid+'/'+f.name));return response({});
      }
      if(path.endsWith('/rpc/delete_my_data'))return response({},failPurge?500:200);
      if(path==='/auth/v1/admin/users/'+uid)return response({});
      throw new Error('Unexpected request: '+path);
    };
    const r=res();await deleteAccount({method:'POST',headers:{authorization:'Bearer test-user-token'},body:{confirm:'DELETE'}},r);
    return {r,calls,files};
  }
  await check('storage failures retain the account and never report successful deletion',async()=>{
    for(const args of [{failList:true},{count:1,failRemove:true},{badName:true}]){
      const {r,calls}=await deletion(args);assert.equal(r.code,503);
      assert.ok(!calls.some(([p])=>p.endsWith('/rpc/delete_my_data')||p.includes('/auth/v1/admin/')));
    }
  });
  await check('all avatar pages are removed before rows and login; purge errors stop auth deletion',async()=>{
    const {r,calls,files}=await deletion({count:205});assert.equal(r.code,200);assert.equal(files.length,0);
    assert.equal(calls.filter(([p,m])=>p.endsWith('/object/avatars')&&m==='DELETE').length,3);
    assert.ok(calls.findIndex(([p])=>p.endsWith('/rpc/delete_my_data'))>calls.findLastIndex(([p])=>p.includes('/storage/')));
    const failed=await deletion({failPurge:true});assert.equal(failed.r.code,500);
    assert.ok(!failed.calls.some(([p])=>p.includes('/auth/v1/admin/')));
  });
  await check('moderation avatar purge: admins only, target folder only, never touches the account',async()=>{
    const target='22222222-2222-4222-8222-222222222222';
    for(const admin of [false,true]){
      let files=[{name:'a.jpg'}];const calls=[];
      globalThis.fetch=async(url,opts={})=>{
        const path=new URL(url).pathname;calls.push(path);
        if(path==='/auth/v1/user')return response({id:uid});
        if(path.endsWith('/rpc/is_admin'))return response(admin);
        if(path.endsWith('/object/list/avatars')){assert.equal(JSON.parse(opts.body).prefix,target+'/');return response(files);}
        if(path.endsWith('/object/avatars')){assert.deepEqual(JSON.parse(opts.body).prefixes,[target+'/a.jpg']);files=[];return response({});}
        throw new Error('Unexpected request: '+path);
      };
      const r=res();await deleteAccount({method:'POST',headers:{authorization:'Bearer t'},body:{moderate:'avatar',user:target}},r);
      assert.equal(r.code,admin?200:403);assert.equal(files.length,admin?0:1);
      assert.ok(!calls.some(p=>p.includes('delete_my_data')||p.includes('/admin/')));
    }
  });
  console.log(`launch API selfcheck: ${groups} groups passed (mocked network)`);
} finally {
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
}
