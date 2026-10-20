import { test, expect, start } from './fixtures.mjs';

test('authenticated deletion survives a stale-device reload, an offline retry and a deliberate re-rating', async ({page}) => {
  const uid='11111111-1111-4111-8111-111111111111',now=Date.now();
  const user={id:uid,email:'fixture@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
  const token=[Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,role:'authenticated',aud:'authenticated',exp:Math.floor(now/1000)+3600})).toString('base64url'),'fixture'].join('.');
  const rating={id:'100',name:'Record 100',artist:'Test Artist',score:85,ratedAt:now-60000,savedAt:now-60000};
  let cloud={100:rating},rows={100:rating},deleted={},offline=false;
  await page.addInitScript(({user,token,rating})=>{
    localStorage.setItem('sb-cqfxyebejpkyhswolrwi-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user}));
    // Deliberately put an old device's rating back on every reload.
    localStorage.setItem('crate_albums_v1',JSON.stringify({100:rating}));
    localStorage.setItem('crate_onboard_v1',JSON.stringify({done:true,step:5}));
  },{user,token,rating});
  await page.route('**/rest/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').pop();
    const body=req.postDataJSON(),single=(req.headers().accept||'').includes('object+json');
    if(name==='profiles'){
      const p={id:uid,username:'Fixture',is_admin:false,discs:1000,owned_themes:['classic'],ratings_visibility:'public'};
      return route.fulfill({json:single?p:[p]});
    }
    if(name==='wallet_state')return route.fulfill({json:{id:uid,discs:1000,is_admin:false}});
    if(name==='rating_delete'){
      expect(body.p_owner).toBe(uid);
      if(offline)return route.fulfill({status:503,json:{message:'offline fixture'}});
      const k=body.p_kind+'|'+body.p_item_id;
      deleted[k]=Math.max(deleted[k]||0,body.p_deleted_ms);
      delete rows[body.p_item_id];delete cloud[body.p_item_id];
      return route.fulfill({json:deleted[k]});
    }
    if(name==='rating_deletions')return route.fulfill({json:Object.entries(deleted).map(([k,at])=>({kind:k.split('|')[0],item_id:k.split('|')[1],deleted_ms:at}))});
    if(name==='app_state'){
      if(req.method()==='GET')return route.fulfill({json:[{key:'crate_albums_v1',value:cloud}]});
      if(body.key==='crate_albums_v1')cloud=body.value;
      return route.fulfill({json:{}});
    }
    if(name==='ratings'){
      if(req.method()==='GET')return route.fulfill({json:Object.keys(rows).map(id=>({kind:'album',item_id:id}))});
      for(const row of Array.isArray(body)?body:[body])if(row.data.ratedAt>(deleted[row.kind+'|'+row.item_id]||0))rows[row.item_id]=row.data;
      return route.fulfill({json:{}});
    }
    return route.fallback();
  });
  await start(page);
  await page.evaluate(()=>Cloud.ready);
  expect(await page.evaluate(()=>Cloud.isOn())).toBe(true);
  expect(await page.evaluate(()=>loadAlbums()['100'].score)).toBe(85);
  await page.evaluate(()=>removeAlbum('100'));
  await expect.poll(()=>Object.keys(deleted).length).toBe(1);
  await page.reload();await page.evaluate(()=>Cloud.ready);
  expect(await page.evaluate(()=>loadAlbums()['100'])).toBeUndefined();
  await page.evaluate(async()=>{
    const a=loadAlbums(),r={id:'100',name:'Record 100',artist:'Test Artist',score:90,ratedAt:Date.now(),savedAt:Date.now()};
    a['100']=r;persist('crate_albums_v1',a);await Cloud.syncRating('album','100',r);
  });
  expect(rows['100'].score).toBe(90);
  offline=true;await page.evaluate(()=>removeAlbum('100'));
  await expect.poll(()=>page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('crate_rating_delete_pending_v1'))).length)).toBe(1);
  offline=false;await page.reload();await page.evaluate(()=>Cloud.ready);
  expect(await page.evaluate(()=>loadAlbums()['100'])).toBeUndefined();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('crate_rating_delete_pending_v1')))).toEqual({});
  expect(rows['100']).toBeUndefined();
});

// Returning to the tab asks only whether anything changed (key + updated_at)
// and downloads nothing when it has not; a change made elsewhere is pulled.
test('tab return probes timestamps and skips the download when the cloud is unchanged', async ({page}) => {
  const uid='11111111-1111-4111-8111-111111111111',now=Date.now();
  const user={id:uid,email:'fixture@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
  const token=[Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,role:'authenticated',aud:'authenticated',exp:Math.floor(now/1000)+3600})).toString('base64url'),'fixture'].join('.');
  const rating={id:'100',name:'Record 100',artist:'Test Artist',score:85,ratedAt:now-60000,savedAt:now-60000};
  const store={crate_albums_v1:{value:{100:rating},updated_at:'2026-10-20T10:00:00.123456+00:00'}};const seen={full:0,probe:0};
  await page.addInitScript(({user,token,rating})=>{
    localStorage.setItem('sb-cqfxyebejpkyhswolrwi-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user}));
    localStorage.setItem('crate_albums_v1',JSON.stringify({100:rating}));
    localStorage.setItem('crate_onboard_v1',JSON.stringify({done:true,step:5}));
  },{user,token,rating});
  await page.route('**/auth/v1/user',route=>route.fulfill({json:user}));
  await page.route('**/rest/v1/**',route=>{
    const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').pop();
    const single=(req.headers().accept||'').includes('object+json');
    if(name==='profiles'){const p={id:uid,username:'Fixture',is_admin:false,discs:1000,owned_themes:['classic'],ratings_visibility:'public'};return route.fulfill({json:single?p:[p]});}
    if(name==='app_state'&&req.method()==='GET'){
      const sel=url.searchParams.get('select')||'';
      if(sel.includes('value')){seen.full++;return route.fulfill({json:Object.entries(store).map(([key,r])=>({key,value:r.value,updated_at:r.updated_at}))});}
      seen.probe++;return route.fulfill({json:Object.entries(store).map(([key,r])=>({key,updated_at:r.updated_at}))});
    }
    if(name==='app_state'){const b=req.postDataJSON();for(const row of Array.isArray(b)?b:[b])store[row.key]={value:row.value,updated_at:row.updated_at.replace('Z','000+00:00')};return route.fulfill({json:{}});}
    if(name==='rating_deletions')return route.fulfill({json:[]});
    return route.fulfill({json:[]});
  });
  await start(page);
  await page.evaluate(()=>Cloud.ready);
  await expect.poll(()=>seen.full).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  const before=seen.full;
  const back=()=>page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await back();
  await expect.poll(()=>seen.probe).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  expect(seen.full).toBe(before);
});
